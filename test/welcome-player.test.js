const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWelcomeManager } = require('../src/welcome/player');
const tick = async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };
function setup({ resolve, busy = () => false, entersState, botUserId } = {}) {
  const players = [], connections = [], audio = [], timers = [];
  let now = 1000;
  const voice = {
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' }, VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
    NoSubscriberBehavior: { Stop: 'stop' }, StreamType: { Raw: 'raw' },
    createAudioPlayer() {
      const p = new EventEmitter(); p.state = { status: 'idle' };
      p.play = resource => { const before = p.state; p.state = { status: 'playing', resource }; p.emit('stateChange', before, p.state); };
      p.stop = () => { const before = p.state; p.state = { status: 'idle' }; p.emit('stateChange', before, p.state); };
      players.push(p); return p;
    },
    createAudioResource: (stream, options) => ({ stream, ...options }),
    joinVoiceChannel(options) { const c = new EventEmitter(); c.options = options; c.subscribe = () => {}; c.destroy = () => { c.destroyed = true; c.emit('destroyed'); }; connections.push(c); return c; },
    entersState: entersState ?? (async value => value),
  };
  const channel = { id: 'voice', type: 2, permissionsFor: () => ({ has: () => true }) };
  const guild = { id: 'guild', voiceAdapterCreator() {}, members: { me: {} } };
  const member = id => ({ id, user: { bot: false }, voice: { channelId: 'voice' } });
  const manager = createWelcomeManager({ voice, resolve: resolve ?? (async () => ({ url: 'sound', durationMs: 1000 })),
    source: { open: async () => { const a = { stream: new PassThrough(), close() { this.closed = true; this.stream.destroy(); } }; audio.push(a); return a; } },
    musicBusy: busy, botUserId, now: () => now, logger: { warn() {} }, setTimer: cb => { const t = { cb, unref() {} }; timers.push(t); return t; }, clearTimer: t => { if (t) t.cleared = true; } });
  const enter = (m, old = null) => manager.voiceStateUpdate({ channelId: old, guild, member: m }, { channelId: 'voice', channel, guild, member: m, id: m.id });
  return { manager, enter, member, guild, channel, players, connections, audio, timers, setNow: n => { now = n; } };
}
test('joins the member channel, plays their sound, and disconnects immediately at the end', async () => {
  const a = setup(); await a.enter(a.member('one')); await tick();
  assert.equal(a.connections[0].options.channelId, 'voice');
  assert.equal(a.players[0].state.status, 'playing');
  a.players[0].stop(); await tick();
  assert.equal(a.connections[0].destroyed, true); assert.equal(a.audio[0].closed, true);
  a.manager.shutdown();
});
test('ignores bot/mute updates, applies cooldown, and skips busy music', async () => {
  const a = setup(); const m = a.member('one');
  await a.enter(m, 'voice'); await a.enter({ ...m, user: { bot: true } }); await tick();
  assert.equal(a.connections.length, 0);
  await a.enter(m); await tick(); a.players[0].stop(); await tick();
  await a.enter(m); await tick(); assert.equal(a.connections.length, 1);
  a.setNow(31001); await a.enter(m); await tick(); assert.equal(a.connections.length, 2); a.manager.shutdown();
  const b = setup({ busy: () => true }); await b.enter(b.member('two')); await tick(); assert.equal(b.connections.length, 0); b.manager.shutdown();
});
test('simultaneous arrivals play in order and stale members are skipped', async () => {
  let ready; const pending = new Promise(r => { ready = r; });
  const a = setup({ resolve: (_, id) => id === 'one' ? pending : Promise.resolve({ url: 'two', durationMs: 1000 }) });
  const one = a.member('one'), two = a.member('two');
  await a.enter(one); await a.enter(two); await tick(); assert.equal(a.connections.length, 0);
  ready({ url: 'one', durationMs: 1000 }); await tick(); assert.equal(a.connections.length, 1);
  two.voice.channelId = null; a.players[0].stop(); await tick(); assert.equal(a.connections.length, 1); a.manager.shutdown();
});
test('music can preempt welcome, including a late sound lookup', async () => {
  let ready; const pending = new Promise(r => { ready = r; });
  const a = setup({ resolve: () => pending }); await a.enter(a.member('one')); a.manager.cancelGuild('guild');
  ready({ url: 'one', durationMs: 1000 }); await tick(); assert.equal(a.connections.length, 0);
  const b = setup(); await b.enter(b.member('two')); await tick(); b.manager.cancelGuild('guild');
  assert.equal(b.connections[0].destroyed, true); assert.equal(b.audio[0].closed, true); b.manager.shutdown(); a.manager.shutdown();
});
test('timeouts and voice connection failures disconnect and release audio', async () => {
  const a = setup(); await a.enter(a.member('one')); await tick();
  a.timers.find(t => !t.cleared).cb(); await tick(); assert.equal(a.connections[0].destroyed, true); assert.equal(a.audio[0].closed, true);
  a.setNow(31001); await a.enter(a.member('one')); await tick(); a.connections[1].emit('disconnected'); await tick();
  assert.equal(a.connections[1].destroyed, true); a.manager.shutdown();
});

test('a delayed prior leave does not cancel a new welcome before voice is ready', async () => {
  let ready; const pending = new Promise(r => { ready = r; });
  const a = setup({ botUserId: 'bot', entersState: value => value.options ? pending : Promise.resolve(value) });
  await a.enter(a.member('one')); await tick();
  const bot = { id: 'bot', user: { bot: true } };
  a.manager.voiceStateUpdate({ guild: a.guild, channelId: 'voice', member: bot }, { guild: a.guild, id: 'bot', channelId: null, member: bot });
  ready(a.connections[0]); await tick();
  assert.equal(a.players[0].state.status, 'playing');
  a.manager.voiceStateUpdate({ guild: a.guild, channelId: 'voice', member: bot }, { guild: a.guild, id: 'bot', channelId: null, member: bot });
  assert.equal(a.connections[0].destroyed, true);
  a.manager.shutdown();
});
