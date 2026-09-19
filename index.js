const { Client, GatewayIntentBits, Events } = require('discord.js');
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

if (process.env.PORT) {
  require('node:http').createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(client.isReady() ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(client.isReady() ? 'ok' : 'discord disconnected');
  }).listen(process.env.PORT, '0.0.0.0');
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
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
  const deafChanged = hasChannel && typeof oldState.selfDeaf === 'boolean'
    && typeof newState.selfDeaf === 'boolean' && oldState.selfDeaf !== newState.selfDeaf;
  const streamChanged = hasChannel && typeof oldState.streaming === 'boolean'
    && typeof newState.streaming === 'boolean' && oldState.streaming !== newState.streaming;

  if (!isJoin && !isLeave && !isMove && !muteChanged && !deafChanged && !streamChanged) {
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
    if (deafChanged) logs.push(['🎧 Deafen Changed', 0x9B59B6, [user, `> 🎧 **Status:** ${newState.selfDeaf ? 'Deafened 🔇' : 'Undeafened 🎧'}`, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, timestamp]]);
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
        await channel.send({ embeds: [{ title, color: isExternalGuild ? 0xA855F7 : color, description }], allowedMentions: { parse: [] } });
      } catch (err) {
        console.error('Error handling voice log event:', err.message);
      }
    }
  } catch (err) {
    console.error('Error handling voice log event:', err.message);
  }
});

if (token && logChannelId && chatChannelId && geminiApiKey) {
  client.login(token).catch((err) => {
    console.error('Failed to log in to Discord:', err.message);
  });
}
