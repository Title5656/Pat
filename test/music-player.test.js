const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createMusicManager } = require('../src/music/player');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup({ resolve, open, entersState } = {}) {
  const players = [], connections = [], opened = [], timers = [];
  const source = {
    resolve: resolve ?? (async name => ({ title: name, url: name, duration: 30 })),
    open: open ?? (async track => {
      const item = { track, stream: new PassThrough(), closed: false, close() { this.closed = true; this.stream.destroy(); } };
      opened.push(item); return item;
    }),
  };
  const voice = {
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
    NoSubscriberBehavior: { Pause: 'pause' }, StreamType: { Raw: 'raw' },
    createAudioPlayer() {
      const p = new EventEmitter(); p.state = { status: 'idle' };
      p.play = resource => { const before = p.state; p.state = { status: 'playing', resource }; p.emit('stateChange', before, p.state); };
      p.stop = () => { const before = p.state; p.state = { status: 'idle' }; p.emit('stateChange', before, p.state); };
      players.push(p); return p;
    },
    createAudioResource: (stream, options) => ({ stream, ...options }),
    joinVoiceChannel(options) {
      const c = new EventEmitter(); c.options = options; c.destroyed = false;
      c.subscribe = () => {}; c.destroy = () => { c.destroyed = true; c.emit('destroyed'); };
      connections.push(c); return c;
    },
    entersState: entersState ?? (async value => value),
  };
  const manager = createMusicManager({ source, voice, logger: { warn() {} },
    setTimer: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; } });
  const guild = { id: 'guild', voiceAdapterCreator() {} };
  const channel = { id: 'voice', members: new Map([['human', { user: { bot: false } }]]) };
  const enqueue = query => manager.enqueue({ guild, channel, query });
  return { manager, guild, channel, enqueue, players, connections, opened, timers };
}

test('plays FIFO and releases the previous stream on skip', async () => {
  const app = setup();
  await app.enqueue('first'); await tick(); await app.enqueue('second');
  assert.equal(app.manager.queue('guild').current.title, 'first');
  assert.equal(app.manager.queue('guild').upcoming[0].title, 'second');
  app.manager.skip('guild', 'voice'); await tick();
  assert.equal(app.manager.queue('guild').current.title, 'second');
  assert.equal(app.opened[0].closed, true);
  app.manager.shutdown();
});

test('the voice player allows the same extended startup window as YouTube', async () => {
  const waits = [];
  const app = setup({ entersState: async (value, state, timeout) => {
    waits.push({ state, timeout });
    if (state === 'playing' && timeout <= 35_000) throw new Error('startup cut off before audio arrived');
    return value;
  } });
  await app.enqueue('slow song'); await tick();
  assert.equal(app.manager.queue('guild').current?.title, 'slow song');
  assert.equal(waits.find(wait => wait.state === 'playing').timeout, 90_000);
  app.manager.shutdown();
});

test('concurrent lookups preserve request order despite the second resolving first', async () => {
  const first = deferred(), second = deferred();
  const app = setup({ resolve: name => name === 'first' ? first.promise : second.promise });
  const a = app.enqueue('first'), b = app.enqueue('second');
  second.resolve({ title: 'second', url: 'second' }); await b; await tick();
  assert.equal(app.opened.length, 0);
  first.resolve({ title: 'first', url: 'first' }); await a; await tick();
  assert.equal(app.manager.queue('guild').current.title, 'first');
  assert.equal(app.manager.queue('guild').upcoming[0].title, 'second');
  app.manager.shutdown();
});

test('stop invalidates a late metadata result and leaves the room', async () => {
  const metadata = deferred(); const app = setup({ resolve: () => metadata.promise });
  const pending = app.enqueue('song');
  app.manager.stop('guild', 'voice');
  metadata.resolve({ title: 'song', url: 'song' });
  await assert.rejects(pending, { code: 'CANCELLED' }); await tick();
  assert.equal(app.opened.length, 0);
  assert.equal(app.manager.queue('guild').current, null);
  assert.equal(app.connections[0].destroyed, true);
});

test('stop closes an audio stream that finishes opening late', async () => {
  const audio = deferred(); const app = setup({ open: () => audio.promise });
  await app.enqueue('song'); await tick();
  app.manager.stop('guild', 'voice');
  const stream = { stream: new PassThrough(), closed: false, close() { this.closed = true; } };
  audio.resolve(stream); await tick();
  assert.equal(stream.closed, true);
  assert.equal(app.manager.queue('guild').current, null);
});

test('skip during stream startup immediately proceeds to the next track', async () => {
  const first = deferred(); const streams = [];
  const app = setup({ open: async track => {
    if (track.title === 'first') return first.promise;
    const stream = { stream: new PassThrough(), close() {} }; streams.push(stream); return stream;
  } });
  await app.enqueue('first'); await app.enqueue('second'); await tick();
  app.manager.skip('guild', 'voice'); await tick();
  assert.equal(app.manager.queue('guild').current.title, 'second');
  const old = { stream: new PassThrough(), closed: false, close() { this.closed = true; } };
  first.resolve(old); await tick(); assert.equal(old.closed, true);
  app.manager.shutdown();
});

test('rejects controls from another room and isolates guilds', async () => {
  const app = setup(); await app.enqueue('first');
  await assert.rejects(app.manager.enqueue({ guild: app.guild, channel: { id: 'other' }, query: 'steal' }), { code: 'OTHER_CHANNEL' });
  assert.throws(() => app.manager.stop('guild', 'other'), { code: 'OTHER_CHANNEL' });
  await app.manager.enqueue({ guild: { ...app.guild, id: 'guild2' }, channel: app.channel, query: 'separate' });
  app.manager.stop('guild', 'voice'); await tick();
  assert.equal(app.manager.queue('guild2').current.title, 'separate');
  app.manager.shutdown();
});

test('counts pending metadata against the queue capacity', async () => {
  const metadata = deferred(); const app = setup({ resolve: () => metadata.promise });
  const pending = Array.from({ length: 25 }, () => app.enqueue('pending'));
  await assert.rejects(app.enqueue('overflow'), { code: 'QUEUE_FULL' });
  app.manager.shutdown(); metadata.resolve({ title: 'song', url: 'song' });
  await Promise.allSettled(pending);
});

test('failed lookups release queue capacity while another song keeps playing', async () => {
  const app = setup({ resolve: async name => {
    if (name === 'bad') throw Object.assign(new Error('unavailable'), { code: 'YOUTUBE_UNAVAILABLE' });
    return { title: name, url: name };
  } });
  await app.enqueue('playing'); await tick();
  for (let i = 0; i < 25; i++) await assert.rejects(app.enqueue('bad'), { code: 'YOUTUBE_UNAVAILABLE' });
  await app.enqueue('next');
  assert.equal(app.manager.queue('guild').upcoming.length, 1);
  assert.equal(app.manager.queue('guild').upcoming[0].title, 'next');
  app.manager.shutdown();
});

test('audio failure advances to the next song and idle timeout leaves', async () => {
  const app = setup(); await app.enqueue('first'); await app.enqueue('second'); await tick();
  app.opened[0].stream.emit('error', new Error('network')); await tick();
  assert.equal(app.manager.queue('guild').current.title, 'second');
  app.players[0].stop(); await tick();
  const timer = app.timers.findLast(t => !t.cleared); assert.ok(timer);
  timer.callback();
  assert.equal(app.connections[0].destroyed, true);
});

test('empty-room timer is cancelled when a human returns', async () => {
  const app = setup(); await app.enqueue('song'); await tick();
  app.channel.members.clear();
  app.manager.voiceStateUpdate({ guild: app.guild }, { guild: app.guild });
  const empty = app.timers.findLast(t => !t.cleared); assert.ok(empty);
  app.channel.members.set('human', { user: { bot: false } });
  app.manager.voiceStateUpdate({ guild: app.guild }, { guild: app.guild });
  assert.equal(empty.cleared, true);
  app.channel.members.clear(); app.manager.voiceStateUpdate({ guild: app.guild }, { guild: app.guild });
  app.timers.findLast(t => !t.cleared).callback();
  assert.equal(app.connections[0].destroyed, true);
  assert.equal(app.opened[0].closed, true);
});

test('a disconnected connection releases streams and its queue', async () => {
  const app = setup(); await app.enqueue('song'); await tick();
  app.connections[0].emit('disconnected');
  assert.equal(app.opened[0].closed, true);
  assert.equal(app.manager.queue('guild').current, null);
});
