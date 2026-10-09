const { Client, GatewayIntentBits, Events, Partials, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { createMemory } = require('./src/chat/memory');
const { createConversation } = require('./src/chat/conversation');
const { createGeminiGenerator } = require('./src/chat/gemini-client');
const { createMessageHandler } = require('./src/chat/handle-message');
const { createStopwatch } = require('./src/chat/stopwatch');
const { createVoiceActorResolver } = require('./src/voice/actor');

const token = process.env.DISCORD_TOKEN;
const logChannelId = process.env.VOICE_LOG_CHANNEL_ID;
const chatChannelId = process.env.PAT_CHAT_CHANNEL_ID;
const stopwatchChannelId = process.env.PAT_STOPWATCH_CHANNEL_ID;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const rolesEnabled = process.env.PIM_ROLES_ENABLED?.trim().toLowerCase() !== 'false';

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
    ...(rolesEnabled ? [GatewayIntentBits.GuildMembers] : []),
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
// Separate slow Discord HTTP from time spent queued by the REST client.
const makeDiscordRequest = client.rest?.options?.makeRequest;
if (makeDiscordRequest) {
  client.rest.options.makeRequest = async (url, options) => {
    const started = Date.now();
    const path = new URL(url).pathname.replace(/\d{17,20}/g, ':id');
    try {
      const response = await makeDiscordRequest(url, options);
      const elapsedMs = Date.now() - started;
      if (elapsedMs >= 2000 || response.status >= 400) {
        console.warn(`Discord REST HTTP; method=${options.method ?? 'GET'}; path=${path}; status=${response.status}; elapsedMs=${elapsedMs}`);
      }
      return response;
    } catch (error) {
      console.warn(`Discord REST HTTP failed; method=${options.method ?? 'GET'}; path=${path}; code=${error.code ?? error.name ?? 'unknown'}; elapsedMs=${Date.now() - started}`);
      throw error;
    }
  };
}
client.rest?.on?.('rateLimited', ({ route, retryAfter, global }) => {
  console.warn(`Discord REST rate limited; route=${route}; retryAfter=${retryAfter}; global=${global}`);
});
client.rest?.on?.('response', (request, response) => {
  if (request.path === '/gateway/bot') {
    console.log(`Discord gateway REST response; status=${response.status}; retryAfter=${response.headers.get('Retry-After') ?? 'none'}; scope=${response.headers.get('X-RateLimit-Scope') ?? 'none'}; global=${response.headers.has('X-RateLimit-Global')}`);
  }
});

const memory = createMemory({ maxMessages: 12 });
const generate = geminiApiKey
  ? createGeminiGenerator({ apiKey: geminiApiKey, model: geminiModel })
  : async () => { throw new Error('GEMINI_API_KEY is not configured.'); };
const conversation = createConversation({ generate, memory });
const stopwatch = createStopwatch();
const messageHandler = createMessageHandler({ chatChannelId, stopwatchChannelId, stopwatch, conversation });
const resolveVoiceActor = createVoiceActorResolver({
  auditLogEvents: AuditLogEvent,
  viewAuditLogPermission: PermissionFlagsBits.ViewAuditLog,
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
});

const adminServices = {};
const adminHandler = require('./src/admin/handler').createAdminHandler({ client, services: adminServices,
  apiKey: process.env.PIM_ADMIN_API_KEY?.trim(), env: process.env });
let healthServer;
if (process.env.PORT) {
  healthServer = require('node:http').createServer((req, res) => {
    if ((req.url ?? '').split('?')[0].startsWith('/admin/')) { void adminHandler(req, res); return; }
    console.log(`HTTP REQ ${req.method} ${req.url}`);
    if (req.url === '/ready') console.log(`Discord gateway status=${client.ws?.status ?? 'unknown'}`);
    res.once('finish', () => console.log(`HTTP RES ${req.method} ${req.url} ${res.statusCode}`));
    const healthy = req.url === '/health' || client.isReady();
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(healthy ? 'ok' : 'discord disconnected');
  }).listen(process.env.PORT, '0.0.0.0');
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  let roleRotation;
  let research;
  let music;
  if (rolesEnabled) {
    try {
      roleRotation = await require('./src/roles/rotation').startRoleRotation({
        client, guildId: process.env.PIM_ROLE_GUILD_ID, channelId: logChannelId,
      });
      adminServices.roleRotation = roleRotation;
    } catch (error) {
      console.error(`Pim personal roles could not start; code=${error.code ?? error.name ?? 'unknown'}`);
    }
  }
  if (process.env.PAT_RESEARCH_CHANNEL_ID?.trim()) {
    try {
      research = await require('./src/research/feature').startResearch({ client });
      adminServices.research = research;
    } catch (error) {
      const reason = /^(?:(?:Missing|Invalid) (?:PAT_RESEARCH_[A-Z_]+|GEMINI_API_KEY)(?:$|:)|PAT_RESEARCH_[A-Z_]+ )/.test(error.message)
        ? error.message : (error.code ?? error.name ?? 'unknown');
      console.error(`Pat research could not start: ${reason}. Existing chat and voice logging remain active.`);
    }
  }
  if (process.env.PIM_MUSIC_ENABLED?.trim().toLowerCase() !== 'false') {
    try {
      music = await require('./src/music/feature').startMusic({ client, channelId: stopwatchChannelId?.trim(),
        beforeConnect: guildId => adminServices.welcome?.cancelGuild(guildId) });
      adminServices.music = music;
    } catch (error) {
      console.error(`Pim music could not start; code=${error.code ?? error.name ?? 'unknown'}`);
    }
  }
  try {
    adminServices.welcome = require('./src/welcome/feature').startWelcome({ client,
      musicBusy: guildId => Boolean(adminServices.music?.snapshot(guildId)?.channelId) });
  } catch { console.error('Pim welcome could not start; code=WELCOME_CONFIGURATION'); }
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20000);
    deadline.unref();
    try {
      await roleRotation?.stop();
      await research?.stop();
      await music?.stop();
      adminServices.welcome?.stop();
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
});

client.on(Events.ShardDisconnect, (event, id) => {
  console.warn(`Discord shard disconnected; id=${id}; code=${event.code}`);
});
client.on(Events.ShardReconnecting, id => console.warn(`Discord shard reconnecting; id=${id}`));
client.on(Events.ShardError, (error, id) => {
  console.error(`Discord shard error; id=${id}; code=${error.code ?? error.name ?? 'unknown'}`);
});

client.on(Events.MessageCreate, message => {
  if (message.channelId === chatChannelId
    || message.channelId === stopwatchChannelId
    || message.channelId === process.env.PAT_RESEARCH_CHANNEL_ID?.trim()) {
    console.log(`Discord message received; id=${message.id}; channel=${message.channelId}`);
  }
  void messageHandler(message).catch(error => console.error(`Chat message handler failed; code=${error?.code ?? error?.name ?? 'unknown'}`));
});

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
  const serverMuteChanged = hasChannel && typeof oldState.serverMute === 'boolean'
    && typeof newState.serverMute === 'boolean' && oldState.serverMute !== newState.serverMute;
  const serverDeafChanged = hasChannel && typeof oldState.serverDeaf === 'boolean'
    && typeof newState.serverDeaf === 'boolean' && oldState.serverDeaf !== newState.serverDeaf;

  if (!isJoin && !isLeave && !isMove && !muteChanged && !streamChanged
    && !serverMuteChanged && !serverDeafChanged) {
    return;
  }
  const occurredAt = Date.now();

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
    const selfActor = `> 🛠️ **Done by:** <@${member.id}>`;
    const actorOptions = { guild: sourceGuild, memberId: member.id, occurredAt };
    const [channelActor, muteActor, deafActor] = await Promise.all([
      isMove || isLeave ? resolveVoiceActor({ ...actorOptions,
        action: isMove ? 'move' : 'disconnect', channelId: newState.channelId }) : null,
      serverMuteChanged ? resolveVoiceActor({ ...actorOptions, action: 'update',
        change: { key: 'mute', old: oldState.serverMute, new: newState.serverMute } }) : null,
      serverDeafChanged ? resolveVoiceActor({ ...actorOptions, action: 'update',
        change: { key: 'deaf', old: oldState.serverDeaf, new: newState.serverDeaf } }) : null,
    ]);
    const timestamp = `> 🕒 **Time:** ${time}`;
    const logs = [];

    if (isJoin) logs.push(['🟢 Voice Joined', 0x57F287, [user, selfActor, `> 🔊 **Channel:** \`${newChannel}\`${serverSuffix}`, timestamp]]);
    if (isLeave) logs.push(['🔴 Voice Left', 0xED4245, [user, `> 🛠️ **Done by:** ${channelActor}`, `> 🔊 **Channel:** \`${oldChannel}\`${serverSuffix}`, '> ⏱️ **Duration:** Coming soon', timestamp]]);
    if (isMove) logs.push(['🔄 Voice Moved', 0x5865F2, [user, `> 🛠️ **Done by:** ${channelActor}`, `> 📤 **From:** \`${oldChannel}\`${serverSuffix}`, `> 📥 **To:** \`${newChannel}\`${serverSuffix}`, timestamp]]);
    if (muteChanged) logs.push(['🎙️ Microphone Changed', 0xFEE75C, [user, selfActor, `> 🎤 **Status:** ${newState.selfMute ? 'Muted 🔇' : 'Unmuted 🎤'}`, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, timestamp]]);
    if (serverMuteChanged) logs.push(['🎙️ Server Microphone Changed', 0xFEE75C, [user, `> 🛠️ **Done by:** ${muteActor}`, `> 🎤 **Status:** ${newState.serverMute ? 'Muted 🔇' : 'Unmuted 🎤'}`, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, timestamp]]);
    if (serverDeafChanged) logs.push(['🎧 Server Deafen Changed', 0xFEE75C, [user, `> 🛠️ **Done by:** ${deafActor}`, `> 🎧 **Status:** ${newState.serverDeaf ? 'Deafened 🔇' : 'Undeafened 🎧'}`, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, timestamp]]);
    if (streamChanged) {
      const started = newState.streaming;
      logs.push([started ? '📺 Stream Started' : '📺 Stream Stopped', started ? 0x1ABC9C : 0x95A5A6,
        [user, selfActor, `> 🔊 **Channel:** \`${voiceChannel}\`${serverSuffix}`, started ? '> 📡 **Status:** Streaming' : '> ⏱️ **Stream Duration:** Coming soon', timestamp]]);
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
    try {
      await client.login(token);
    } catch (err) {
      console.error('Failed to log in to Discord:', err.message);
      try { await client.destroy(); } finally { process.exit(1); }
    }
  })();
}
