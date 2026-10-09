const { PermissionFlagsBits: P } = require('discord.js');
function createWelcomeManager({ resolve, source, voice = require('@discordjs/voice'), musicBusy = () => false,
  botUserId, now = Date.now, logger = console, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const guilds = new Map(), cooldown = new Map();
  let stopped = false;
  function current(state, entry) {
    return !stopped && !state.closed && !entry.controller.signal.aborted && now() - entry.created < 30000
      && entry.member.voice?.channelId === entry.channel.id && !musicBusy(state.guild.id);
  }
  async function play(state, entry, sound) {
    const me = state.guild.members.me ?? await state.guild.members.fetchMe();
    if (!entry.channel.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.Speak]) || !current(state, entry)) return;
    // Download before joining so a slow or failed B2 request does not occupy voice.
    const audio = await source.open(sound, { signal: entry.controller.signal });
    if (!current(state, entry) || voice.getVoiceConnection?.(state.guild.id)) { audio.close(); return; }
    let connection, player, timer;
    let finish;
    const done = new Promise(r => { finish = r; });
    entry.finish = finish;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true; clearTimer(timer); entry.finish = null; entry.close = null;
      entry.controller.signal.removeEventListener('abort', cancel);
      audio.close(); player?.stop(true);
      if (connection && connection.state?.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
      state.channelId = null; state.voiceReady = false;
    };
    const cancel = () => { finish(); close(); };
    entry.close = cancel;
    entry.controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Stop } });
      connection = voice.joinVoiceChannel({ guildId: state.guild.id, channelId: entry.channel.id,
        adapterCreator: state.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
      state.channelId = entry.channel.id;
      state.voiceReady = false;
      connection.subscribe(player);
      connection.on('error', finish);
      connection.on(voice.VoiceConnectionStatus.Disconnected, finish);
      connection.on(voice.VoiceConnectionStatus.Destroyed, finish);
      player.on('error', finish);
      player.on('stateChange', (before, after) => { if (after.status === voice.AudioPlayerStatus.Idle && before.status !== after.status) finish(); });
      audio.stream.on('error', finish);
      timer = setTimer(finish, 30000); timer.unref?.();
      await Promise.race([voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 10000), done.then(() => { throw new Error('VOICE_CANCELLED'); })]);
      if (!current(state, entry)) return;
      state.voiceReady = true;
      player.play(voice.createAudioResource(audio.stream, { inputType: voice.StreamType.Raw }));
      await Promise.race([voice.entersState(player, voice.AudioPlayerStatus.Playing, 5000), done.then(() => { throw new Error('VOICE_CANCELLED'); })]);
      clearTimer(timer);
      timer = setTimer(finish, Math.min(sound.durationMs ?? 15000, 15000) + 250); timer.unref?.();
      await done;
    } finally {
      close();
    }
  }
  async function pump(state) {
    if (state.running) return;
    state.running = true;
    while (!stopped && !state.closed && state.queue.length) {
      const entry = state.queue.shift(); state.current = entry;
      try {
        const sound = await entry.sound;
        if (sound && current(state, entry)) await play(state, entry, sound);
      } catch { if (!entry.controller.signal.aborted) logger.warn('Pim welcome playback failed; code=WELCOME_PLAYBACK_FAILED'); }
      finally { entry.controller.abort(); state.current = null; }
    }
    if (guilds.get(state.guild.id) === state) guilds.delete(state.guild.id);
  }
  function cancelGuild(id) {
    const state = guilds.get(id);
    if (!state) return;
    state.closed = true; guilds.delete(id);
    state.current?.controller.abort(); state.current?.finish?.();
    state.current?.close?.();
    for (const entry of state.queue) entry.controller.abort();
    state.queue.length = 0;
  }
  return {
    voiceStateUpdate(oldState, newState) {
      const member = newState.member ?? oldState.member;
      const guild = newState.guild ?? oldState.guild;
      if (!member || !guild || stopped) return false;
      const state = guilds.get(guild.id);
      if ((newState.id ?? member.id) === botUserId && state?.channelId && newState.channelId !== state.channelId
        && (newState.channelId !== null || state.voiceReady)) { cancelGuild(guild.id); return false; }
      if (state?.current?.member.id === member.id && newState.channelId !== state.current.channel.id) state.current.controller.abort();
      if (member.user?.bot || !newState.channelId || oldState.channelId === newState.channelId
        || newState.channel?.type !== 2 || musicBusy(guild.id)) return false;
      const key = `${guild.id}:${member.id}`, time = now();
      if (cooldown.has(key) && time - cooldown.get(key) < 30000) return false;
      if ((state?.queue.length ?? 0) >= 10) return false;
      for (const [id, at] of cooldown) if (time - at >= 30000) cooldown.delete(id);
      cooldown.set(key, time);
      const next = state ?? { guild, queue: [], closed: false, running: false };
      guilds.set(guild.id, next);
      const entry = { member, channel: newState.channel, created: time, controller: new AbortController() };
      entry.sound = Promise.resolve().then(() => resolve(guild.id, member.id, entry.controller.signal)).catch(() => {
        if (!entry.controller.signal.aborted) logger.warn('Pim welcome lookup failed; code=WELCOME_LOOKUP_FAILED');
        return null;
      });
      next.queue.push(entry); void pump(next);
      return true;
    },
    cancelGuild,
    shutdown() { stopped = true; for (const id of guilds.keys()) cancelGuild(id); cooldown.clear(); },
  };
}
module.exports = { createWelcomeManager };
