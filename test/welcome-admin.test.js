const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminHandler } = require('../src/admin/handler');
const guildId = '111111111111111111', memberId = '222222222222222222';
function setup(members) {
  const member = { id: memberId, displayName: 'Friend', user: { bot: false, token: 'private' } };
  const guild = { id: guildId, members: members ?? { cache: new Map([[memberId, member]]), fetch: async () => member } };
  return createAdminHandler({ client: { guilds: { cache: new Map([[guildId, guild]]) } }, apiKey: 'key',
    services: { welcomeSource: { inspect: async () => ({ durationMs: 1200 }) } } });
}
async function run(req, members) {
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await setup(members)({ headers: { authorization: 'Bearer key' }, ...req }, res); return res;
}
const listRequest = { method: 'GET', url: `/admin/welcome-members?guildId=${guildId}` };
test('lists uncached offline members across Discord pages without the 200-member cap', async () => {
  const page = new Map(Array.from({ length: 1000 }, (_, i) => {
    const id = String(300000000000000000n + BigInt(999 - i));
    return [id, { id, displayName: `Friend ${i}`, user: { bot: i === 0, username: `user${i}`, token: 'private' } }];
  }));
  const offline = { id: '400000000000000000', displayName: 'Offline friend', user: { bot: false } };
  const calls = [];
  const members = { cache: new Map(), async list(options) {
    calls.push(options); return calls.length === 1 ? page : new Map([[offline.id, offline]]);
  } };
  const r = await run(listRequest, members);
  assert.equal(r.status, 200);
  assert.equal(r.body.members.length, 1000);
  assert.ok(r.body.members.some(m => m.id === offline.id));
  assert.equal(r.body.truncated, false);
  assert.deepEqual(calls, [{ limit: 1000, cache: false }, { limit: 1000, cache: false, after: '300000000000000999' }]);
  assert.ok(r.body.members.every(m => Object.keys(m).sort().join(',') === 'id,name'));
});
test('searches the complete roster by nickname, username, and global name', async () => {
  const member = { id: memberId, displayName: 'Nickname', user: { bot: false, username: 'accountname', globalName: 'Global name' } };
  const members = { cache: new Map(), list: async () => new Map([[memberId, member]]) };
  for (const q of ['nickname', 'ACCOUNTNAME', 'global name']) {
    const r = await run({ ...listRequest, url: `${listRequest.url}&q=${encodeURIComponent(q)}` }, members);
    assert.deepEqual(r.body.members, [{ id: memberId, name: 'Nickname' }]);
  }
});
test('never presents the partial gateway cache as a complete roster after Discord fails', async () => {
  const members = { cache: new Map([[memberId, { id: memberId, displayName: 'Cached', user: { bot: false } }]]),
    list: async () => { throw Object.assign(new Error('private error'), { code: 50001 }); } };
  const r = await run(listRequest, members);
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'WELCOME_UNAVAILABLE' });
});
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
