const { musicError } = require('./source');

function createMusicManager({ source, voice = require('@discordjs/voice'), botUserId,
  logger = console, setTimer = setTimeout, clearTimer = clearTimeout,
  idleMs = 60_000, maxQueue = 25 } = {}) {
  const sessions = new Map();
  let stopping = false;

  function active(session) { return !session.closed && sessions.get(session.guild.id) === session; }
  function control(session, channelId) {
    if (session && session.channel.id !== channelId) throw musicError('OTHER_CHANNEL');
  }
  function notify(session, event) {
    if (!active(session)) return;
    void Promise.resolve().then(() => session.announce?.(event)).catch(error => {
      logger.warn(`Pim music announcement failed; code=${error.code ?? error.name ?? 'unknown'}`);
    });
  }
  function idle(session) {
    clearTimer(session.idleTimer);
    session.idleTimer = null;
    if (!active(session) || session.current || session.entries.length) return;
    session.idleTimer = setTimer(() => {
      if (active(session) && !session.current && !session.entries.length) destroy(session);
    }, idleMs);
    session.idleTimer.unref?.();
  }
  function occupants(session) {
    const hasHumans = [...(session.channel.members?.values() ?? [])].some(member => !member.user.bot);
    if (hasHumans) {
      clearTimer(session.emptyTimer);
      session.emptyTimer = null;
    } else if (!session.emptyTimer && active(session)) {
      session.emptyTimer = setTimer(() => {
        session.emptyTimer = null;
        if (active(session) && ![...(session.channel.members?.values() ?? [])].some(member => !member.user.bot)) destroy(session);
      }, idleMs);
      session.emptyTimer.unref?.();
    }
  }
  function release(entry) {
    if (!entry) return;
    entry.controller.abort();
    entry.audio?.close();
  }
  function destroy(session) {
    if (!active(session)) return;
    session.closed = true;
    sessions.delete(session.guild.id);
    clearTimer(session.idleTimer);
    clearTimer(session.emptyTimer);
    release(session.current);
    for (const entry of session.entries) release(entry);
    session.entries.length = 0;
    session.current = null;
    session.player.stop(true);
    session.connection.destroy();
  }
  function finish(session, entry, error) {
    if (!active(session) || session.current !== entry) return;
    session.current = null;
    release(entry);
    session.player.stop(true);
    if (error && error.name !== 'AbortError') {
      logger.warn(`Pim music playback failed; code=${error.code ?? error.name ?? 'unknown'}`);
      notify(session, { type: 'error', track: entry.track, code: error.code ?? 'AUDIO_FAILED' });
    }
    pump(session);
  }
  function pump(session) {
    if (!active(session) || session.current) return;
    while (session.entries[0]?.error) session.entries.shift();
    const entry = session.entries[0];
    if (!entry) { idle(session); return; }
    if (!entry.ready) return;
    session.entries.shift();
    session.current = entry;
    clearTimer(session.idleTimer);
    session.idleTimer = null;
    void (async () => {
      try {
        await session.ready;
        if (!active(session) || session.current !== entry) return;
        const audio = await source.open(entry.track, { signal: entry.controller.signal });
        if (!active(session) || session.current !== entry) { audio.close(); return; }
        entry.audio = audio;
        audio.stream.once('error', error => finish(session, entry, error));
        session.player.play(voice.createAudioResource(audio.stream, {
          inputType: voice.StreamType.Raw, metadata: entry,
        }));
        await voice.entersState(session.player, voice.AudioPlayerStatus.Playing, 30_000);
        if (active(session) && session.current === entry) notify(session, { type: 'playing', track: entry.track });
      } catch (error) { finish(session, entry, error); }
    })();
  }
  function createSession(guild, channel, announce) {
    const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
    const connection = voice.joinVoiceChannel({ guildId: guild.id, channelId: channel.id,
      adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    const session = { guild, channel, announce, player, connection, entries: [], current: null, closed: false };
    sessions.set(guild.id, session);
    connection.subscribe(player);
    session.ready = voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 20_000);
    void session.ready.catch(error => {
      if (active(session)) {
        notify(session, { type: 'error', code: 'VOICE_FAILED' });
        logger.warn(`Pim voice connection failed; code=${error.code ?? error.name ?? 'unknown'}`);
        destroy(session);
      }
    });
    connection.on('error', () => destroy(session));
    connection.on(voice.VoiceConnectionStatus.Disconnected, () => destroy(session));
    connection.on(voice.VoiceConnectionStatus.Destroyed, () => destroy(session));
    player.on('stateChange', (before, after) => {
      if (after.status === voice.AudioPlayerStatus.Idle && before.status !== after.status) {
        finish(session, before.resource?.metadata ?? session.current);
      }
    });
    player.on('error', error => finish(session, error.resource?.metadata ?? session.current, error));
    occupants(session);
    return session;
  }

  return {
    async enqueue({ guild, channel, query, requesterId, announce }) {
      if (stopping) throw musicError('CANCELLED');
      let session = sessions.get(guild.id);
      control(session, channel.id);
      session ||= createSession(guild, channel, announce);
      if (session.entries.length >= maxQueue) throw musicError('QUEUE_FULL');
      clearTimer(session.idleTimer);
      session.idleTimer = null;
      const entry = { controller: new AbortController(), ready: false, requesterId };
      session.entries.push(entry);
      try {
        entry.track = await source.resolve(query, { signal: entry.controller.signal });
        if (!active(session) || entry.controller.signal.aborted) throw musicError('CANCELLED');
        entry.ready = true;
        pump(session);
        return { track: entry.track, position: session.current === entry ? 0 : session.entries.indexOf(entry) + 1 };
      } catch (error) {
        entry.error = error;
        release(entry);
        const index = session.entries.indexOf(entry);
        if (index !== -1) session.entries.splice(index, 1);
        pump(session);
        throw error;
      }
    },
    queue(guildId) {
      const session = sessions.get(guildId);
      return { channelId: session?.channel.id ?? null, current: session?.current?.track ?? null,
        upcoming: session?.entries.filter(entry => !entry.error).map(entry => entry.track ?? { title: 'กำลังค้นหาเพลง…', url: null }) ?? [] };
    },
    skip(guildId, channelId) {
      const session = sessions.get(guildId);
      control(session, channelId);
      if (!session) throw musicError('NOTHING_PLAYING');
      if (session.current) { const track = session.current.track; finish(session, session.current); return track; }
      const entry = session.entries.shift();
      if (!entry) throw musicError('NOTHING_PLAYING');
      release(entry);
      pump(session);
      return entry.track ?? null;
    },
    stop(guildId, channelId) {
      const session = sessions.get(guildId);
      control(session, channelId);
      if (!session) return false;
      destroy(session);
      return true;
    },
    voiceStateUpdate(oldState, newState) {
      const session = sessions.get(newState.guild?.id ?? oldState.guild?.id);
      if (!session) return;
      if (botUserId && (newState.id ?? newState.member?.id) === botUserId && newState.channelId !== session.channel.id) {
        destroy(session);
      } else occupants(session);
    },
    shutdown() {
      stopping = true;
      for (const session of sessions.values()) destroy(session);
    },
  };
}

module.exports = { createMusicManager };
