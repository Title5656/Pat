const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../index.js'), 'utf8');

function setup({ sendable = true, fetchError, sendError } = {}) {
  const messages = [];
  const errors = [];
  const listeners = new Map();
  const commandRegistrations = [];
  let fetchCount = 0;
  class Client {
    application = { commands: {} };
    channels = {
      fetch: async () => {
        fetchCount++;
        if (fetchError) throw fetchError;
        return {
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
          GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 2 },
          Events: {
            ClientReady: 'ready',
            InteractionCreate: 'interaction',
            VoiceStateUpdate: 'voice',
          },
        };
      }
      if (id === './src/chat/command') {
        return {
          registerPatCommand: async (application, guildId) => {
            commandRegistrations.push([application, guildId]);
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
      if (id === './src/chat/handle-pat') {
        return { createPatHandler: () => async () => {} };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: {
      env: {
        DISCORD_TOKEN: 'test-token',
        DISCORD_GUILD_ID: 'guild',
        VOICE_LOG_CHANNEL_ID: 'log',
        GEMINI_API_KEY: 'key',
        GEMINI_MODEL: 'model',
      },
    },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
  });
  return {
    messages, errors, commandRegistrations,
    get fetchCount() { return fetchCount; },
    emitReady: () => listeners.get('ready')({
      application: { commands: {} },
      user: { tag: 'Pat#0001' },
    }),
    hasListener: (event) => listeners.has(event),
    emit: (oldState, newState) => listeners.get('voice')(oldState, newState),
  };
}

function state(channelId, bot = false) {
  return { channelId, member: { id: 'user', displayName: 'Pat', user: { bot } } };
}

test('logs a join with the display name and disables mentions', async () => {
  const app = setup();
  await app.emit(state(null), state('voice'));
  assert.equal(app.messages[0].content, '> 🟢 **เข้าห้อง:** <#voice>\n> 👤 Pat\n_ _');
  assert.equal(JSON.stringify(app.messages[0].allowedMentions), '{"parse":[]}');
});

test('logs a leave and falls back to the old member', async () => {
  const app = setup();
  await app.emit(state('voice'), { channelId: null, member: null });
  assert.equal(app.messages[0].content, '> 🔴 **ออกจากห้อง:** <#voice>\n> 👤 Pat\n_ _');
  assert.equal(JSON.stringify(app.messages[0].allowedMentions), '{"parse":[]}');
});

for (const [name, oldState, newState] of [
  ['channel moves', state('a'), state('b')],
  ['microphone, camera and stream changes', state('a'), { ...state('a'), selfMute: true, selfVideo: true, streaming: true }],
  ['bot accounts', state(null, true), state('a', true)],
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

test('registers /pat on ready and binds the interaction listener', async () => {
  const app = setup();

  assert.equal(app.hasListener('interaction'), true);
  await app.emitReady();

  assert.equal(app.commandRegistrations.length, 1);
  assert.equal(app.commandRegistrations[0][1], 'guild');
});
