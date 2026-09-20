const { ChannelType: T, PermissionFlagsBits: P } = require('discord.js');
const { RESEARCH_LIMITS } = require('./limits');

const messageTypes = new Set([T.GuildText, T.GuildAnnouncement, T.PublicThread, T.PrivateThread, T.AnnouncementThread]);
const goneCodes = new Set([10003, 10004, 10008, 50001, 50013]);

function createDiscordSource({ client, qaChannelId, logger = console }) {
  function canRead(channel) {
    return Boolean(channel?.guild && channel.id !== qaChannelId && channel.parentId !== qaChannelId
      && channel.permissionsFor(channel.guild.members.me)?.has([P.ViewChannel, P.ReadMessageHistory]));
  }
  function record(message) {
    const content = message.author?.id === client.user.id || message.channelId === qaChannelId
      || message.channel?.parentId === qaChannelId ? '' : (message.content ?? '');
    return {
      id: message.id, guildId: message.guildId, channelId: message.channelId,
      guildName: message.guild.name, channelName: message.channel.name,
      authorId: message.author?.id ?? '',
      authorName: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'Unknown',
      content, createdAt: message.createdTimestamp,
    };
  }
  function contextCount(value, fallback) {
    if (!Number.isInteger(value)) return fallback;
    return Math.max(0, Math.min(RESEARCH_LIMITS.maxContextMessages, value));
  }
  function contextRecords(messages, channelId, targetId) {
    return [...messages.values()].map(record)
      .filter(item => item.channelId === channelId && item.id !== targetId && item.content.trim())
      .sort((a, b) => {
        const time = a.createdAt - b.createdAt;
        if (time) return time;
        try { return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0; }
        catch { return a.id.localeCompare(b.id); }
      });
  }
  const source = {
    discoveryErrors: 0,
    canRead,
    record,
    async listGuilds({ signal } = {}) {
      signal?.throwIfAborted();
      const guilds = new Map(client.guilds.cache);
      if (typeof client.guilds.fetch === 'function') {
        try {
          const fetched = await client.guilds.fetch();
          for (const guild of fetched.values()) guilds.set(guild.id, guild);
        } catch (error) {
          logger.warn(`Guild catalog refresh failed; code=${error.code ?? error.name ?? 'unknown'}`);
        }
        signal?.throwIfAborted();
      }
      return [...guilds.values()]
        .map(guild => ({ id: guild.id, name: guild.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    },
    async listChannels(guildId, { signal } = {}) {
      signal?.throwIfAborted();
      let guild = client.guilds.cache.get(guildId);
      if (!guild && typeof client.guilds.fetch === 'function') {
        try { guild = await client.guilds.fetch(guildId); } catch { return []; }
        signal?.throwIfAborted();
      }
      if (!guild) return [];
      const channels = await guild.channels.fetch();
      signal?.throwIfAborted();
      return [...channels.values()].filter(channel => channel && canRead(channel)
          && (channel.type === T.GuildText || channel.type === T.GuildAnnouncement))
        .map(channel => ({ id: channel.id, guildId: guild.id, guildName: guild.name,
          name: channel.name, type: channel.type }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    },
    async readMessages(channelId, { before, limit = 50, signal } = {}) {
      signal?.throwIfAborted();
      const channel = await client.channels.fetch(channelId, { force: true });
      signal?.throwIfAborted();
      if (!canRead(channel) || !messageTypes.has(channel.type)) return [];
      const wanted = Math.max(1, Math.min(100, limit));
      const found = [];
      let cursor = before;
      while (found.length < wanted) {
        const batchLimit = wanted - found.length;
        const options = { limit: batchLimit, cache: false };
        if (cursor) options.before = cursor;
        const messages = [...(await channel.messages.fetch(options)).values()];
        signal?.throwIfAborted();
        found.push(...messages.map(record).filter(item => item.content.trim()));
        if (messages.length < batchLimit || !messages.length) break;
        const next = messages.at(-1).id;
        if (next === cursor) break;
        cursor = next;
      }
      return found.slice(0, wanted);
    },
    async discover() {
      source.discoveryErrors = 0;
      const found = new Map();
      const add = channel => {
        if (canRead(channel) && messageTypes.has(channel.type)) found.set(channel.id, channel);
      };
      const failure = (id, error) => {
        source.discoveryErrors++;
        logger.warn(`Channel discovery skipped ${id}; code=${error.code ?? error.name ?? 'unknown'}`);
      };
      for (const guild of client.guilds.cache.values()) {
        let channels;
        try { channels = await guild.channels.fetch(); } catch (error) { failure(guild.id, error); continue; }
        for (const channel of channels.values()) if (channel) add(channel);
        try {
          const active = await guild.channels.fetchActiveThreads();
          for (const thread of active.threads.values()) add(thread);
        } catch (error) { failure(guild.id, error); }
        for (const parent of channels.values()) {
          if (!canRead(parent) || !parent.threads) continue;
          const types = parent.type === T.GuildText ? ['public', 'private'] : ['public'];
          for (const type of types) {
            const fetchAll = type === 'private' && parent.permissionsFor(guild.members.me).has(P.ManageThreads);
            let before;
            try {
              while (true) {
                const page = await parent.threads.fetchArchived({ type, fetchAll, limit: 100, before });
                const threads = [...page.threads.values()];
                threads.forEach(add);
                if (!page.hasMore || !threads.length) break;
                const tail = threads.reduce((a, b) => (a.archiveTimestamp ?? 0) < (b.archiveTimestamp ?? 0) ? a : b);
                const next = type === 'private' && !fetchAll
                  ? threads.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b).id
                  : tail.archivedAt?.toISOString() ?? new Date(tail.archiveTimestamp).toISOString();
                if (next === before) throw new Error('Archive cursor did not advance');
                before = next;
              }
            } catch (error) { failure(parent.id, error); }
          }
        }
      }
      return [...found.values()];
    },
    async fetchPage(channel, before) {
      const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
      return [...messages.values()].map(record);
    },
    async refresh(indexed, { signal } = {}) {
      signal?.throwIfAborted();
      if (indexed.channelId === qaChannelId || !client.guilds.cache.has(indexed.guildId)) return null;
      try {
        const channel = await client.channels.fetch(indexed.channelId, { force: true });
        signal?.throwIfAborted();
        if (!canRead(channel) || !messageTypes.has(channel.type)) return null;
        const message = await channel.messages.fetch({ message: indexed.id, force: true, cache: false });
        signal?.throwIfAborted();
        const current = record(message);
        return current.content.trim() ? current : null;
      } catch (error) {
        if (goneCodes.has(error.code)) return null;
        throw error;
      }
    },
    async readContext(target, { before = RESEARCH_LIMITS.contextBefore,
      after = RESEARCH_LIMITS.contextAfter, signal } = {}) {
      signal?.throwIfAborted();
      if (target.channelId === qaChannelId || !client.guilds.cache.has(target.guildId)) return null;
      try {
        const channel = await client.channels.fetch(target.channelId, { force: true });
        signal?.throwIfAborted();
        if (!canRead(channel) || !messageTypes.has(channel.type)) return null;
        const beforeLimit = contextCount(before, RESEARCH_LIMITS.contextBefore);
        const afterLimit = contextCount(after, RESEARCH_LIMITS.contextAfter);
        const beforeMessages = beforeLimit
          ? await channel.messages.fetch({ limit: beforeLimit, before: target.id, cache: false })
          : new Map();
        signal?.throwIfAborted();
        const afterMessages = afterLimit
          ? await channel.messages.fetch({ limit: afterLimit, after: target.id, cache: false })
          : new Map();
        signal?.throwIfAborted();
        if (!canRead(channel)) return null;
        const finalMessage = await channel.messages.fetch({ message: target.id, force: true, cache: false });
        signal?.throwIfAborted();
        if (!canRead(channel)) return null;
        const finalTarget = record(finalMessage);
        if (!finalTarget.content.trim()) return null;
        return {
          target: finalTarget,
          contextBefore: contextRecords(beforeMessages, target.channelId, target.id),
          contextAfter: contextRecords(afterMessages, target.channelId, target.id),
        };
      } catch (error) {
        if (goneCodes.has(error.code)) return null;
        throw error;
      }
    },
  };
  return source;
}

module.exports = { createDiscordSource };
