const { resolve } = require('node:path');
const { RESEARCH_LIMITS } = require('./limits');

function loadConfig(env = process.env, directory = resolve(__dirname, '../..')) {
  if (!env.PAT_RESEARCH_CHANNEL_ID?.trim()) return null;
  function required(name) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  }
  function id(name) {
    const value = required(name);
    if (!/^\d{17,20}$/.test(value)) throw new Error(`Invalid ${name}: expected Discord ID`);
    return value;
  }
  function integer(name, fallback, min, max) {
    const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected ${min}..${max}`);
    return value;
  }
  const qaChannelId = id('PAT_RESEARCH_CHANNEL_ID');
  if (qaChannelId === env.PAT_CHAT_CHANNEL_ID?.trim()) throw new Error('PAT_RESEARCH_CHANNEL_ID must be different from PAT_CHAT_CHANNEL_ID');
  return {
    qaChannelId,
    geminiApiKey: required('GEMINI_API_KEY'),
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    databasePath: resolve(directory, env.PAT_RESEARCH_DATABASE_PATH || 'data/research.sqlite'),
    syncIntervalMs: integer('PAT_RESEARCH_SYNC_INTERVAL_SECONDS', 60, 10, 86400) * 1000,
    pagesPerChannel: integer('PAT_RESEARCH_PAGES_PER_CHANNEL', 3, 1, 100),
    contextBefore: integer('PAT_RESEARCH_CONTEXT_BEFORE', RESEARCH_LIMITS.contextBefore, 0, RESEARCH_LIMITS.maxContextMessages),
    contextAfter: integer('PAT_RESEARCH_CONTEXT_AFTER', RESEARCH_LIMITS.contextAfter, 0, RESEARCH_LIMITS.maxContextMessages),
  };
}

module.exports = { loadConfig };
