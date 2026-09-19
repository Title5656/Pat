const { join } = require('node:path');
const { createServer } = require('node:http');
const { Client, GatewayIntentBits: I, Partials, Options } = require('discord.js');
const { loadConfig } = require('./src/config');
const { createStore } = require('./src/store');
const { createGeminiModel } = require('./src/gemini');
const { createRuntime } = require('./src/runtime');

async function main() {
  try { process.loadEnvFile(join(__dirname, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = loadConfig();
  const client = new Client({
    intents: [I.Guilds, I.GuildMessages, I.MessageContent],
    partials: [Partials.Message, Partials.Channel],
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
    rest: { timeout: 15000 },
  });
  client.on('error', error => console.warn(`Discord client error; code=${error.code ?? error.name}`));
  const store = createStore(config.databasePath);
  const model = createGeminiModel({ apiKey: config.geminiApiKey, model: config.geminiModel });
  const runtime = createRuntime({ client, store, model, config });
  let health;
  if (config.port) {
    health = createServer((req, res) => {
      if (req.url !== '/health' && req.url !== '/') { res.writeHead(404); res.end(); return; }
      const ready = runtime.status().ready;
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ready }));
    }).listen(config.port, '0.0.0.0');
  }
  async function shutdown(exitCode = 0) {
    const deadline = setTimeout(() => process.exit(exitCode || 1), 20000);
    deadline.unref();
    health?.close();
    try { await runtime.stop(); } finally { clearTimeout(deadline); process.exitCode = exitCode; }
  }
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  try { await runtime.start(); } catch (error) {
    await shutdown(1);
    throw error;
  }
}

if (require.main === module) {
  main().catch(error => {
    // Configuration messages name fields only. External errors can contain secrets.
    const message = /^(Missing RESEARCH_|Invalid (RESEARCH_|PORT)|Discord token does not belong|RESEARCH_QA_CHANNEL_ID)/.test(error.message)
      ? error.message : `Startup failed; code=${error.code ?? error.name ?? 'unknown'}`;
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = { main };
