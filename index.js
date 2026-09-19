const { Client, GatewayIntentBits, Events } = require('discord.js');
const { registerPatCommand } = require('./src/chat/command');
const { createMemory } = require('./src/chat/memory');
const { createConversation } = require('./src/chat/conversation');
const { createGeminiGenerator } = require('./src/chat/gemini-client');
const { createPatHandler } = require('./src/chat/handle-pat');

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const logChannelId = process.env.VOICE_LOG_CHANNEL_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';

if (!token) {
  console.error('Error: DISCORD_TOKEN is not defined in environment variables.');
}

if (!logChannelId) {
  console.error('Error: VOICE_LOG_CHANNEL_ID is not defined in environment variables.');
}

if (!guildId) {
  console.error('Error: DISCORD_GUILD_ID is not defined in environment variables.');
}

if (!geminiApiKey) {
  console.error('Error: GEMINI_API_KEY is not defined in environment variables.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const memory = createMemory({ maxMessages: 12 });
const generate = geminiApiKey
  ? createGeminiGenerator({ apiKey: geminiApiKey, model: geminiModel })
  : async () => { throw new Error('GEMINI_API_KEY is not configured.'); };
const conversation = createConversation({ generate, memory });
const patHandler = createPatHandler({ conversation });

if (process.env.PORT) {
  require('node:http').createServer((_req, res) => {
    res.writeHead(client.isReady() ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(client.isReady() ? 'ok' : 'discord disconnected');
  }).listen(process.env.PORT, '0.0.0.0');
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  try {
    await registerPatCommand(readyClient.application, guildId);
    console.log('Registered /pat command.');
  } catch (err) {
    console.error('Failed to register /pat command:', err.message);
  }
});

client.on(Events.InteractionCreate, patHandler);

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user?.bot) {
    return;
  }

  const isJoin = oldState.channelId === null && newState.channelId !== null;
  const isLeave = oldState.channelId !== null && newState.channelId === null;

  if (!isJoin && !isLeave) {
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

    if (isJoin) {
      const channelTag = `<#${newState.channelId}>`;
      await channel.send({
        content: `> 🟢 **เข้าห้อง:** ${channelTag}\n> 👤 ${member.displayName}\n_ _`,
        allowedMentions: { parse: [] },
      });
    } else if (isLeave) {
      const channelTag = `<#${oldState.channelId}>`;
      await channel.send({
        content: `> 🔴 **ออกจากห้อง:** ${channelTag}\n> 👤 ${member.displayName}\n_ _`,
        allowedMentions: { parse: [] },
      });
    }
  } catch (err) {
    console.error('Error handling voice log event:', err.message);
  }
});

if (token && logChannelId && guildId && geminiApiKey) {
  client.login(token).catch((err) => {
    console.error('Failed to log in to Discord:', err.message);
  });
}
