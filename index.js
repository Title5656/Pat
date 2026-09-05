const { Client, GatewayIntentBits, Events } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const logChannelId = process.env.VOICE_LOG_CHANNEL_ID;

if (!token) {
  console.error('Error: DISCORD_TOKEN is not defined in environment variables.');
}

if (!logChannelId) {
  console.error('Error: VOICE_LOG_CHANNEL_ID is not defined in environment variables.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

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

    if (!channel || !channel.isTextBased()) {
      console.error(`Log channel (${logChannelId}) not found or cannot receive text messages.`);
      return;
    }

    if (isJoin) {
      const channelName = newState.channel?.name ?? 'Unknown';
      await channel.send(`🟢 <@${member.id}> เข้าห้อง ${channelName}`);
    } else if (isLeave) {
      const channelName = oldState.channel?.name ?? 'Unknown';
      await channel.send(`🔴 <@${member.id}> ออกจากห้อง ${channelName}`);
    }
  } catch (err) {
    console.error('Error handling voice log event:', err.message);
  }
});

if (token) {
  client.login(token).catch((err) => {
    console.error('Failed to log in to Discord:', err.message);
  });
}
