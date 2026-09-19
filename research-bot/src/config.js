const { resolve } = require('node:path');

function loadConfig(env = process.env, directory = resolve(__dirname, '..')) {
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
  const token = required('RESEARCH_DISCORD_TOKEN');
  const applicationId = id('RESEARCH_APPLICATION_ID');
  const qaChannelId = id('RESEARCH_QA_CHANNEL_ID');
  const users = required('RESEARCH_ALLOWED_USER_IDS').split(',').map(value => value.trim());
  if (users.some(value => !/^\d{17,20}$/.test(value))) throw new Error('Invalid RESEARCH_ALLOWED_USER_IDS');
  return {
    token, applicationId, qaChannelId, allowedUserIds: new Set(users),
    geminiApiKey: required('RESEARCH_GEMINI_API_KEY'),
    geminiModel: env.RESEARCH_GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    databasePath: resolve(directory, env.RESEARCH_DATABASE_PATH || 'data/messages.sqlite'),
    syncIntervalMs: integer('RESEARCH_SYNC_INTERVAL_SECONDS', 60, 10, 86400) * 1000,
    pagesPerChannel: integer('RESEARCH_PAGES_PER_CHANNEL', 3, 1, 100),
    port: env.PORT ? integer('PORT', 3000, 1, 65535) : null,
  };
}

function validateIdentity(actual, expected) {
  if (actual !== expected) throw new Error('Discord token does not belong to RESEARCH_APPLICATION_ID');
}

module.exports = { loadConfig, validateIdentity };
