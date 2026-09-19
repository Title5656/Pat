const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
function words(text) {
  return [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())]
    .filter(part => part.isWordLike).map(part => part.segment);
}

function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, guild_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id);
    CREATE INDEX IF NOT EXISTS messages_guild ON messages(guild_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(id UNINDEXED, tokens, tokenize='unicode61 remove_diacritics 0');
    CREATE TABLE IF NOT EXISTS checkpoints (channel_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const put = db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE
    SET channel_id = excluded.channel_id, guild_id = excluded.guild_id, data = excluded.data`);
  // FTS UNINDEXED fields cannot provide an ID lookup. Reuse the message rowid
  // so each edit/delete does not scan the entire message corpus.
  const removeIndex = db.prepare('DELETE FROM search_index WHERE rowid = (SELECT rowid FROM messages WHERE id = ?)');
  const putIndex = db.prepare('INSERT INTO search_index(rowid, id, tokens) SELECT rowid, id, ? FROM messages WHERE id = ?');
  const query = db.prepare(`SELECT m.data, bm25(search_index) AS score FROM search_index
    JOIN messages m ON m.rowid = search_index.rowid WHERE search_index MATCH ? ORDER BY score LIMIT ?`);

  function transaction(fn) {
    db.exec('BEGIN');
    try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  return {
    upsert(message) {
      const tokens = words([message.content, message.authorName, message.authorId, message.channelName,
        message.guildName, new Date(message.createdAt).toISOString().slice(0, 10)].join(' ')).join(' ');
      transaction(() => {
        put.run(message.id, message.channelId, message.guildId, JSON.stringify(message));
        removeIndex.run(message.id);
        putIndex.run(tokens, message.id);
      });
    },
    deleteMessage(id) {
      transaction(() => {
        removeIndex.run(id);
        db.prepare('DELETE FROM messages WHERE id = ?').run(id);
      });
    },
    deleteChannel(id) {
      transaction(() => {
        db.prepare('DELETE FROM search_index WHERE rowid IN (SELECT rowid FROM messages WHERE channel_id = ?)').run(id);
        db.prepare('DELETE FROM messages WHERE channel_id = ?').run(id);
        db.prepare('DELETE FROM checkpoints WHERE channel_id = ?').run(id);
      });
    },
    deleteGuild(id) {
      const channels = db.prepare('SELECT DISTINCT channel_id FROM messages WHERE guild_id = ?').all(id);
      for (const row of channels) this.deleteChannel(row.channel_id);
    },
    search(queries, limit = 30) {
      const matches = new Map();
      for (const text of queries.slice(0, 4)) {
        const terms = [...new Set(words(text))].slice(0, 24);
        if (!terms.length) continue;
        // Quote each term; user input is never interpreted as FTS query syntax.
        const expression = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
        for (const row of query.all(expression, limit)) {
          const item = JSON.parse(row.data);
          const old = matches.get(item.id);
          if (!old || row.score < old.score) matches.set(item.id, { ...item, score: row.score });
        }
      }
      return [...matches.values()].sort((a, b) => a.score - b.score).slice(0, limit);
    },
    getState(channelId) {
      const row = db.prepare('SELECT data FROM checkpoints WHERE channel_id = ?').get(channelId);
      return row ? JSON.parse(row.data) : null;
    },
    setState(channelId, state) {
      db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?, ?)').run(channelId, JSON.stringify(state));
    },
    stats() {
      return {
        messages: db.prepare('SELECT count(*) AS n FROM messages').get().n,
        channels: db.prepare('SELECT count(*) AS n FROM checkpoints').get().n,
        complete: db.prepare("SELECT count(*) AS n FROM checkpoints WHERE json_extract(data, '$.complete') = 1").get().n,
      };
    },
    close() { db.close(); },
  };
}

module.exports = { createStore };
