const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../index.js'), 'utf8');

function setup({ sendable = true, fetchError, sendError, port, researchChannelId, researchStartError, destroyImpl, loginImpl, messageHandlerImpl, timePoints } = {}) {
  const messages = [];
  const errors = [];
  const logs = [];
  const warnings = [];
  let clockRead = 0;
  const listeners = new Map();
  let clientOptions;
  let createdClient;
  const researchClients = [];
  let loginCount = 0;
  const signals = new Map();
  const shutdownState = { deadlineCleared: false, exitCode: null };
  let httpHandler;
  let fetchCount = 0;
  const fetchedChannelIds = [];
  let loginTimeout;
  let ready = false;
  class Client {
    constructor(options) { clientOptions = options; createdClient = this; }
    rest = { options: { makeRequest: async () => ({ status: 200 }) }, on() {} };
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
    isReady() { return ready; }
    login() { loginCount++; return loginImpl?.() ?? Promise.resolve(); }
    async destroy() { await destroyImpl?.(); }
  }
  vm.runInNewContext(source, {
    require: (id) => {
      if (id === 'discord.js') {
        return {
          Client,
          Partials: { Message: 'partial-message', Channel: 'partial-channel' },
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
        return { createMessageHandler: () => messageHandlerImpl ?? (async () => {}) };
      }
      if (id === './src/research/feature') {
        return { startResearch: async ({ client }) => {
          researchClients.push(client);
          if (researchStartError) throw researchStartError;
          return { stop: async () => {} };
        } };
      }
      if (id === 'node:http') {
        return { createServer: (handler) => {
          httpHandler = handler;
          return { listen() {} };
        } };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    process: {
      once(signal, listener) { signals.set(signal, listener); },
      exit(code) { shutdownState.exitCode = code; },
      env: {
        DISCORD_TOKEN: 'test-token',
        PAT_CHAT_CHANNEL_ID: 'chat-room',
        VOICE_LOG_CHANNEL_ID: 'log',
        GEMINI_API_KEY: 'key',
        GEMINI_MODEL: 'model',
        PORT: port,
        PAT_RESEARCH_CHANNEL_ID: researchChannelId,
      },
    },
    Date: class extends Date {
      constructor() { super('2026-09-18T12:35:24Z'); }
      static now() { return timePoints?.[Math.min(clockRead++, timePoints.length - 1)] ?? Date.now(); }
    },
    URL,
    setTimeout: (callback, delay) => {
      if (delay === 15 * 60_000) loginTimeout = callback;
      return { delay, unref() {} };
    },
    clearTimeout: timer => {
      if (timer?.delay === 20_000) shutdownState.deadlineCleared = true;
    },
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')), warn: (...args) => warnings.push(args.join(' ')) },
  });
  return {
    messages, errors, logs, warnings, fetchedChannelIds,
    researchClients,
    shutdownState,
    emitSignal: signal => signals.get(signal)(),
    get createdClient() { return createdClient; },
    get loginCount() { return loginCount; },
    get clientOptions() { return clientOptions; },
    get fetchCount() { return fetchCount; },
    triggerLoginTimeout: () => loginTimeout?.(),
    emitMessage: message => listeners.get('message')(message),
    emitReady: () => {
      ready = true;
      return listeners.get('ready')({
        application: { commands: {} },
        user: { tag: 'Pat#0001' },
      });
    },
    hasListener: (event) => listeners.has(event),
    emit: (oldState, newState) => listeners.get('voice')(oldState, newState),
    request: (url) => {
      let finish;
      const response = {
        body: '',
        once(event, listener) { if (event === 'finish') finish = listener; },
        writeHead(status, headers) { this.status = this.statusCode = status; this.headers = headers; },
        end(body) { this.body = body; finish?.(); },
      };
      httpHandler({ method: 'GET', url }, response);
      return response;
    },
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
  assert.equal(app.messages.length, 6);
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
]) {
  test(`logs ${name} with the new status`, async () => {
    const app = setup();
    await app.emit(state('voice', { selfMute: before }), state('voice', { selfMute: after }));
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

test('logs supported voice changes while ignoring deafen', async () => {
  const app = setup();
  await app.emit(state('voice'), state('gaming', { selfMute: true, selfDeaf: true, streaming: true }));
  assert.deepEqual(app.messages.map((_, index) => log(app, index).title), [
    '🔄 Voice Moved', '🎙️ Microphone Changed', '📺 Stream Started',
  ]);
});

for (const [name, oldState, newState] of [
  ['camera changes', state('voice'), { ...state('voice'), selfVideo: true }],
  ['deafen changes', state('voice'), state('voice', { selfDeaf: true })],
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

test('reports Discord readiness to Render health checks', async () => {
  const app = setup({ port: '3000' });
  const health = app.request('/health');
  const disconnected = app.request('/ready');

  assert.equal(health.status, 200);
  assert.equal(health.body, 'ok');
  assert.equal(disconnected.status, 503);
  assert.equal(disconnected.headers['content-type'], 'text/plain');
  assert.equal(disconnected.body, 'discord disconnected');

  await app.emitReady();
  const ready = app.request('/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body, 'ok');
  assert.deepEqual(app.logs, [
    'HTTP REQ GET /health', 'HTTP RES GET /health 200',
    'HTTP REQ GET /ready', 'Discord gateway status=unknown', 'HTTP RES GET /ready 503',
    'Ready! Logged in as Pat#0001',
    'HTTP REQ GET /ready', 'Discord gateway status=unknown', 'HTTP RES GET /ready 200',
  ]);
});

test('logs fallback requests and responses', () => {
  const app = setup({ port: '3000' });
  const response = app.request('/');

  assert.equal(response.status, 503);
  assert.deepEqual(app.logs, ['HTTP REQ GET /', 'HTTP RES GET / 503']);
});

test('reports slow Discord HTTP separately without leaking channel IDs or query strings', async () => {
  const app = setup({ timePoints: [1000, 3500] });
  const response = await app.createdClient.rest.options.makeRequest(
    'https://discord.com/api/v10/channels/1550774757803171870/messages?token=private',
    { method: 'GET' },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(app.warnings, [
    'Discord REST HTTP; method=GET; path=/api/v10/channels/:id/messages; status=200; elapsedMs=2500',
  ]);
});

test('research attaches to the same Pat connection only after Discord is ready', async () => {
  const app = setup({ researchChannelId: 'research-room' });
  assert.equal(app.researchClients.length, 0);
  await app.emitReady();
  assert.deepEqual(app.researchClients, [app.createdClient]);
  assert.equal(app.loginCount, 1);
  assert.deepEqual(Array.from(app.clientOptions.partials), ['partial-message', 'partial-channel']);
});

test('keeps login alive beyond the old fifteen-minute deadline', async () => {
  let finishLogin;
  let destroyed = false;
  const app = setup({
    loginImpl: () => new Promise(resolve => { finishLogin = resolve; }),
    destroyImpl: () => { destroyed = true; },
  });

  app.triggerLoginTimeout();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, false);
  assert.equal(app.shutdownState.exitCode, null);
  finishLogin();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.loginCount, 1);
  assert.equal(app.shutdownState.exitCode, null);
});

test('unexpected chat failures log only an error code', async () => {
  const app = setup({ messageHandlerImpl: async () => {
    throw Object.assign(new Error('token=private-value'), { code: 'EFAIL' });
  } });

  app.emitMessage({ id: 'message-1', channelId: 'chat-room' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.errors.join('\n'), /code=EFAIL/);
  assert.doesNotMatch(app.errors.join('\n'), /private-value/);
});

test('failed research initialization leaves original voice and chat listeners working', async () => {
  const app = setup({ researchChannelId: 'research-room', researchStartError: new Error('bad research config') });
  await app.emitReady();
  assert.match(app.errors.join('\n'), /research/i);
  assert.equal(app.hasListener('message'), true);
  await app.emit(state(null), state('voice'));
  assert.equal(app.messages.length, 1);
});

test('shutdown retains its deadline until the shared Discord client has disconnected', async () => {
  let finishDisconnect;
  const disconnect = new Promise(resolve => { finishDisconnect = resolve; });
  const app = setup({ researchChannelId: 'research-room', destroyImpl: () => disconnect });
  await app.emitReady();
  app.emitSignal('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.shutdownState.deadlineCleared, false);
  assert.equal(app.shutdownState.exitCode, null);
  finishDisconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.shutdownState.exitCode, 0);
});
