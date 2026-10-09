const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminHandler } = require('../src/admin/handler');
const guildId = '111111111111111111', memberId = '222222222222222222';
function setup() {
  const member = { id: memberId, displayName: 'Friend', user: { bot: false, token: 'private' } };
  const guild = { id: guildId, members: { cache: new Map([[memberId, member]]), fetch: async () => member } };
  return createAdminHandler({ client: { guilds: { cache: new Map([[guildId, guild]]) } }, apiKey: 'key',
    services: { welcomeSource: { inspect: async () => ({ durationMs: 1200 }) } } });
}
async function run(req) {
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await setup()({ headers: { authorization: 'Bearer key' }, ...req }, res); return res;
}
test('lists only safe member fields and resolves a specific guild member', async () => {
  const r = await run({ method: 'GET', url: `/admin/welcome-members?guildId=${guildId}&q=${memberId}` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.members, [{ id: memberId, name: 'Friend' }]);
});
test('unknown guild IDs cannot return members', async () => {
  const r = await run({ method: 'GET', url: '/admin/welcome-members?guildId=333333333333333333' });
  assert.equal(r.status, 404);
});
test('server audio validation uses the private admin boundary', async () => {
  const r = await run({ method: 'POST', url: '/admin/welcome-validate', body: { url: 'https://s3.us-west-004.backblazeb2.com/bucket/hello' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.durationMs, 1200);
  const denied = await run({ method: 'POST', url: '/admin/welcome-validate', headers: {}, body: { url: 'private' } });
  assert.equal(denied.status, 401);
});
