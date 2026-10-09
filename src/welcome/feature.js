const { Events } = require('discord.js');
const { createWelcomeManager } = require('./player');
const { createWelcomeSource } = require('./source');
function startWelcome({ client, env = process.env, musicBusy, fetchFn = fetch, logger = console, source, manager } = {}) {
  if (env.PIM_WELCOME_ENABLED?.trim().toLowerCase() === 'false' || !env.PIM_BACKOFFICE_URL || !env.PIM_ADMIN_API_KEY) return null;
  const endpoint = new URL(env.PIM_BACKOFFICE_URL);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash
    || !['', '/'].includes(endpoint.pathname) || /^(localhost|127\.|0\.|10\.|192\.168\.|\[)/i.test(endpoint.hostname)) throw new Error('WELCOME_ENDPOINT_INVALID');
  manager ||= createWelcomeManager({ source: source ?? createWelcomeSource({ fetchFn }), musicBusy, botUserId: client.user.id, logger,
    resolve: async (guildId, memberId, signal) => {
      const url = `${endpoint.origin}/api/backoffice?action=welcome-resolve&guildId=${guildId}&memberId=${memberId}`;
      const response = await fetchFn(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: { authorization: `Bearer ${env.PIM_ADMIN_API_KEY}` } });
      if (!response.ok) throw new Error('WELCOME_LOOKUP_FAILED');
      const { sound } = await response.json();
      if (sound && (!Number.isFinite(sound.durationMs) || sound.durationMs <= 0 || sound.durationMs > 15000)) throw new Error('WELCOME_SOUND_INVALID');
      return sound;
    } });
  const onVoice = (oldState, newState) => manager.voiceStateUpdate(oldState, newState);
  client.on(Events.VoiceStateUpdate, onVoice);
  return { cancelGuild: id => manager.cancelGuild(id), stop() { client.removeListener(Events.VoiceStateUpdate, onVoice); manager.shutdown(); } };
}
module.exports = { startWelcome };
