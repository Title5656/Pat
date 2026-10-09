const rosters = new WeakMap();
async function memberRoster(guild) {
  const manager = guild.members;
  const cached = rosters.get(manager);
  if (cached?.pending) return cached.pending;
  if (cached?.expiresAt > Date.now()) return cached.members;
  const entry = {};
  entry.pending = (async () => {
    const all = new Map();
    let after;
    for (;;) {
      const page = await manager.list({ limit: 1000, cache: false, ...(after ? { after } : {}) });
      for (const [id, member] of page) all.set(id, member);
      if (page.size < 1000) break;
      const next = [...page.keys()].reduce((max, id) => BigInt(id) > BigInt(max) ? id : max, '0');
      if (after && BigInt(next) <= BigInt(after)) throw new Error('MEMBER_PAGE_STALLED');
      after = next;
    }
    entry.members = [...all.values()].filter(m => !m.user?.bot).map(m => ({
      id: m.id, name: m.displayName ?? m.user?.username ?? m.id,
      search: [m.displayName, m.user?.username, m.user?.globalName].filter(Boolean).join('\n').toLowerCase(),
    }));
    entry.expiresAt = Date.now() + 30000;
    return entry.members;
  })();
  rosters.set(manager, entry);
  try { return await entry.pending; }
  catch (error) { rosters.delete(manager); throw error; }
  finally { delete entry.pending; }
}
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
      const member = await guild.members.fetch({ user: query, force: true }).catch(error => {
        if (error.code === 10007) return null;
        throw error;
      });
      members = member && !member.user?.bot ? [member] : [];
    } else members = (await memberRoster(guild)).filter(m => !query || m.search.includes(query));
    send(res, 200, { members: members.map(m => ({ id: m.id, name: m.name ?? m.displayName ?? m.user?.username ?? m.id })), truncated: false });
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
