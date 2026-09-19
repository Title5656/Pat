const { once } = require('node:events');
const { Events, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { validateIdentity } = require('./config');
const { createDiscordSource } = require('./discord-source');
const { createIndexer } = require('./indexer');
const { createAssistant } = require('./assistant');

function createRuntime({ client, store, model, config, logger = console,
  source = createDiscordSource({ client, qaChannelId: config.qaChannelId, logger }) }) {
  const indexer = createIndexer({ store, source, pagesPerChannel: config.pagesPerChannel, logger });
  const assistant = createAssistant({ store, source, model, qaChannelId: config.qaChannelId,
    allowedUserIds: config.allowedUserIds, status: () => indexer.status(), logger, authorizeOutput: checkOutput });
  const jobs = new Set();
  const listeners = [];
  let active = false;
  let timer;
  let stopping;
  async function checkOutput() {
    const channel = await client.channels.fetch(config.qaChannelId, { force: true });
    if (!channel?.guild || channel.type !== ChannelType.GuildText
      || !channel.permissionsFor(channel.guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) {
      throw new Error('RESEARCH_QA_CHANNEL_ID must be a guild text channel the new bot can read and write');
    }
    await channel.guild.roles.fetch();
    if (channel.permissionsFor(channel.guild.roles.everyone)?.has(P.ViewChannel)) {
      throw new Error('RESEARCH_QA_CHANNEL_ID must be private: deny View Channel for @everyone');
    }
    for (const role of channel.guild.roles.cache.values()) {
      // Server administrators bypass channel permissions by Discord design.
      if (role.permissions.has(P.Administrator) || role.tags?.botId === config.applicationId) continue;
      if (channel.permissionsFor(role)?.has(P.ViewChannel)) {
        throw new Error('RESEARCH_QA_CHANNEL_ID must grant visibility to trusted users directly, not shared roles');
      }
    }
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type === 1 && overwrite.allow.has(P.ViewChannel)
        && overwrite.id !== config.applicationId && !config.allowedUserIds.has(overwrite.id)) {
        throw new Error('RESEARCH_QA_CHANNEL_ID has a visibility grant for a non-trusted user');
      }
    }
  }
  function on(event, callback) {
    const listener = (...args) => {
      if (!active) return;
      const job = Promise.resolve().then(() => callback(...args)).catch(error => {
        logger.warn(`Discord event failed; event=${event}; code=${error.code ?? error.name ?? 'unknown'}`);
      });
      jobs.add(job);
      void job.finally(() => jobs.delete(job));
    };
    client.on(event, listener);
    listeners.push([event, listener]);
  }
  async function ingest(message) {
    if (message.partial) message = await message.fetch();
    if (!message.guildId || !source.canRead(message.channel)) return;
    const item = source.record(message);
    if (item.content.trim()) store.upsert(item); else store.deleteMessage(item.id);
  }
  on(Events.MessageCreate, async message => {
    if (message.channelId === config.qaChannelId) {
      if (message.author?.bot || !config.allowedUserIds.has(message.author?.id) || !message.content?.trim()) return;
      await checkOutput();
      await assistant.handle(message);
      return;
    }
    await ingest(message);
  });
  on(Events.MessageUpdate, (_old, message) => ingest(message));
  on(Events.MessageDelete, message => store.deleteMessage(message.id));
  on(Events.MessageBulkDelete, messages => { for (const id of messages.keys()) store.deleteMessage(id); });
  on(Events.ChannelDelete, channel => store.deleteChannel(channel.id));
  on(Events.ThreadDelete, thread => store.deleteChannel(thread.id));
  on(Events.ChannelUpdate, (_old, channel) => { if (!source.canRead(channel)) store.deleteChannel(channel.id); });
  on(Events.GuildDelete, guild => store.deleteGuild(guild.id));

  async function tick() {
    await indexer.sync();
    if (active) {
      timer = setTimeout(() => { void tick(); }, config.syncIntervalMs);
      timer.unref?.();
    }
  }

  return {
    async start() {
      const ready = once(client, Events.ClientReady);
      // Attach a rejection handler even if login fails before the ready event.
      void ready.catch(() => {});
      await client.login(config.token);
      await ready;
      validateIdentity(client.user.id, config.applicationId);
      await checkOutput();
      active = true;
      logger.log('Research bot connected; background history indexing started.');
      void tick();
    },
    status() { return { ready: active && (client.isReady?.() ?? true), ...indexer.status() }; },
    stop() {
      if (stopping) return stopping;
      active = false;
      clearTimeout(timer);
      for (const [event, listener] of listeners) client.removeListener(event, listener);
      stopping = (async () => {
        await Promise.all([assistant.stop(), indexer.stop()]);
        await Promise.allSettled([...jobs]);
        await client.destroy();
        store.close();
      })();
      return stopping;
    },
  };
}

module.exports = { createRuntime };
