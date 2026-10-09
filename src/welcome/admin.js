async function handleWelcomeAdmin({ req, res, client, services, send }) {
  const url = new URL(req.url, 'https://bot.local');
  if (url.pathname === '/admin/welcome-members') {
    if (req.method !== 'GET') { send(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    const guildId = url.searchParams.get('guildId');
    const guild = /^\d{17,20}$/.test(guildId ?? '') && client.guilds.cache.get(guildId);
    if (!guild) { send(res, 404, { error: 'MEMBER_NOT_FOUND' }); return; }
    const query = (url.searchParams.get('q') || '').slice(0, 80).toLowerCase();
    let members;
    if (/^\d{17,20}$/.test(query)) {
      const member = await guild.members.fetch(query).catch(() => null);
      members = member && !member.user?.bot ? [member] : [];
    } else members = [...(guild.members.cache?.values() ?? [])].filter(m => !m.user?.bot
      && (!query || (m.displayName ?? m.user?.username ?? '').toLowerCase().includes(query)));
    send(res, 200, { members: members.slice(0, 200).map(m => ({ id: m.id, name: m.displayName ?? m.user?.username ?? m.id })), truncated: members.length > 200 });
    return;
  }
  if (req.method !== 'POST') { send(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
  let body = req.body;
  if (body && Buffer.byteLength(JSON.stringify(body)) > 4096) throw new Error('BODY_LIMIT');
  if (!body) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) throw new Error('BODY_LIMIT'); }
    body = JSON.parse(text);
  }
  const source = services.welcomeSource ?? require('./source').createWelcomeSource();
  send(res, 200, await source.inspect(body?.url));
}
module.exports = { handleWelcomeAdmin };
