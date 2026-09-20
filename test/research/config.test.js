const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { loadConfig } = require('../../src/research/config');

const env = { PAT_RESEARCH_CHANNEL_ID: '100000000000000002', GEMINI_API_KEY: 'existing-key' };

test('research configuration ignores obsolete second-bot credentials and resolves the shared project data path', () => {
  const config = loadConfig({ ...env, RESEARCH_DISCORD_TOKEN: 'obsolete-token', RESEARCH_GEMINI_API_KEY: 'obsolete-key' }, '/pat');
  assert.equal(config.token, undefined);
  assert.equal(config.geminiApiKey, 'existing-key');
  assert.equal(config.databasePath, resolve('/pat', 'data', 'research.sqlite'));
  assert.equal(config.contextBefore, 2);
  assert.equal(config.contextAfter, 2);
});

test('enabled research rejects missing API keys, malformed IDs and invalid limits', () => {
  assert.throws(() => loadConfig({ ...env, GEMINI_API_KEY: '' }), /GEMINI_API_KEY/);
  assert.throws(() => loadConfig({ ...env, PAT_RESEARCH_CHANNEL_ID: 'not-an-id' }), /PAT_RESEARCH_CHANNEL_ID/);
  assert.throws(() => loadConfig({ ...env, PAT_RESEARCH_PAGES_PER_CHANNEL: '0' }), /PAT_RESEARCH_PAGES_PER_CHANNEL/);
  assert.throws(() => loadConfig({ ...env, PAT_RESEARCH_CONTEXT_BEFORE: '-1' }), /PAT_RESEARCH_CONTEXT_BEFORE/);
  assert.throws(() => loadConfig({ ...env, PAT_RESEARCH_CONTEXT_AFTER: '11' }), /PAT_RESEARCH_CONTEXT_AFTER/);
});

test('conversation context window can be configured independently in each direction', () => {
  const config = loadConfig({ ...env, PAT_RESEARCH_CONTEXT_BEFORE: '1', PAT_RESEARCH_CONTEXT_AFTER: '4' }, '/pat');
  assert.equal(config.contextBefore, 1);
  assert.equal(config.contextAfter, 4);
});

test('a mounted database path can be selected without moving the application', () => {
  const file = resolve('/disk', 'pat.sqlite');
  assert.equal(loadConfig({ ...env, PAT_RESEARCH_DATABASE_PATH: file }, '/pat').databasePath, file);
});
