const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createGeminiModel } = require('./gemini');
const { createRuntime } = require('./runtime');

async function startResearch({ client, env = process.env, logger = console }) {
  const config = loadConfig(env);
  if (!config) return null;
  const store = createStore(config.databasePath);
  let runtime;
  try {
    const model = createGeminiModel({ apiKey: config.geminiApiKey, model: config.geminiModel });
    runtime = createRuntime({ client, store, model, config, logger });
    await runtime.start();
    return runtime;
  } catch (error) {
    if (runtime) await runtime.stop(); else store.close();
    throw error;
  }
}

module.exports = { startResearch };
