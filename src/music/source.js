const { spawn: spawnProcess } = require('node:child_process');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const { configuredCookieFile, prepareCookieJar } = require('./cookies');

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

function collectYouTubeFailure(child) {
  let tail = '';
  let code;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => {
    // Keep a bounded overlap for messages split across chunks. Only allowlisted
    // codes leave this closure; stderr can contain signed media URLs or secrets.
    tail = (tail + data).slice(-8192);
    if (/confirm you[’']?re not a bot|confirm you are not a bot/i.test(tail)) code = 'YOUTUBE_BOT_BLOCKED';
    else if (/not (?:made .* available|available) in your country|not available in this (?:country|region)|geo.?restrict/i.test(tail)) code = 'YOUTUBE_REGION_BLOCKED';
    else if (/private video|video is private|confirm your age|age.?restrict|members.only|login required/i.test(tail)) code = 'YOUTUBE_RESTRICTED';
    else if (/HTTP (?:Error )?429|too many requests/i.test(tail)) code = 'YOUTUBE_RATE_LIMITED';
    else if (/HTTP (?:Error )?403|403: Forbidden/i.test(tail)) code = 'YOUTUBE_ACCESS_DENIED';
    else if (/timed out|timeout|temporary failure in name resolution|unable to resolve host/i.test(tail)) code = 'YOUTUBE_TIMEOUT';
    else if (/no supported JavaScript runtime|challenge solving failed|signature extraction failed|requested format is not available|unrecognized arguments|no such option/i.test(tail)) code = 'EXTRACTOR_FAILED';
  });
  return () => code;
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
  if ((item.availability && !['public', 'unlisted'].includes(item.availability)) || item.age_limit >= 18) {
    throw musicError('YOUTUBE_RESTRICTED');
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
  ffmpegPath, cookieFile = configuredCookieFile(), spawn = spawnProcess, timeoutMs = 30_000 } = {}) {
  ffmpegPath ||= process.env.PIM_FFMPEG_PATH || require('ffmpeg-static');
  const common = ['--ignore-config', '--no-cache-dir', '--no-playlist',
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
      const cookies = prepareCookieJar(cookieFile);
      return new Promise((resolve, reject) => {
        let child;
        try { child = spawn(ytDlpPath, [...common, ...cookies.args, '--dump-single-json', '--skip-download', '-f', 'bestaudio/best', '--', target], options); }
        catch { cookies.cleanup(); reject(musicError('EXTRACTOR_FAILED')); return; }
        child.once('close', cookies.cleanup);
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
        const failureCode = collectYouTubeFailure(child);
        child.once('error', () => finish(musicError('EXTRACTOR_FAILED')));
        child.once('close', code => {
          if (code !== 0) { finish(musicError(failureCode() ?? 'YOUTUBE_UNAVAILABLE')); return; }
          try { finish(null, parseTrack(JSON.parse(output))); }
          catch (error) { finish(error.code ? error : musicError('EXTRACTOR_FAILED')); }
        });
      });
    },

    async open(track, { signal } = {}) {
      const target = normalizeQuery(track.url);
      if (signal?.aborted) throw aborted();
      const cookies = prepareCookieJar(cookieFile);
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
        extractor = spawn(ytDlpPath, [...common, ...cookies.args, '-f', 'bestaudio/best', '-o', '-', '--', target], options);
        extractor.once('close', cookies.cleanup);
        decoder = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
          '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], options);
      } catch { close(); if (!extractor) cookies.cleanup(); throw musicError('EXTRACTOR_FAILED'); }
      const failureCode = collectYouTubeFailure(extractor);
      decoder.stderr.resume();
      extractor.stdout.pipe(decoder.stdin);
      decoder.stdout.pipe(stream);
      decoder.stdin.on('error', () => fail(failureCode() ?? 'AUDIO_FAILED'));
      extractor.once('error', () => fail('EXTRACTOR_FAILED'));
      decoder.once('error', () => fail(failureCode() ?? 'AUDIO_FAILED'));
      extractor.once('close', code => { if (code !== 0) fail(failureCode() ?? 'YOUTUBE_UNAVAILABLE'); });
      decoder.once('close', code => { if (code !== 0) fail(failureCode() ?? 'AUDIO_FAILED'); });
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
