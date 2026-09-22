const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const { createMemory } = require('./src/chat/memory');
const { createConversation } = require('./src/chat/conversation');
const { createGeminiGenerator } = require('./src/chat/gemini-client');
const { createMessageHandler } = require('./src/chat/handle-message');

const token = process.env.DISCORD_TOKEN;
const logChannelId = process.env.VOICE_LOG_CHANNEL_ID;
const chatChannelId = process.env.PAT_CHAT_CHANNEL_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';

if (!token) {
  console.error('Error: DISCORD_TOKEN is not defined in environment variables.');
}

if (!logChannelId) {
  console.error('Error: VOICE_LOG_CHANNEL_ID is not defined in environment variables.');
}

if (!chatChannelId) {
  console.error('Error: PAT_CHAT_CHANNEL_ID is not defined in environment variables.');
}

if (!geminiApiKey) {
  console.error('Error: GEMINI_API_KEY is not defined in environment variables.');
}

const client = new Client({
  partials: [Partials.Message, Partials.Channel],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const memory = createMemory({ maxMessages: 12 });
const generate = geminiApiKey
  ? createGeminiGenerator({ apiKey: geminiApiKey, model: geminiModel })
  : async () => { throw new Error('GEMINI_API_KEY is not configured.'); };
const conversation = createConversation({ generate, memory });
const messageHandler = createMessageHandler({ chatChannelId, conversation });

let healthServer;
if (process.env.PORT) {
  healthServer = require('node:http').createServer((req, res) => {
    console.log(`HTTP REQ ${req.method} ${req.url}`);
    res.once('finish', () => console.log(`HTTP RES ${req.method} ${req.url} ${res.statusCode}`));
    const healthy = req.url === '/health' || client.isReady();
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(healthy ? 'ok' : 'discord disconnected');
  }).listen(process.env.PORT, '0.0.0.0');
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  if (!process.env.PAT_RESEARCH_CHANNEL_ID?.trim()) return;
  try {
    const research = await require('./src/research/feature').startResearch({ client });
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 20000);
      deadline.unref();
      try {
        await research.stop();
        await client.destroy();
        if (healthServer) await new Promise(resolve => healthServer.close(resolve));
        clearTimeout(deadline);
        process.exit(0);
      } catch (error) {
        console.error(`Pat shutdown failed; code=${error.code ?? error.name ?? 'unknown'}`);
        process.exit(1);
      }
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
  } catch (error) {
    const reason = /^(?:(?:Missing|Invalid) (?:PAT_RESEARCH_[A-Z_]+|GEMINI_API_KEY)(?:$|:)|PAT_RESEARCH_[A-Z_]+ )/.test(error.message)
      ? error.message : (error.code ?? error.name ?? 'unknown');
    console.error(`Pat research could not start: ${reason}. Existing chat and voice logging remain active.`);
  }
});

client.on(Events.MessageCreate, messageHandler);

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user?.bot) {
    return;
  }

  const isJoin = oldState.channelId === null && newState.channelId !== null;
  const isLeave = oldState.channelId !== null && newState.channelId === null;
  const isMove = oldState.channelId !== null && newState.channelId !== null
    && oldState.channelId !== newState.channelId;
  const hasChannel = oldState.channelId !== null || newState.channelId !== null;
  const muteChanged = hasChannel && typeof oldState.selfMute === 'boolean'
    && typeof newState.selfMute === 'boolean' && oldState.selfMute !== newState.selfMute;
  const streamChanged = hasChannel && typeof oldState.streaming === 'boolean'
    && typeof newState.streaming === 'boolean' && oldState.streaming !== newState.streaming;

  if (!isJoin && !isLeave && !isMove && !muteChanged && !streamChanged) {
    return;
  }

  if (!logChannelId) {
    console.error('Cannot send voice log: VOICE_LOG_CHANNEL_ID is not configured.');
    return;
  }

  try {
    const channel = await client.channels.fetch(logChannelId).catch((err) => {
      console.error(`Failed to fetch log channel (${logChannelId}):`, err.message);
      return null;
    });

    if (!channel || !channel.isSendable()) {
      console.error(`Log channel (${logChannelId}) not found or cannot receive text messages.`);
      return;
    }

    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date());
    const oldChannel = oldState.channel?.name ?? oldState.channelId;
    const newChannel = newState.channel?.name ?? newState.channelId;
    const voiceChannel = newChannel ?? oldChannel;
    const sourceGuild = newState.guild ?? oldState.guild;
    const sourceGuildName = (sourceGuild?.name ?? sourceGuild?.id ?? '')
      .replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]()<>#+\-.!|~]/g, '\\$&');
    const isExternalGuild = sourceGuild && sourceGuild.id !== channel.guildId;
    const serverSuffix = isExternalGuild
      ? ` (เซิร์ฟเวอร์: ${sourceGuildName})` : '';
    const user = `> 👤 **User:** ${member.displayName}`;
    const timestamp = `> 🕒 **Time:** ${time}`;
    const logs = [];

    if (isJoin) logs.push(['🟢 Voice Joined', 0x57F287, [user, `> 🔊 **Channel:** \`${newChannel}\`${serverSuffix}`, timestamp]]);
    if (isLeave) logs.push(['🔴 Voice Left', 0xED4245, [user, `> 🔊 **Channel:** \`${oldChannel}\`${serverSuffix}`, '> ⏱️ **Duration:** Coming soon', timestamp]]);
    if (isMove) logs.push(['🔄 Voice Moved', 0x5865F2, [user, `> 📤 **From:** \`${oldChannel}\`${serverSuffix}`, `> 📥 **To:** \`${newChannel}\`${serverSuffix}`, timestamp]]);
    if (muteChanged) logs.push(['🎙️ Microphone Changed', 0xFEE75C, [user, `> 🎤 **Status:** ${newState.selfMute ? 'Muted 🔇' : 'Unmuted 🎤'}`, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, timestamp]]);
    if (streamChanged) {
      const started = newState.streaming;
      logs.push([started ? '📺 Stream Started' : '📺 Stream Stopped', started ? 0x1ABC9C : 0x95A5A6,
        [user, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, started ? '> 📡 **Status:** Streaming' : '> ⏱️ **Stream Duration:** Coming soon', timestamp]]);
    }

    for (const [title, color, lines] of logs) {
      try {
        const description = isExternalGuild
          ? [`🌐 **จากเซิร์ฟเวอร์: ${sourceGuildName}**`, ...lines].join('\n')
          : lines.join('\n');
        await channel.send({ embeds: [{ title, color: isExternalGuild ? 0xFF00FF : color, description }], allowedMentions: { parse: [] } });
      } catch (err) {
        console.error('Error handling voice log event:', err.message);
      }
    }
  } catch (err) {
    console.error('Error handling voice log event:', err.message);
  }
});

if (token && logChannelId && chatChannelId && geminiApiKey) {
  void (async () => {
    let deadline;
    try {
      await Promise.race([
        client.login(token),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('timed out after 15 minutes')), 15 * 60_000);
          deadline.unref?.();
        }),
      ]);
    } catch (err) {
      console.error('Failed to log in to Discord:', err.message);
      try { await client.destroy(); } finally { process.exit(1); }
    } finally {
      clearTimeout(deadline);
    }
  })();
}
