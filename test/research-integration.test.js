const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ChannelType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { loadConfig } = require('../src/research/config');
const { createRuntime } = require('../src/research/runtime');
const { createStore } = require('../src/research/store');
const { createAssistant } = require('../src/research/assistant');
const { createMessageHandler } = require('../src/chat/handle-message');
const { createConversation } = require('../src/chat/conversation');
const { createMemory } = require('../src/chat/memory');
const { startResearch } = require('../src/research/feature');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('research is optional and an unchanged Pat environment disables it', () => {
  assert.equal(loadConfig({ DISCORD_TOKEN: 'existing', GEMINI_API_KEY: 'existing' }), null);
});

test('research reuses Pat Gemini configuration and needs no second Discord identity', () => {
  const config = loadConfig({
    PAT_CHAT_CHANNEL_ID: '100000000000000001', PAT_RESEARCH_CHANNEL_ID: '100000000000000002',
    GEMINI_API_KEY: 'existing-key', GEMINI_MODEL: 'existing-model',
  });
  assert.equal(config.geminiApiKey, 'existing-key');
  assert.equal(config.geminiModel, 'existing-model');
  assert.equal(config.qaChannelId, '100000000000000002');
  assert.equal(config.token, undefined);
  assert.equal(config.applicationId, undefined);
});

test('chat and research cannot share a channel and produce conflicting replies', () => {
  assert.throws(() => loadConfig({ PAT_CHAT_CHANNEL_ID: '100000000000000001',
    PAT_RESEARCH_CHANNEL_ID: '100000000000000001',
    GEMINI_API_KEY: 'existing-key' }), /different|distinct/i);
});

test('research starts on the connected Pat client and stopping it leaves Pat connected', async () => {
  const client = new EventEmitter();
  let destroys = 0;
  client.user = { id: 'pat' };
  client.isReady = () => true;
  client.login = async () => { throw new Error('Must not log in a second bot'); };
  client.destroy = async () => { destroys++; };
  const everyone = { id: '10', permissions: new PermissionsBitField([]) };
  const guild = { members: { me: { id: 'pat' } }, roles: { everyone, cache: new Map([['10', everyone]]), fetch: async () => {} } };
  const qa = { type: ChannelType.GuildText, guild, permissionOverwrites: { cache: new Map() },
    permissionsFor: subject => new PermissionsBitField(subject.id === '10' ? [] : [P.ViewChannel, P.ReadMessageHistory, P.SendMessages]) };
  client.channels = { fetch: async () => qa };
  const oldListener = () => {};
  client.on('messageCreate', oldListener);
  const store = createStore(':memory:');
  const runtime = createRuntime({ client, store, model: {}, source: { discover: async () => [] },
    config: { qaChannelId: '20', pagesPerChannel: 1, syncIntervalMs: 60000 },
    logger: { log() {}, warn() {} },
  });
  try {
    await runtime.start();
    assert.equal(runtime.status().ready, true);
  } finally { await runtime.stop(); }
  assert.equal(destroys, 0);
  assert.deepEqual(client.listeners('messageCreate'), [oldListener]);
});

test('normal chat and research answer only their own room and maintain separate histories', async () => {
  const store = createStore(':memory:');
  const evidence = { id: '100', guildId: '10', channelId: '20', guildName: 'Friends', channelName: 'plans', authorId: '30', authorName: 'Alice', content: 'pizza on Friday', createdAt: 1700000000000 };
  store.upsert(evidence);
  const normalInputs = [];
  const searchHistories = [];
  const sent = [];
  const normal = createMessageHandler({ chatChannelId: 'normal', conversation: createConversation({
    memory: createMemory(), generate: async ({ input }) => { normalInputs.push(input); return 'normal answer'; },
  }) });
  const research = createAssistant({ store, source: { refresh: async () => evidence },
    qaChannelId: 'research', status: () => ({ messages: 1, complete: 1, channels: 1 }),
    model: { plan: async ({ history }) => { searchHistories.push([...history]); return ['pizza']; },
      answer: async () => ({ answer: 'นัดวันศุกร์ [1]', sourceIds: [1] }) },
  });
  const deliver = async (channelId, content) => {
    const message = { channelId, guildId: '10', author: { id: 'owner', username: 'Owner', bot: false }, content,
      channel: { sendTyping: async () => {}, send: async payload => sent.push({ channelId, ...payload }) } };
    await Promise.all([normal(message), research.handle(message)]);
  };
  try {
    await deliver('normal', 'hello friend');
    await deliver('research', 'pizza วันไหน');
    await deliver('normal', 'คุยต่อ');
    await deliver('research', 'ใครนัด');
    assert.equal(sent.filter(item => item.channelId === 'normal').length, 2);
    assert.ok(sent.filter(item => item.channelId === 'normal').every(item => item.content === 'normal answer'));
    assert.equal(sent.filter(item => item.channelId === 'research').length, 2);
    assert.match(JSON.stringify(normalInputs[1]), /hello friend/);
    assert.doesNotMatch(JSON.stringify(normalInputs), /pizza|ใครนัด/);
    assert.deepEqual(searchHistories, [[], ['pizza วันไหน']]);
  } finally { await research.stop(); store.close(); }
});

test('disabled feature bootstrap needs no client or second credentials', async () => {
  assert.equal(await startResearch({ env: {} }), null);
});

test('failed feature bootstrap closes its database without logging out Pat', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pat-research-'));
  let destroyed = false;
  const client = new EventEmitter();
  Object.assign(client, { user: { id: 'pat' }, isReady: () => true, channels: { fetch: async () => null },
    destroy: () => { destroyed = true; } });
  try {
    await assert.rejects(startResearch({ client, env: {
      PAT_RESEARCH_CHANNEL_ID: '100000000000000002',
      GEMINI_API_KEY: 'test-key', PAT_RESEARCH_DATABASE_PATH: join(directory, 'research.sqlite'),
    } }), /PAT_RESEARCH_CHANNEL_ID/);
    assert.equal(destroyed, false);
    assert.equal(client.eventNames().length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
