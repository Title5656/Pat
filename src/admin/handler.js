const { timingSafeEqual } = require('node:crypto');

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function createAdminHandler({ client, apiKey = process.env.PIM_ADMIN_API_KEY?.trim(), env = process.env, services = {} }) {
  return async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/admin/')) return false;
    if (!apiKey) { send(res, 503, { error: 'ADMIN_DISABLED' }); return true; }
    if (!equal(req.headers.authorization ?? '', `Bearer ${apiKey}`)) { send(res, 401, { error: 'UNAUTHORIZED' }); return true; }
    if (path === '/admin/welcome-members' || path === '/admin/welcome-validate') {
      try { await require('../welcome/admin').handleWelcomeAdmin({ req, res, client, services, send }); }
      catch (error) {
        const code = ['AUDIO_INVALID', 'AUDIO_TOO_LONG', 'FILE_TOO_LARGE', 'AUDIO_URL'].includes(error.code) ? error.code : 'WELCOME_UNAVAILABLE';
        send(res, code === 'WELCOME_UNAVAILABLE' ? 503 : 400, { error: code });
      }
      return true;
    }
    if (req.method !== 'GET') { send(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }
    if (path !== '/admin/overview') { send(res, 404, { error: 'NOT_FOUND' }); return true; }
    try {
      const guilds = [...client.guilds.cache.values()].map(guild => ({
        id: guild.id, name: guild.name, icon: guild.iconURL?.() ?? null,
        memberCount: guild.memberCount ?? null, available: guild.available !== false,
        channels: [...(guild.channels?.cache?.values() ?? [])].filter(channel => !channel.isThread?.()).map(channel => ({
          id: channel.id, name: channel.name, type: channel.type,
          listeners: channel.members?.size ?? null,
        })),
        permissions: {
          manageRoles: guild.members?.me?.permissions?.has(268435456n) ?? false,
          viewAuditLog: guild.members?.me?.permissions?.has(128n) ?? false,
        },
        music: services.music?.snapshot?.(guild.id) ?? null,
      }));
      send(res, 200, {
        updatedAt: new Date().toISOString(),
        bot: { id: client.user?.id, name: client.user?.username ?? 'Pim', avatar: client.user?.displayAvatarURL?.() ?? null,
          ready: client.isReady(), uptimeMs: client.uptime ?? null, pingMs: client.ws?.ping >= 0 ? client.ws.ping : null },
        guilds,
        roles: services.roleRotation?.snapshot?.() ?? null,
        config: {
          model: env.GEMINI_MODEL || 'gemini-flash-latest', timezone: 'Asia/Bangkok',
          chatChannelId: env.PAT_CHAT_CHANNEL_ID || null, voiceLogChannelId: env.VOICE_LOG_CHANNEL_ID || null,
          researchChannelId: env.PAT_RESEARCH_CHANNEL_ID || null, stopwatchChannelId: env.PAT_STOPWATCH_CHANNEL_ID || null,
          chatConfigured: Boolean(env.GEMINI_API_KEY && env.PAT_CHAT_CHANNEL_ID),
          researchRunning: Boolean(services.research), rolesRunning: Boolean(services.roleRotation), musicRunning: Boolean(services.music),
          welcomeRunning: Boolean(services.welcome),
        },
      });
    } catch {
      send(res, 503, { error: 'SNAPSHOT_UNAVAILABLE' });
    }
    return true;
  };
}
module.exports = { createAdminHandler };
