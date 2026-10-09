const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminHandler } = require('../src/admin/handler');

function response() {
  return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body; } };
}
const client = { isReady: () => true, uptime: 9000, ws: { ping: 22 }, user: { id: 'bot', username: 'Pim', displayAvatarURL: () => null }, guilds: { cache: new Map() } };
test('populated snapshots expose guild, role and music state without private source fields', async () => {
  const queue = { channelId: 'voice', current: { title: 'Now playing', duration: 120 }, upcoming: [{ title: 'Next', duration: 180 }] };
  const roles = { guildId: 'guild', timezone: 'Asia/Bangkok', entries: [{ userId: 'member', roleId: 'role', name: 'Member', position: 2 }] };
  const guild = { id: 'guild', name: 'Community', memberCount: 10, token: 'private-source-token',
    channels: { cache: new Map([['voice', { id: 'voice', name: 'Lounge', type: 2, members: new Map([['member', {}]]) }], ['thread', { id: 'thread', name: 'Private thread', isThread: () => true }]]) },
    members: { me: { permissions: { has: bit => bit === 268435456n } } } };
  const handler = createAdminHandler({ client: { ...client, guilds: { cache: new Map([['guild', guild]]) } }, apiKey: 'test-key',
    env: { DISCORD_TOKEN: 'private-discord-token', GEMINI_API_KEY: 'private-gemini-key', PAT_CHAT_CHANNEL_ID: 'chat' },
    services: { roleRotation: { snapshot: () => roles }, music: { snapshot: guildId => { assert.equal(guildId, 'guild'); return queue; } } } });
  const res = response();
  await handler({ url: '/admin/overview', method: 'GET', headers: { authorization: 'Bearer test-key' } }, res);
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(data.guilds[0].name, 'Community');
  assert.deepEqual(data.guilds[0].channels, [{ id: 'voice', name: 'Lounge', type: 2, listeners: 1 }]);
  assert.deepEqual(data.guilds[0].permissions, { manageRoles: true, viewAuditLog: false });
  assert.deepEqual(data.guilds[0].music, queue);
  assert.deepEqual(data.roles, roles);
  assert.equal(data.config.musicRunning, true);
  assert.equal(data.config.rolesRunning, true);
  assert.equal(res.body.includes('private-'), false);
});
test('snapshot exceptions return a safe unavailable response', async () => {
  const handler = createAdminHandler({ client, apiKey: 'test-key', services: { roleRotation: { snapshot() { throw new Error('private-database-path-and-key'); } } } });
  const res = response();
  await handler({ url: '/admin/overview', method: 'GET', headers: { authorization: 'Bearer test-key' } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(res.body), { error: 'SNAPSHOT_UNAVAILABLE' });
});
test('admin routes fail closed when the key is not configured', async () => {
  const handler = createAdminHandler({ client, apiKey: '' });
  const res = response();
  assert.equal(await handler({ url: '/admin/overview', method: 'GET', headers: {} }, res), true);
  assert.equal(res.statusCode, 503);
});
test('unauthorized requests cannot read the snapshot', async () => {
  const handler = createAdminHandler({ client, apiKey: 'test-key' });
  for (const authorization of ['', 'Bearer wrong', 'Basic test-key']) {
    const res = response();
    await handler({ url: '/admin/overview', method: 'GET', headers: { authorization } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.includes('Pim'), false);
  }
});
test('authorized snapshot contains operational data and excludes credentials', async () => {
  const handler = createAdminHandler({ client, apiKey: 'test-key', env: { GEMINI_API_KEY: 'never-expose', GEMINI_MODEL: 'gemini-flash-latest', DISCORD_TOKEN: 'never-expose' } });
  const res = response();
  await handler({ url: '/admin/overview', method: 'GET', headers: { authorization: 'Bearer test-key' } }, res);
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.bot.name, 'Pim');
  assert.equal(data.bot.ready, true);
  assert.equal(data.config.model, 'gemini-flash-latest');
  assert.equal(res.body.includes('never-expose'), false);
  assert.equal(res.body.includes('test-key'), false);
  assert.equal(res.headers['cache-control'], 'no-store');
});
test('admin handler does not consume existing health routes and refuses writes', async () => {
  const handler = createAdminHandler({ client, apiKey: 'test-key' });
  assert.equal(await handler({ url: '/health', method: 'GET', headers: {} }, response()), false);
  const res = response();
  await handler({ url: '/admin/overview', method: 'POST', headers: { authorization: 'Bearer test-key' } }, res);
  assert.equal(res.statusCode, 405);
});
