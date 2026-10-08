const { spawn: spawnProcess } = require('node:child_process');
const { PassThrough } = require('node:stream');
const path = require('node:path');

function musicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function aborted() {
  const error = musicError('CANCELLED');
  error.name = 'AbortError';
  return error;
}

function normalizeQuery(input) {
  const query = String(input ?? '').trim();
  if (!query || query.startsWith('-') || query.length > 2000) throw musicError('INVALID_QUERY');
  if (/^(?:https?:\/\/|(?:www\.|music\.|m\.)?youtube\.com\/|youtu\.be\/)/i.test(query)) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(query) ? query : `https://${query}`); }
    catch { throw musicError('INVALID_QUERY'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
      throw musicError('INVALID_QUERY');
    }
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
      : url.pathname === '/watch' ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
    if (!/^[A-Za-z0-9_-]{11}$/.test(id ?? '')) throw musicError('INVALID_QUERY');
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (query.length > 200 || /^[a-z][a-z0-9+.-]*:/i.test(query)) throw musicError('INVALID_QUERY');
  return `ytsearch1:${query}`;
}

function parseTrack(metadata) {
  const item = Array.isArray(metadata?.entries) ? metadata.entries.find(Boolean) : metadata;
  if (!/^[A-Za-z0-9_-]{11}$/.test(item?.id ?? '') || typeof item.title !== 'string' || !item.title.trim()) {
    throw musicError('YOUTUBE_UNAVAILABLE');
  }
  if (item.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(item.live_status)) {
    throw musicError('LIVE_UNSUPPORTED');
  }
  return { title: item.title.trim().slice(0, 200),
    duration: Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : null,
    url: `https://www.youtube.com/watch?v=${item.id}` };
}

function createYouTubeSource({ ytDlpPath = process.env.PIM_YTDLP_PATH
  || path.join(__dirname, '../../.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
  ffmpegPath, spawn = spawnProcess, timeoutMs = 30_000 } = {}) {
  ffmpegPath ||= process.env.PIM_FFMPEG_PATH || require('ffmpeg-static');
  const common = ['--ignore-config', '--no-cache-dir', '--no-playlist', '--no-warnings',
    '--socket-timeout', '15', '--retries', '1', '--extractor-retries', '1', '--force-ipv4',
    '--js-runtimes', `node:${process.execPath}`];
  const options = { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
  function kill(child) {
    if (!child || child.exitCode != null || child.killed) return;
    child.kill('SIGTERM');
    const force = setTimeout(() => { if (child.exitCode == null) child.kill('SIGKILL'); }, 2000);
    force.unref?.();
    child.once('close', () => clearTimeout(force));
  }

  return {
    async resolve(query, { signal } = {}) {
      const target = normalizeQuery(query);
      if (signal?.aborted) throw aborted();
      return new Promise((resolve, reject) => {
        let child;
        try { child = spawn(ytDlpPath, [...common, '--dump-single-json', '--skip-download', '-f', 'bestaudio/best', '--', target], options); }
        catch { reject(musicError('EXTRACTOR_FAILED')); return; }
        let output = '';
        let settled = false;
        const timer = setTimeout(() => finish(musicError('YOUTUBE_TIMEOUT')), timeoutMs);
        timer.unref?.();
        function finish(error, track) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          if (error) kill(child);
          error ? reject(error) : resolve(track);
        }
        function cancel() { finish(aborted()); }
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', data => {
          output += data;
          if (output.length > 4 * 1024 * 1024) finish(musicError('EXTRACTOR_FAILED'));
        });
        child.stderr.resume();
        child.once('error', () => finish(musicError('EXTRACTOR_FAILED')));
        child.once('close', code => {
          if (code !== 0) { finish(musicError('YOUTUBE_UNAVAILABLE')); return; }
          try { finish(null, parseTrack(JSON.parse(output))); }
          catch (error) { finish(error.code ? error : musicError('EXTRACTOR_FAILED')); }
        });
      });
    },

    async open(track, { signal } = {}) {
      const target = normalizeQuery(track.url);
      if (signal?.aborted) throw aborted();
      const stream = new PassThrough();
      let extractor;
      let decoder;
      let closed = false;
      let timer;
      function close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        extractor?.stdout.unpipe();
        decoder?.stdout.unpipe();
        decoder?.stdin.destroy();
        kill(extractor);
        kill(decoder);
        stream.destroy();
      }
      function fail(code) {
        if (closed) return;
        stream.destroy(musicError(code));
        close();
      }
      function cancel() { close(); }
      try {
        extractor = spawn(ytDlpPath, [...common, '-f', 'bestaudio/best', '-o', '-', '--', target], options);
        decoder = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
          '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], options);
      } catch { close(); throw musicError('EXTRACTOR_FAILED'); }
      extractor.stderr.resume();
      decoder.stderr.resume();
      extractor.stdout.pipe(decoder.stdin);
      decoder.stdout.pipe(stream);
      decoder.stdin.on('error', () => fail('AUDIO_FAILED'));
      extractor.once('error', () => fail('EXTRACTOR_FAILED'));
      decoder.once('error', () => fail('AUDIO_FAILED'));
      extractor.once('close', code => { if (code !== 0) fail('YOUTUBE_UNAVAILABLE'); });
      decoder.once('close', code => { if (code !== 0) fail('AUDIO_FAILED'); });
      timer = setTimeout(() => fail('YOUTUBE_TIMEOUT'), timeoutMs);
      timer.unref?.();
      decoder.stdout.once('data', () => clearTimeout(timer));
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) close();
      return { stream, close };
    },
  };
}

module.exports = { createYouTubeSource, normalizeQuery, parseTrack, musicError };
