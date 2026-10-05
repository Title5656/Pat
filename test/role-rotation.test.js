const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { Collection, PermissionFlagsBits } = require('discord.js');

// Every test runs the real reconciler; only the Discord network boundary is fake.
const load = () => require('../src/roles/rotation');
async function start(options) {
  const runtime = await load().startRoleRotation(options);
  await runtime.tick();
  return runtime;
}
const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';
const D = '100000000000000004';
const DAY = Date.parse('2026-10-05T17:00:00Z'); // Bangkok 2026-10-06 midnight.
const directories = [];
after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'pim-roles-'));
  directories.push(directory);
  const roles = new Collection();
  const members = new Collection();
  const creates = [];
  const batches = [];
  const errors = [];
  let sequence = 10;
  let clock = DAY;
  let callback;
  let cleared = false;
  let fetches = 0;
  const client = new EventEmitter();
  client.isReady = () => true;
  function addRole(id, name, position, extra = {}) {
    const role = { id, name, position, managed: false, editable: true,
      permissions: { bitfield: 0n }, ...extra,
      async setName(name) { this.name = name; return this; },
      async delete() { roles.delete(id); },
    };
    roles.set(id, role);
    return role;
  }
  addRole('guild', '@everyone', 0);
  addRole('pim', 'Pim', 1, { managed: true });
  addRole('pat', 'Pat', 2, { managed: true });
  addRole('title', 'Title', 3, { editable: false });
  const me = { permissions: { has: bit => bit === PermissionFlagsBits.ManageRoles } };
  const guild = { id: 'guild',
    roles: {
      cache: roles,
      async fetch() { return roles; },
      async create(options) {
        creates.push(options);
        for (const role of roles.values()) if (role.position > 0) role.position++;
        return addRole(String(sequence++), options.name, 1, { hoist: options.hoist, mentionable: options.mentionable });
      },
      async setPositions(positions) {
        batches.push(positions);
        const moved = new Set(positions.map(p => p.role));
        const untouched = [...roles.values()].filter(r => r.id !== 'guild' && !moved.has(r.id))
          .sort((a, b) => a.position - b.position);
        for (const { role, position } of positions) roles.get(role).position = position;
        untouched.forEach((role, index) => { role.position = positions.length + index + 1; });
        return guild;
      },
    },
    members: {
      async fetchMe() { return me; },
      async fetch() { fetches++; return members; },
    },
  };
  function addMember(id, name, bot = false) {
    const cache = new Collection();
    const member = { id, displayName: name, user: { bot }, guild,
      roles: { cache, async add(role) { cache.set(role.id, role); } },
    };
    members.set(id, member);
    return member;
  }
  addMember(A, 'Alice'); addMember(B, 'Bob'); addMember(C, 'Carol');
  addMember('bot', 'Pat', true);
  client.guilds = { async fetch(id) { assert.equal(id, 'guild'); return guild; } };
  client.channels = { async fetch(id) { assert.equal(id, 'log'); return { guildId: 'guild' }; } };
  const options = { client, channelId: 'log', databasePath: join(directory, 'roles.sqlite'), now: () => clock,
    logger: { info() {}, error: message => errors.push(message) },
    setIntervalFn(fn, delay) { assert.equal(delay, 60_000); callback = fn; return { unref() {} }; },
    clearIntervalFn() { cleared = true; },
  };
  function order() {
    const owners = new Map();
    for (const member of members.values()) {
      if (!member.user.bot) for (const role of member.roles.cache.values()) owners.set(role.id, member.id);
    }
    return [...roles.values()].filter(r => owners.has(r.id))
      .sort((a, b) => b.position - a.position).map(r => owners.get(r.id));
  }
  function fixedOrder() {
    return [...roles.values()].sort((a, b) => b.position - a.position)
      .slice(0, 3).map(r => r.name);
  }
  return { client, guild, members, roles, me, options, creates, batches, errors, addMember,
    order, fixedOrder, tick: () => callback(), setTime: value => { clock = value; },
    get cleared() { return cleared; }, get fetches() { return fetches; },
  };
}

test('creates one permission-free personal role per human below Title, Pat and Pim', async () => {
  const f = setup();
  const runtime = await start(f.options);
  assert.equal(f.creates.length, 3);
  assert.equal(f.members.get('bot').roles.cache.size, 0);
  for (const id of [A, B, C]) {
    assert.equal(f.members.get(id).roles.cache.size, 1);
    assert.equal([...f.members.get(id).roles.cache.values()][0].name, f.members.get(id).displayName);
  }
  for (const options of f.creates) {
    assert.equal(options.permissions, 0n);
    assert.equal(options.hoist, true);
    assert.equal(options.mentionable, false);
  }
  assert.deepEqual(f.fixedOrder(), ['Title', 'Pat', 'Pim']);
  await runtime.stop();
});

test('moves only the top person to the bottom at Bangkok midnight and wraps the queue', async () => {
  const f = setup();
  const runtime = await start(f.options);
  const first = f.order();
  f.setTime(DAY + 86_400_000 - 1);
  await f.tick();
  assert.deepEqual(f.order(), first);
  assert.equal(f.batches.length, 1);
  f.setTime(DAY + 86_400_000);
  await f.tick();
  assert.deepEqual(f.order(), [first[1], first[2], first[0]]);
  f.setTime(DAY + 3 * 86_400_000);
  await f.tick();
  assert.deepEqual(f.order(), first);
  assert.deepEqual(f.fixedOrder(), ['Title', 'Pat', 'Pim']);
  await runtime.stop();
});

test('restart recovers existing roles without duplicating or rotating the same day', async () => {
  const f = setup();
  const runtime = await start(f.options);
  const first = f.order();
  await runtime.stop();
  const restarted = await start(f.options);
  assert.equal(f.creates.length, 3);
  assert.deepEqual(f.order(), first);
  assert.equal(f.batches.length, 1);
  await restarted.stop();
});

test('join and leave events reconcile membership while duplicate display names stay distinct', async () => {
  const f = setup();
  const runtime = await start(f.options);
  const member = f.addMember(D, 'Alice');
  f.client.emit('guildMemberAdd', member);
  await runtime.tick();
  assert.equal(f.creates.length, 4);
  assert.equal(member.roles.cache.size, 1);
  f.members.delete(B);
  f.client.emit('guildMemberRemove', { id: B, guild: f.guild });
  await runtime.tick();
  assert.deepEqual(new Set(f.order()), new Set([A, C, D]));
  assert.deepEqual(f.fixedOrder(), ['Title', 'Pat', 'Pim']);
  await runtime.stop();
});

test('repairs assignments and renames a recovered personal role after a nickname change', async () => {
  const f = setup();
  const runtime = await start(f.options);
  const member = f.members.get(A);
  member.displayName = 'New Alice';
  member.roles.cache.clear();
  f.client.emit('guildMemberUpdate', {}, member);
  await runtime.tick();
  assert.equal(f.creates.length, 3);
  assert.equal([...member.roles.cache.values()][0].name, 'New Alice');
  await runtime.stop();
});

test('missing Manage Roles does not mutate roles and retries after permission is granted', async () => {
  const f = setup();
  f.me.permissions.has = () => false;
  const runtime = await start(f.options);
  assert.equal(f.creates.length, 0);
  assert.equal(f.batches.length, 0);
  assert.match(f.errors[0], /Manage Roles/);
  f.me.permissions.has = () => true;
  await f.tick();
  assert.equal(f.creates.length, 3);
  await runtime.stop();
});

test('role capacity is checked before creating a partial set', async () => {
  const f = setup();
  for (let index = 0; index < 245; index++) f.roles.set(`other-${index}`, { name: 'Unrelated', id: `other-${index}`, position: index + 4 });
  const runtime = await start(f.options);
  assert.equal(f.creates.length, 0);
  assert.equal(f.batches.length, 0);
  assert.match(f.errors[0], /250/);
  await runtime.stop();
});

test('does not move a personal role above Pim or one with added permissions', async () => {
  for (const change of [{ editable: false }, { permissions: { bitfield: 8n } }]) {
    const f = setup();
    const runtime = await start(f.options);
    Object.assign([...f.members.get(A).roles.cache.values()][0], change);
    f.setTime(DAY + 86_400_000);
    await f.tick();
    assert.equal(f.batches.length, 1);
    assert.ok(f.errors.length > 0);
    await runtime.stop();
  }
});

test('concurrent reconciliations share one flight and recover after an assignment error', async () => {
  const f = setup();
  const member = f.members.get(A);
  const add = member.roles.add;
  let failure = true;
  member.roles.add = async role => { if (failure) throw Object.assign(new Error('secret'), { code: 50013 }); return add(role); };
  const runtime = await start(f.options);
  failure = false;
  await Promise.all([runtime.tick(), runtime.tick(), runtime.tick()]);
  assert.equal(f.creates.length, 3);
  assert.equal(member.roles.cache.size, 1);
  assert.ok(f.errors.every(message => !message.includes('secret')));
  await runtime.stop();
});

test('explicit server selection ignores member events from other servers', async () => {
  const f = setup();
  f.options.guildId = 'guild';
  f.client.channels.fetch = async () => { throw new Error('must not resolve a channel'); };
  const runtime = await start(f.options);
  const before = f.fetches;
  f.client.emit('guildMemberAdd', { id: D, guild: { id: 'other' } });
  await f.tick();
  assert.equal(f.fetches, before);
  await runtime.stop();
});

test('disconnect pauses work and stopping releases all owned resources', async () => {
  const f = setup();
  const runtime = await start(f.options);
  f.client.isReady = () => false;
  f.setTime(DAY + 86_400_000);
  await f.tick();
  assert.equal(f.batches.length, 1);
  f.client.isReady = () => true;
  await f.tick();
  assert.equal(f.batches.length, 2);
  await runtime.stop();
  assert.equal(f.cleared, true);
  assert.equal(f.client.listenerCount('guildMemberAdd'), 0);
  assert.equal(f.client.listenerCount('guildMemberRemove'), 0);
  assert.equal(f.client.listenerCount('guildMemberUpdate'), 0);
  await runtime.tick();
  assert.equal(f.batches.length, 2);
});

test('fresh same-day connections reconcile member changes missed while disconnected', async () => {
  for (const event of ['shardReady', 'guildAvailable']) {
    const f = setup();
    const runtime = await start(f.options);
    await runtime.tick();
    const member = f.addMember(D, 'Dave');
    f.client.emit(event, event === 'guildAvailable' ? f.guild : 0);
    await runtime.tick();
    assert.equal(member.roles.cache.size, 1);
    assert.equal(f.creates.length, 4);
    await runtime.stop();
  }
});

test('deleted personal roles are recreated on the same day', async () => {
  const f = setup();
  const runtime = await start(f.options);
  await runtime.tick();
  const member = f.members.get(A);
  const role = [...member.roles.cache.values()][0];
  f.roles.delete(role.id);
  member.roles.cache.delete(role.id);
  f.client.emit('roleDelete', { ...role, guild: f.guild });
  await runtime.tick();
  assert.equal(f.creates.length, 4);
  assert.equal(member.roles.cache.size, 1);
  assert.equal([...member.roles.cache.values()][0].name, 'Alice');
  await runtime.stop();
});

test('startup returns a stoppable runtime while member fetching is still pending', async () => {
  const f = setup();
  let release;
  f.guild.members.fetch = () => new Promise(resolve => { release = () => resolve(f.members); });
  let runtime;
  const start = load().startRoleRotation(f.options).then(value => { runtime = value; });
  await new Promise(resolve => setImmediate(resolve));
  const returned = Boolean(runtime);
  release();
  await start;
  await runtime.stop();
  assert.equal(returned, true);
});

test('persisted role IDs survive a restart and an offline nickname change without changing role identity', async () => {
  const f = setup();
  const runtime = await start(f.options);
  await runtime.tick();
  const original = [...f.members.get(A).roles.cache.keys()][0];
  await runtime.stop();
  f.members.get(A).displayName = 'Another Alice';
  const restarted = await start(f.options);
  await restarted.tick();
  assert.equal(f.creates.length, 3);
  assert.equal([...f.members.get(A).roles.cache.keys()][0], original);
  assert.equal(f.roles.get(original).name, 'Another Alice');
  await restarted.stop();
});
