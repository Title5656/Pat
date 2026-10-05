const { PermissionFlagsBits, Events } = require('discord.js');
const { createRoleStore } = require('./store');

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;
const REASON = 'Pim daily personal role rotation';

class RoleRotationError extends Error {}

function roleName(member) {
  const name = (member.displayName || member.user.username || member.id)
    .replace(/\s+/gu, ' ').trim() || member.id;
  // Discord's role name limit; avoid splitting an emoji's surrogate pair.
  return name.slice(0, 100).replace(/[\uD800-\uDBFF]$/u, '');
}

function checkPersonalRole(role) {
  if (role.managed || !role.editable) {
    throw new RoleRotationError('Personal roles must be editable below Pim\'s highest role.');
  }
  if (role.permissions.bitfield !== 0n) {
    throw new RoleRotationError('A personal role has added permissions; restore zero permissions before rotating.');
  }
}

async function reconcile(guild, day, store) {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new RoleRotationError('Pim needs Manage Roles permission.');
  }
  const members = [...(await guild.members.fetch()).values()]
    .filter(member => !member.user.bot)
    .sort((a, b) => a.id.localeCompare(b.id));
  const memberIds = new Set(members.map(member => member.id));
  const roles = await guild.roles.fetch();
  const personal = new Map();
  for (const { userId, roleId } of store.list(guild.id)) {
    const role = roles.get(roleId);
    if (!role) {
      store.remove(guild.id, userId);
      continue;
    }
    checkPersonalRole(role);
    personal.set(userId, role);
  }

  for (const [id, role] of personal) {
    if (!memberIds.has(id)) {
      await role.delete(REASON);
      personal.delete(id);
      store.remove(guild.id, id);
    } else if (role.hoist) {
      personal.set(id, await role.setHoist(false, REASON));
    }
  }
  const missing = members.filter(member => !personal.has(member.id));
  if (guild.roles.cache.size + missing.length > 250) {
    throw new RoleRotationError('Discord has a 250-role limit; there is not enough room for every member.');
  }

  for (const member of members) {
    const name = roleName(member);
    let role = personal.get(member.id);
    if (!role) {
      role = await guild.roles.create({ name, permissions: 0n, hoist: false,
        mentionable: false, reason: REASON });
      // Persist identity before assignment, so an assignment failure cannot
      // cause a duplicate role on the next run or after a restart.
      store.set(guild.id, member.id, role.id);
      personal.set(member.id, role);
    } else if (role.name !== name) {
      role = await role.setName(name, REASON);
      personal.set(member.id, role);
    }
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, REASON);
  }

  // Discord may normalize positions after role creation. Fetch the current
  // hierarchy before deciding whether a reorder is necessary.
  await guild.roles.fetch();
  if (members.length === 0) return;
  const offset = day % members.length;
  const queue = [...members.slice(offset), ...members.slice(0, offset)];
  const positions = queue.map((member, index) => ({
    role: personal.get(member.id).id,
    position: members.length - index,
  }));
  if (positions.some(({ role, position }) => guild.roles.cache.get(role)?.position !== position)) {
    // Only personal role IDs are submitted. Title, Pat, Pim and every other
    // existing role retain their relative order above this bottom block.
    await guild.roles.setPositions(positions);
  }
}

async function startRoleRotation({ client, guildId, channelId, logger = console,
  databasePath = process.env.PIM_ROLE_DATABASE_PATH?.trim() || 'data/pim-roles.sqlite',
  now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let targetGuildId = guildId?.trim();
  if (!targetGuildId && !channelId) {
    throw new RoleRotationError('Set PIM_ROLE_GUILD_ID or VOICE_LOG_CHANNEL_ID.');
  }
  const store = createRoleStore(databasePath);
  let dirty = true;
  let lastDay;
  let running;
  let stopped = false;
  let lastError;

  function tick() {
    if (stopped || !client.isReady()) return Promise.resolve();
    if (running) return running;
    const day = Math.floor((now() + BANGKOK_OFFSET_MS) / DAY_MS);
    if (!dirty && lastDay === day) return Promise.resolve();
    dirty = false;
    running = (async () => {
      if (!targetGuildId) {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.guildId) throw new RoleRotationError('The voice log channel must belong to a server.');
        targetGuildId = channel.guildId;
      }
      const guild = await client.guilds.fetch(targetGuildId);
      await reconcile(guild, day, store);
      if (lastDay !== day) {
        const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
        logger.info(`Pim personal roles ready; guild=${targetGuildId}; date=${date}; timezone=Asia/Bangkok`);
      }
      lastDay = day;
      lastError = undefined;
    })().catch(error => {
      dirty = true;
      const reason = error instanceof RoleRotationError
        ? error.message : String(error.code ?? error.name ?? 'unknown');
      if (reason !== lastError) logger.error(`Pim role rotation failed: ${reason} Retrying in one minute.`);
      lastError = reason;
    }).finally(() => { running = undefined; });
    return running;
  }

  function changed(member) {
    if (member.guild?.id !== targetGuildId) return;
    dirty = true;
    void tick();
  }
  function updated(oldMember, member) {
    if (member.user?.bot || member.guild?.id !== targetGuildId) return;
    const hasPersonalRole = member.roles.cache.has(store.getRoleId(targetGuildId, member.id));
    if (oldMember.displayName !== member.displayName || !hasPersonalRole) changed(member);
  }
  function roleChanged(role) {
    if (role.guild?.id !== targetGuildId || !store.owns(targetGuildId, role.id)) return;
    dirty = true;
    void tick();
  }
  function reconnected() {
    dirty = true;
    void tick();
  }
  function available(guild) {
    if (guild.id === targetGuildId) reconnected();
  }
  const listeners = [
    [Events.GuildMemberAdd, changed],
    [Events.GuildMemberRemove, changed],
    [Events.GuildMemberUpdate, updated],
    [Events.GuildRoleDelete, roleChanged],
    [Events.GuildRoleUpdate, (oldRole, role) => roleChanged(role)],
    [Events.ShardReady, reconnected],
    [Events.ShardResume, reconnected],
    [Events.GuildAvailable, available],
  ];
  for (const [event, listener] of listeners) client.on(event, listener);
  const timer = setIntervalFn(tick, 60_000);
  timer.unref?.();
  // Provisioning can take minutes; give bootstrap a stoppable runtime now so
  // research startup and signal registration never wait for Discord requests.
  void tick();
  return {
    tick,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
      for (const [event, listener] of listeners) client.off(event, listener);
      await running;
      store.close();
    },
  };
}

module.exports = { startRoleRotation };
