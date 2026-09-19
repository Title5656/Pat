const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { loadConfig, validateIdentity } = require('../src/config');

const env = { RESEARCH_DISCORD_TOKEN: 'new-token', RESEARCH_APPLICATION_ID: '100000000000000001', RESEARCH_QA_CHANNEL_ID: '100000000000000002', RESEARCH_ALLOWED_USER_IDS: '100000000000000003,100000000000000004', RESEARCH_GEMINI_API_KEY: 'new-key' };

test('configuration uses only new credentials and resolves its own database', () => {
  const config = loadConfig({ ...env, DISCORD_TOKEN: 'old-token', GEMINI_API_KEY: 'old-key', PAT_CHAT_CHANNEL_ID: 'old-channel' }, '/research');
  assert.equal(config.token, 'new-token');
  assert.equal(config.geminiApiKey, 'new-key');
  assert.equal(config.allowedUserIds.size, 2);
  assert.equal(config.databasePath, resolve('/research', 'data', 'messages.sqlite'));
});

test('old Pat credentials, empty allowlists, malformed IDs and invalid limits cannot start the bot', () => {
  assert.throws(() => loadConfig({ DISCORD_TOKEN: 'old-token', GEMINI_API_KEY: 'old-key' }), /RESEARCH_DISCORD_TOKEN/);
  assert.throws(() => loadConfig({ ...env, RESEARCH_ALLOWED_USER_IDS: '' }), /RESEARCH_ALLOWED_USER_IDS/);
  assert.throws(() => loadConfig({ ...env, RESEARCH_QA_CHANNEL_ID: 'not-an-id' }), /RESEARCH_QA_CHANNEL_ID/);
  assert.throws(() => loadConfig({ ...env, RESEARCH_PAGES_PER_CHANNEL: '0' }), /RESEARCH_PAGES_PER_CHANNEL/);
});

test('a token for a different bot application is rejected before indexing', () => {
  assert.throws(() => validateIdentity('wrong-bot', 'new-bot'), /application/i);
  assert.doesNotThrow(() => validateIdentity('new-bot', 'new-bot'));
});
