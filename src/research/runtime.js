const { Events, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { createDiscordSource } = require('./discord-source');
const { createIndexer } = require('./indexer');
const { createAssistant } = require('./assistant');

function createRuntime({ client, store, model, config, logger = console,
  source = createDiscordSource({ client, qaChannelId: config.qaChannelId, logger }) }) {
  const indexer = createIndexer({ store, source, pagesPerChannel: config.pagesPerChannel, logger });
  const assistant = createAssistant({ store, source, model, qaChannelId: config.qaChannelId,
    status: () => indexer.status(), logger, authorizeOutput: checkOutput,
    contextBefore: config.contextBefore, contextAfter: config.contextAfter });
  const jobs = new Set();
  const listeners = [];
  let active = false;
  let timer;
  let stopping;
  async function checkOutput() {
    const channel = await client.channels.fetch(config.qaChannelId, { force: true });
    if (!channel?.guild || channel.type !== ChannelType.GuildText
      || !channel.permissionsFor(channel.guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) {
      throw new Error('PAT_RESEARCH_CHANNEL_ID must be a guild text channel Pat can read and write');
    }
    if (channel.permissionsFor(channel.guild.roles.everyone)?.has(P.ViewChannel)) {
      throw new Error('PAT_RESEARCH_CHANNEL_ID must be private: deny View Channel for @everyone');
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
      if (message.author?.bot || !message.content?.trim()) return;
      await checkOutput();
      logger.log(`Forger output checked; id=${message.id}`);
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
      if (!client.isReady()) throw new Error('Pat must be connected before starting research');
      await checkOutput();
      active = true;
      logger.log('Pat research enabled; background history indexing started.');
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
        store.close();
      })();
      return stopping;
    },
  };
}

module.exports = { createRuntime };
