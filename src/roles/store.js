const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function createRoleStore(path) {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS personal_roles (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id),
        UNIQUE (guild_id, role_id)
      );
    `);
    const list = db.prepare('SELECT user_id AS userId, role_id AS roleId FROM personal_roles WHERE guild_id = ?');
    const get = db.prepare('SELECT role_id AS roleId FROM personal_roles WHERE guild_id = ? AND user_id = ?');
    const owns = db.prepare('SELECT 1 FROM personal_roles WHERE guild_id = ? AND role_id = ?');
    const set = db.prepare(`INSERT INTO personal_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = excluded.role_id`);
    const remove = db.prepare('DELETE FROM personal_roles WHERE guild_id = ? AND user_id = ?');
    return {
      list: guildId => list.all(guildId),
      getRoleId: (guildId, userId) => get.get(guildId, userId)?.roleId,
      owns: (guildId, roleId) => Boolean(owns.get(guildId, roleId)),
      set: (guildId, userId, roleId) => set.run(guildId, userId, roleId),
      remove: (guildId, userId) => remove.run(guildId, userId),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { createRoleStore };
