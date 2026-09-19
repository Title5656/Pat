const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../index.js'), 'utf8');

function setup({ sendable = true, fetchError, sendError } = {}) {
  const messages = [];
  const errors = [];
  const listeners = new Map();
  let clientOptions;
  let fetchCount = 0;
  const fetchedChannelIds = [];
  class Client {
    constructor(options) { clientOptions = options; }
    application = { commands: {} };
    channels = {
      fetch: async (id) => {
        fetchCount++;
        fetchedChannelIds.push(id);
        if (fetchError) throw fetchError;
        return {
          guildId: 'primary-guild',
          isTextBased: () => true,
          isSendable: () => sendable,
          send: async (message) => {
            if (sendError) throw sendError;
            messages.push(message);
          },
        };
      },
    };
    once(event, listener) { listeners.set(event, listener); }
    on(event, listener) { listeners.set(event, listener); }
    login() { return Promise.resolve(); }
  }
  vm.runInNewContext(source, {
    require: (id) => {
      if (id === 'discord.js') {
        return {
          Client,
          GatewayIntentBits: {
            Guilds: 1,
            GuildVoiceStates: 2,
            GuildMessages: 4,
            MessageContent: 8,
          },
          Events: {
            ClientReady: 'ready',
            MessageCreate: 'message',
            VoiceStateUpdate: 'voice',
          },
        };
      }
      if (id === './src/chat/memory') return { createMemory: () => ({ memory: true }) };
      if (id === './src/chat/conversation') {
        return { createConversation: () => ({ conversation: true }) };
      }
      if (id === './src/chat/gemini-client') {
        return { createGeminiGenerator: () => async () => 'answer' };
      }
      if (id === './src/chat/handle-message') {
        return { createMessageHandler: () => async () => {} };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: {
      env: {
        DISCORD_TOKEN: 'test-token',
        PAT_CHAT_CHANNEL_ID: 'chat-room',
        VOICE_LOG_CHANNEL_ID: 'log',
        GEMINI_API_KEY: 'key',
        GEMINI_MODEL: 'model',
      },
    },
    Date: class extends Date { constructor() { super('2026-09-18T12:35:24Z'); } },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
  });
  return {
    messages, errors, fetchedChannelIds,
    get clientOptions() { return clientOptions; },
    get fetchCount() { return fetchCount; },
    emitReady: () => listeners.get('ready')({
      application: { commands: {} },
      user: { tag: 'Pat#0001' },
    }),
    hasListener: (event) => listeners.has(event),
    emit: (oldState, newState) => listeners.get('voice')(oldState, newState),
  };
}

function state(channelId, { bot = false, selfMute = false, selfDeaf = false, streaming = false, guildId = 'primary-guild', guildName = 'Primary' } = {}) {
  return {
    guild: { id: guildId, name: guildName },
    channelId, channel: channelId && { name: channelId === 'voice' ? 'General' : 'Gaming' },
    selfMute, selfDeaf, streaming,
    member: { id: 'user', displayName: 'Pat', user: { bot } },
  };
}

function log(app, index = 0) {
  assert.equal(app.messages[index].content, undefined);
  assert.equal(JSON.stringify(app.messages[index].allowedMentions), '{"parse":[]}');
  assert.equal(app.messages[index].embeds.length, 1);
  return app.messages[index].embeds[0];
}

test('logs a joined embed with Thai time and no mentions', async () => {
  const app = setup();
  await app.emit(state(null), state('voice'));
  assert.equal(app.messages.length, 1);
  assert.equal(log(app).title, '🟢 Voice Joined');
  assert.equal(log(app).color, 0x57F287);
  assert.equal(log(app).description, '> 👤 **User:** Pat\n> 🔊 **Channel:** `General`\n> 🕒 **Time:** 19:35:24');
});

test('logs a left embed with the old member and placeholder duration', async () => {
  const app = setup();
  await app.emit(state('voice'), { channelId: null, member: null });
  assert.equal(app.messages.length, 1);
  assert.equal(log(app).title, '🔴 Voice Left');
  assert.equal(log(app).color, 0xED4245);
  assert.equal(log(app).description, '> 👤 **User:** Pat\n> 🔊 **Channel:** `General`\n> ⏱️ **Duration:** Coming soon\n> 🕒 **Time:** 19:35:24');
});

test('logs a channel move with both channel names', async () => {
  const app = setup();
  await app.emit(state('voice'), state('gaming'));
  assert.equal(log(app).title, '🔄 Voice Moved');
  assert.equal(log(app).description, '> 👤 **User:** Pat\n> 📤 **From:** `General`\n> 📥 **To:** `Gaming`\n> 🕒 **Time:** 19:35:24');
});

test('routes external guild events to the primary log channel and labels every room', async () => {
  const app = setup();
  const external = { guildId: 'other-guild', guildName: 'Friends' };
  await app.emit(state(null, external), state('voice', external));
  await app.emit(state('voice', external), state('gaming', { ...external, selfMute: true, selfDeaf: true, streaming: true }));
  await app.emit(state('voice', { ...external, streaming: true }), state('voice', external));
  await app.emit(state('voice', external), { channelId: null, member: null });
  assert.equal(app.messages.length, 7);
  assert.deepEqual(app.fetchedChannelIds, ['log', 'log', 'log', 'log']);
  for (const message of app.messages) {
    const roomLines = message.embeds[0].description.split('\n').filter(line => /\*\*(Channel|From|To):\*\*/.test(line));
    assert.ok(roomLines.length > 0);
    for (const line of roomLines) assert.match(line, /\(เซิร์ฟเวอร์: Friends\)$/);
  }
});

test('keeps external guild names on one line without active markdown', async () => {
  const app = setup();
  const external = { guildId: 'other-guild', guildName: '**Friends**\nRoom' };
  await app.emit(state(null, external), state('voice', external));
  assert.ok(log(app).description.includes('(เซิร์ฟเวอร์: \\*\\*Friends\\*\\* Room)'));
});

for (const [name, before, after, title, status] of [
  ['mute', false, true, '🎙️ Microphone Changed', 'Muted 🔇'],
  ['unmute', true, false, '🎙️ Microphone Changed', 'Unmuted 🎤'],
  ['deafen', false, true, '🎧 Deafen Changed', 'Deafened 🔇'],
  ['undeafen', true, false, '🎧 Deafen Changed', 'Undeafened 🎧'],
]) {
  test(`logs ${name} with the new status`, async () => {
    const app = setup();
    const key = name.includes('deafen') ? 'selfDeaf' : 'selfMute';
    await app.emit(state('voice', { [key]: before }), state('voice', { [key]: after }));
    assert.equal(log(app).title, title);
    assert.match(log(app).description, new RegExp(`\\*\\*Status:\\*\\* ${status}`));
    assert.match(log(app).description, /\*\*Channel:\*\* `General`/);
    assert.match(log(app).description, /\*\*Time:\*\* 19:35:24/);
  });
}

test('logs stream start and stop, with placeholder stop duration', async () => {
  const app = setup();
  await app.emit(state('voice'), state('voice', { streaming: true }));
  await app.emit(state('voice', { streaming: true }), state('voice'));
  assert.equal(log(app, 0).title, '📺 Stream Started');
  assert.equal(log(app, 0).description, '> 👤 **User:** Pat\n> 🔊 **Channel:** `General`\n> 📡 **Status:** Streaming\n> 🕒 **Time:** 19:35:24');
  assert.equal(log(app, 1).title, '📺 Stream Stopped');
  assert.equal(log(app, 1).description, '> 👤 **User:** Pat\n> 🔊 **Channel:** `General`\n> ⏱️ **Stream Duration:** Coming soon\n> 🕒 **Time:** 19:35:24');
});

test('logs every changed voice property in one update', async () => {
  const app = setup();
  await app.emit(state('voice'), state('gaming', { selfMute: true, selfDeaf: true, streaming: true }));
  assert.deepEqual(app.messages.map((_, index) => log(app, index).title), [
    '🔄 Voice Moved', '🎙️ Microphone Changed', '🎧 Deafen Changed', '📺 Stream Started',
  ]);
});

for (const [name, oldState, newState] of [
  ['camera changes', state('voice'), { ...state('voice'), selfVideo: true }],
  ['unchanged voice state', state('voice'), state('voice')],
  ['bot accounts', state(null, { bot: true }), state('voice', { bot: true })],
  ['missing members', { channelId: null }, { channelId: 'a' }],
]) {
  test(`ignores ${name}`, async () => {
    const app = setup();
    await app.emit(oldState, newState);
    assert.equal(app.fetchCount, 0);
    assert.deepEqual(app.messages, []);
  });
}

test('rejects a text-based channel that cannot receive messages', async () => {
  const app = setup({ sendable: false });
  await app.emit(state(null), state('a'));
  assert.deepEqual(app.messages, []);
  assert.match(app.errors.join('\n'), /cannot receive text messages/);
});

test('handles channel fetch failures without rejecting the event', async () => {
  const app = setup({ fetchError: new Error('not found') });
  await app.emit(state(null), state('a'));
  assert.deepEqual(app.messages, []);
  assert.match(app.errors.join('\n'), /Failed to fetch log channel/);
});

test('handles send failures without rejecting the event', async () => {
  const app = setup({ sendError: new Error('missing permissions') });
  await app.emit(state(null), state('a'));
  assert.match(app.errors.join('\n'), /missing permissions/);
});

test('binds normal messages with the message-content intents', async () => {
  const app = setup();

  assert.equal(app.hasListener('message'), true);
  assert.equal(app.hasListener('interaction'), false);
  assert.deepEqual(Array.from(app.clientOptions.intents), [1, 2, 4, 8]);
  await app.emitReady();

});
