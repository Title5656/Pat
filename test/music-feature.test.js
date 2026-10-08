const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { ChannelType, PermissionFlagsBits: P, Events } = require('discord.js');
const { createMusicHandler, startMusic } = require('../src/music/feature');

function fixture({ room = 'controls', userRoom = 'voice', permission = true, type = ChannelType.GuildVoice } = {}) {
  const replies = [], calls = [];
  const voice = { id: userRoom, type, permissionsFor: () => ({ has: () => permission }) };
  const guild = { id: 'guild', members: { me: { id: 'pim' }, fetch: async () => ({ voice: { channel: userRoom ? voice : null } }) } };
  const interaction = { isChatInputCommand: () => true, commandName: 'play', channelId: room,
    guild, guildId: guild.id, user: { id: 'human' }, options: { getString: () => 'song' },
    async deferReply(options) { replies.push({ defer: options }); this.deferred = true; },
    async reply(options) { replies.push(options); this.replied = true; },
    async editReply(options) { replies.push(options); },
  };
  const manager = {
    async enqueue(options) { calls.push(options); return { track: { title: 'Song @everyone [link]', url: 'https://youtu.be/abcdefghijk' }, position: 0 }; },
    queue: () => ({ current: null, upcoming: [] }), skip() {}, stop() {},
  };
  const handle = createMusicHandler({ manager, controlChannelId: 'controls', logger: { warn() {} } });
  return { interaction, replies, calls, manager, handle };
}

test('refuses music outside PAT_STOPWATCH_CHANNEL_ID before joining voice', async () => {
  const app = fixture({ room: 'chat' }); await app.handle(app.interaction);
  assert.equal(app.calls.length, 0);
  assert.ok(app.replies[0].flags);
  assert.match(app.replies[0].content, /controls/);
});

test('requires the caller to be in an ordinary voice channel with bot permissions', async () => {
  for (const options of [{ userRoom: null }, { permission: false }, { type: ChannelType.GuildStageVoice }]) {
    const app = fixture(options); await app.handle(app.interaction);
    assert.equal(app.calls.length, 0);
    assert.ok(app.replies.at(-1).content);
  }
});

test('defers before metadata work and disables mentions in song replies', async () => {
  const app = fixture(); await app.handle(app.interaction);
  assert.ok(app.replies[0].defer);
  assert.equal(app.calls[0].channel.id, 'voice');
  assert.equal(app.calls[0].query, 'song');
  assert.deepEqual(app.replies.at(-1).allowedMentions, { parse: [] });
  assert.match(app.replies.at(-1).content, /Song/);
});

test('queue listing is bounded and does not require joining voice', async () => {
  const app = fixture({ userRoom: null }); app.interaction.commandName = 'queue';
  app.manager.queue = () => ({ current: { title: 'Now', url: 'https://youtu.be/abcdefghijk' },
    upcoming: Array.from({ length: 25 }, (_, i) => ({ title: `Song ${i}`, url: null })) });
  await app.handle(app.interaction);
  assert.match(app.replies.at(-1).content, /Song 9/);
  assert.doesNotMatch(app.replies.at(-1).content, /Song 10/);
  assert.match(app.replies.at(-1).content, /15/);
});

test('queue fits the Discord message limit even when markdown doubles title length', async () => {
  const app = fixture(); app.interaction.commandName = 'queue';
  const track = { title: '_'.repeat(100), url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  app.manager.queue = () => ({ current: track, upcoming: Array(25).fill(track) });
  await app.handle(app.interaction);
  assert.ok(app.replies.at(-1).content.length <= 2000);
});

test('extractor error details never reach Discord', async () => {
  const app = fixture();
  app.manager.enqueue = async () => { throw Object.assign(new Error('SECRET'), { code: 'YOUTUBE_UNAVAILABLE' }); };
  await app.handle(app.interaction);
  assert.doesNotMatch(app.replies.at(-1).content, /SECRET/);
  assert.match(app.replies.at(-1).content, /YouTube/);
});

test('unrelated application interactions are ignored', async () => {
  const app = fixture(); app.interaction.commandName = 'unrelated';
  assert.equal(await app.handle(app.interaction), false);
  assert.equal(app.replies.length, 0);
});

test('stop cancels an earlier play still checking bot permissions', async () => {
  const app = fixture();
  let finishBot;
  const bot = new Promise(resolve => { finishBot = resolve; });
  app.interaction.guild.members.fetchMe = () => bot;
  const play = app.handle(app.interaction);
  await new Promise(resolve => setImmediate(resolve));
  const stop = { ...app.interaction, commandName: 'stop', deferred: false };
  await app.handle(stop);
  finishBot({ id: 'pim' }); await play;
  assert.equal(app.calls.length, 0);
  assert.match(app.replies.at(-1).content, /ยกเลิก/);
});

test('concurrent play interactions reserve FIFO before slow Discord member checks', async () => {
  const app = fixture();
  let finishFirst;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const member = { voice: { channel: { id: 'voice', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) } } };
  app.interaction.guild.members.fetch = async ({ user }) => user === 'a' ? first : member;
  const a = { ...app.interaction, user: { id: 'a' }, options: { getString: () => 'first' } };
  const b = { ...app.interaction, user: { id: 'b' }, options: { getString: () => 'second' } };
  const pendingA = app.handle(a), pendingB = app.handle(b);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, 0);
  finishFirst(member); await Promise.all([pendingA, pendingB]);
  assert.deepEqual(app.calls.map(call => call.query), ['first', 'second']);
});

test('a refused stop from a different room does not cancel a valid pending play', async () => {
  const app = fixture();
  let finishBot;
  const bot = new Promise(resolve => { finishBot = resolve; });
  app.interaction.guild.members.fetchMe = () => bot;
  app.manager.stop = () => { throw Object.assign(new Error('other room'), { code: 'OTHER_CHANNEL' }); };
  const play = app.handle(app.interaction); await new Promise(resolve => setImmediate(resolve));
  await app.handle({ ...app.interaction, commandName: 'stop' });
  finishBot({ id: 'pim' }); await play;
  assert.equal(app.calls.length, 1);
});

test('uses the current voice room after a user moves during bot permission lookup', async () => {
  const app = fixture();
  const member = { voice: { channel: { id: 'old', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) } } };
  app.interaction.guild.members.fetch = async () => member;
  let finishBot;
  app.interaction.guild.members.fetchMe = () => new Promise(resolve => { finishBot = resolve; });
  const play = app.handle(app.interaction); await new Promise(resolve => setImmediate(resolve));
  member.voice.channel = { id: 'new', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) };
  finishBot({ id: 'pim' }); await play;
  assert.equal(app.calls[0].channel.id, 'new');
});

test('a later play waits for an earlier stop permission check before starting', async () => {
  const app = fixture();
  let finishStop;
  const stopMember = new Promise(resolve => { finishStop = resolve; });
  const member = { voice: { channel: { id: 'voice', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) } } };
  app.interaction.guild.members.fetch = async ({ user }) => user === 'stopper' ? stopMember : member;
  const order = [];
  app.manager.stop = () => order.push('stop');
  app.manager.enqueue = async () => { order.push('play'); return { track: { title: 'Song', url: null }, position: 0 }; };
  const stop = app.handle({ ...app.interaction, commandName: 'stop', user: { id: 'stopper' } });
  const play = app.handle({ ...app.interaction, user: { id: 'player' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, []);
  finishStop(member); await Promise.all([stop, play]);
  assert.deepEqual(order, ['stop', 'play']);
});

test('registers commands individually only in the control guild and cleans listeners on stop', async () => {
  const client = new EventEmitter(); client.user = { id: 'pim' };
  const registered = [], announcements = []; let stopped = false;
  const channel = { id: 'controls', guild: { id: 'guild', members: { me: {} },
    commands: { create: async data => { registered.push(data); } } },
    isSendable: () => true, permissionsFor: () => ({ has: () => true }),
    send: async data => announcements.push(data) };
  client.channels = { fetch: async id => { assert.equal(id, 'controls'); return channel; } };
  const manager = { shutdown() { stopped = true; }, voiceStateUpdate() {} };
  const feature = await startMusic({ client, channelId: 'controls', manager });
  assert.deepEqual(registered.map(command => command.name), ['play', 'queue', 'skip', 'stop']);
  assert.equal(registered[0].options[0].name, 'query');
  assert.equal(client.listenerCount(Events.InteractionCreate), 1);
  assert.equal(client.listenerCount(Events.VoiceStateUpdate), 1);
  await feature.stop();
  assert.equal(stopped, true);
  assert.equal(client.listenerCount(Events.InteractionCreate), 0);
  assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
});

test('missing control channel fails before registering commands', async () => {
  await assert.rejects(startMusic({ client: {}, channelId: '' }), /PAT_STOPWATCH_CHANNEL_ID/);
});
