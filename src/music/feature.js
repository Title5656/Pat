const { Events, ChannelType, PermissionFlagsBits: P, MessageFlags, escapeMarkdown } = require('discord.js');
const { createYouTubeSource, musicError } = require('./source');
const { createMusicManager } = require('./player');

const commands = [
  { name: 'play', description: 'ให้ Pim เล่นเพลงจาก YouTube ในห้องเสียงของคุณ', type: 1,
    options: [{ name: 'query', description: 'ลิงก์ YouTube หรือชื่อเพลง', type: 3, required: true, min_length: 1, max_length: 2000 }] },
  { name: 'queue', description: 'ดูเพลงที่กำลังเล่นและคิวเพลงของ Pim', type: 1 },
  { name: 'skip', description: 'ข้ามเพลงที่กำลังเล่น', type: 1 },
  { name: 'stop', description: 'หยุดเพลง ล้างคิว และให้ Pim ออกจากห้องเสียง', type: 1 },
];
const names = new Set(commands.map(command => command.name));
const errors = {
  INVALID_QUERY: 'ใส่ชื่อเพลงไม่เกิน 200 ตัวอักษร หรือลิงก์วิดีโอ YouTube นะคะ',
  YOUTUBE_UNAVAILABLE: 'เล่นเพลงนี้จาก YouTube ไม่ได้ค่ะ วิดีโออาจไม่เปิดสาธารณะ หรือ YouTube ไม่อนุญาตให้เซิร์ฟเวอร์บอตดึงเสียง ลองเพลงอื่นนะคะ',
  YOUTUBE_BOT_BLOCKED: 'YouTube ขอให้เซิร์ฟเวอร์บอตยืนยันว่าไม่ใช่บอตค่ะ ผู้ดูแลต้องตรวจการเข้าถึง YouTube จากโฮสต์ที่รัน Pim ก่อนนะคะ',
  YOUTUBE_REGION_BLOCKED: 'เพลงนี้ถูกจำกัดประเทศที่รับชมค่ะ ประเทศของเซิร์ฟเวอร์บอตอาจต่างจากเครื่องของคุณ ลองเพลงอื่นนะคะ',
  YOUTUBE_RESTRICTED: 'วิดีโอนี้เป็นส่วนตัว หรือ YouTube กำหนดให้เข้าสู่ระบบก่อนค่ะ ลองวิดีโอสาธารณะที่ไม่จำกัดอายุนะคะ',
  YOUTUBE_ACCESS_DENIED: 'YouTube ปฏิเสธการดึงเสียงด้วย HTTP 403 ค่ะ ผู้ดูแลต้องตรวจตัวดึงเสียงและการเข้าถึง YouTube จากเซิร์ฟเวอร์บอตนะคะ',
  YOUTUBE_RATE_LIMITED: 'YouTube จำกัดจำนวนคำขอจากเซิร์ฟเวอร์บอตค่ะ รอสักพักแล้วค่อยลองใหม่นะคะ',
  YOUTUBE_COOKIES_INVALID: 'ไฟล์ cookies ของ YouTube บนเซิร์ฟเวอร์บอตไม่พร้อมค่ะ ผู้ดูแลตรวจ Render Secret File ชื่อ youtube-cookies.txt และรูปแบบ Netscape นะคะ',
  EXTRACTOR_FAILED: 'ระบบดึงเสียง YouTube ยังไม่พร้อมค่ะ ตรวจการติดตั้ง yt-dlp บนเซิร์ฟเวอร์บอตนะคะ',
  LIVE_UNSUPPORTED: 'ตอนนี้เล่นได้เฉพาะวิดีโอ YouTube ปกติ ยังไม่รองรับไลฟ์ค่ะ',
  YOUTUBE_TIMEOUT: 'YouTube โหลดนานเกินไปค่ะ ลองใหม่อีกครั้งนะคะ',
  AUDIO_FAILED: 'เล่นเสียงเพลงนี้ไม่ได้ค่ะ',
  VOICE_FAILED: 'Pim เชื่อมต่อห้องเสียงไม่ได้ค่ะ ตรวจสิทธิ์และการเชื่อมต่อของเซิร์ฟเวอร์บอตนะคะ',
  JOIN_VOICE: 'เข้าห้องเสียงก่อน แล้วค่อยสั่งเพลงนะคะ',
  STAGE_UNSUPPORTED: 'ใช้ห้อง Voice ปกตินะคะ ตอนนี้ยังไม่รองรับ Stage ค่ะ',
  VOICE_PERMISSIONS: 'Pim ต้องมีสิทธิ์ View Channel, Connect และ Speak ในห้องเสียงนี้ค่ะ',
  OTHER_CHANNEL: 'Pim อยู่ในห้องเสียงอื่นค่ะ ต้องอยู่ห้องเดียวกับ Pim เพื่อเพิ่มหรือควบคุมเพลง',
  QUEUE_FULL: 'คิวเต็มแล้วค่ะ รอเพลงก่อนหน้าเล่นก่อนนะคะ (สูงสุด 25 เพลงที่รอเล่น)',
  NOTHING_PLAYING: 'ตอนนี้ไม่มีเพลงให้ข้ามค่ะ',
  CANCELLED: 'ยกเลิกคำขอเพลงนี้แล้วค่ะ',
};
function errorText(code) { return errors[code] ?? 'คำสั่งเพลงทำงานไม่สำเร็จค่ะ ลองอีกครั้งนะคะ'; }
function title(track) { return escapeMarkdown(String(track?.title ?? 'กำลังค้นหาเพลง…').replace(/[\r\n]/g, ' ').slice(0, 60)); }
function song(track) { return track?.url ? `[${title(track)}](<${track.url}>)` : title(track); }
function payload(content) { return { content, allowedMentions: { parse: [] } }; }

function createMusicHandler({ manager, controlChannelId, announce, logger = console }) {
  const playTails = new Map();
  const controlTails = new Map();
  const pendingPlays = new Map();
  const stoppedAt = new Map();
  let sequence = 0;
  return async interaction => {
    if (!interaction.isChatInputCommand?.() || !names.has(interaction.commandName)) return false;
    if (interaction.channelId !== controlChannelId || !interaction.guild) {
      await interaction.reply({ ...payload(`ใช้คำสั่งเพลงใน <#${controlChannelId}> นะคะ`), flags: MessageFlags.Ephemeral });
      return true;
    }
    const guild = interaction.guild;
    const ticket = ++sequence;
    const isPlay = interaction.commandName === 'play';
    const isControl = interaction.commandName === 'skip' || interaction.commandName === 'stop';
    let previous;
    let release;
    let tail;
    // Reserve before Discord REST awaits. Controls can cancel an earlier play's
    // preflight; later plays wait for earlier controls to finish their mutation.
    if (isPlay) {
      if ((pendingPlays.get(guild.id) ?? 0) >= 25) {
        await interaction.reply({ ...payload(errorText('QUEUE_FULL')), flags: MessageFlags.Ephemeral });
        return true;
      }
      pendingPlays.set(guild.id, (pendingPlays.get(guild.id) ?? 0) + 1);
      previous = Promise.all([playTails.get(guild.id), controlTails.get(guild.id)]);
      const turn = new Promise(resolve => { release = resolve; });
      tail = previous.then(() => turn);
      playTails.set(guild.id, tail);
    } else if (isControl) {
      previous = controlTails.get(guild.id) ?? Promise.resolve();
      const turn = new Promise(resolve => { release = resolve; });
      tail = previous.then(() => turn);
      controlTails.set(guild.id, tail);
    }
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.commandName === 'queue') {
        const queue = manager.queue(guild.id);
        const lines = [queue.current ? `🎵 กำลังเล่น: ${song(queue.current)}` : 'ตอนนี้ไม่มีเพลงกำลังเล่นค่ะ'];
        for (const [index, track] of queue.upcoming.slice(0, 10).entries()) lines.push(`${index + 1}. ${song(track)}`);
        if (queue.upcoming.length > 10) lines.push(`และอีก ${queue.upcoming.length - 10} เพลง`);
        await interaction.editReply(payload(lines.join('\n')));
        return true;
      }
      if (isPlay || isControl) await previous;
      const member = await guild.members.fetch({ user: interaction.user.id, force: true });
      let channel = member.voice.channel;
      if (!channel) throw musicError('JOIN_VOICE');
      if (channel.type !== ChannelType.GuildVoice) throw musicError('STAGE_UNSUPPORTED');
      if (interaction.commandName === 'play') {
        const bot = guild.members.fetchMe ? await guild.members.fetchMe({ force: true }) : guild.members.me;
        channel = member.voice.channel;
        if (!channel) throw musicError('JOIN_VOICE');
        if (channel.type !== ChannelType.GuildVoice) throw musicError('STAGE_UNSUPPORTED');
        if (!channel.permissionsFor(bot)?.has([P.ViewChannel, P.Connect, P.Speak])) throw musicError('VOICE_PERMISSIONS');
        if ((stoppedAt.get(`${guild.id}:${channel.id}`) ?? 0) > ticket) throw musicError('CANCELLED');
        const pending = manager.enqueue({ guild, channel, query: interaction.options.getString('query', true),
          requesterId: interaction.user.id, announce });
        release();
        release = null;
        const result = await pending;
        await interaction.editReply(payload(result.position === 0
          ? `🎵 กำลังเตรียมเล่น ${song(result.track)}` : `➕ เพิ่ม ${song(result.track)} ในคิวลำดับ ${result.position} แล้วค่ะ`));
      } else if (interaction.commandName === 'skip') {
        manager.skip(guild.id, channel.id);
        release();
        release = null;
        await interaction.editReply(payload('⏭️ ข้ามเพลงแล้วค่ะ'));
      } else {
        manager.stop(guild.id, channel.id);
        const key = `${guild.id}:${channel.id}`;
        stoppedAt.set(key, Math.max(stoppedAt.get(key) ?? 0, ticket));
        release();
        release = null;
        await interaction.editReply(payload('⏹️ หยุดเพลง ล้างคิว และออกจากห้องเสียงแล้วค่ะ'));
      }
    } catch (error) {
      logger.warn(`Pim music command failed; command=${interaction.commandName}; code=${error.code ?? error.name ?? 'unknown'}`);
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload(errorText(error.code)));
      else await interaction.reply({ ...payload(errorText(error.code)), flags: MessageFlags.Ephemeral });
    } finally {
      release?.();
      if (isPlay) {
        const count = (pendingPlays.get(guild.id) ?? 1) - 1;
        if (count) pendingPlays.set(guild.id, count); else pendingPlays.delete(guild.id);
        void tail.then(() => { if (playTails.get(guild.id) === tail) playTails.delete(guild.id); });
      } else if (isControl) {
        void tail.then(() => { if (controlTails.get(guild.id) === tail) controlTails.delete(guild.id); });
      }
    }
    return true;
  };
}

async function startMusic({ client, channelId = process.env.PAT_STOPWATCH_CHANNEL_ID?.trim(),
  manager, source, logger = console } = {}) {
  if (!channelId) throw new Error('Missing PAT_STOPWATCH_CHANNEL_ID for Pim music');
  const channel = await client.channels.fetch(channelId);
  if (!channel?.guild || !channel.isSendable?.()
    || !channel.permissionsFor(channel.guild.members.me)?.has([P.ViewChannel, P.SendMessages])) {
    throw new Error('Invalid PAT_STOPWATCH_CHANNEL_ID for Pim music');
  }
  const announce = event => channel.send(payload(event.type === 'playing'
    ? `🎶 Pim กำลังเล่น ${song(event.track)}`
    : `⚠️ ${event.track ? `${title(event.track)}: ` : ''}${errorText(event.code)}`));
  manager ||= createMusicManager({ source: source ?? createYouTubeSource(), botUserId: client.user.id, logger });
  try {
    for (const command of commands) await channel.guild.commands.create(command);
  } catch (error) { manager.shutdown(); throw error; }
  const handle = createMusicHandler({ manager, controlChannelId: channelId, announce, logger });
  const jobs = new Set();
  const onInteraction = interaction => {
    const job = handle(interaction).catch(error => logger.warn(`Pim music interaction failed; code=${error.code ?? error.name ?? 'unknown'}`));
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
  };
  const onVoice = (oldState, newState) => manager.voiceStateUpdate(oldState, newState);
  client.on(Events.InteractionCreate, onInteraction);
  client.on(Events.VoiceStateUpdate, onVoice);
  logger.log('Pim music ready in PAT_STOPWATCH_CHANNEL_ID.');
  let stopped;
  return { stop() {
    if (stopped) return stopped;
    client.removeListener(Events.InteractionCreate, onInteraction);
    client.removeListener(Events.VoiceStateUpdate, onVoice);
    manager.shutdown();
    stopped = Promise.allSettled([...jobs]);
    return stopped;
  } };
}

module.exports = { startMusic, createMusicHandler };
