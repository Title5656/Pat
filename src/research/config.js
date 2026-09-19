const { resolve } = require('node:path');

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
  const users = required('PAT_RESEARCH_ALLOWED_USER_IDS').split(',').map(value => value.trim());
  if (users.some(value => !/^\d{17,20}$/.test(value))) throw new Error('Invalid PAT_RESEARCH_ALLOWED_USER_IDS');
  return {
    qaChannelId, allowedUserIds: new Set(users),
    geminiApiKey: required('GEMINI_API_KEY'),
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    databasePath: resolve(directory, env.PAT_RESEARCH_DATABASE_PATH || 'data/research.sqlite'),
    syncIntervalMs: integer('PAT_RESEARCH_SYNC_INTERVAL_SECONDS', 60, 10, 86400) * 1000,
    pagesPerChannel: integer('PAT_RESEARCH_PAGES_PER_CHANNEL', 3, 1, 100),
  };
}

module.exports = { loadConfig };
