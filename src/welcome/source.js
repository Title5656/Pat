const { spawn } = require('node:child_process');
const MAX_BYTES = 5 * 1024 * 1024;
const error = code => Object.assign(new Error(code), { code });
function audioUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw error('AUDIO_URL'); }
  if (u.protocol !== 'https:' || !/^s3\.[a-z]+-[a-z]+-\d+\.backblazeb2\.com$/.test(u.hostname)
    || u.port || u.username || u.password || u.hash) throw error('AUDIO_URL');
  return u.href;
}
function createWelcomeSource({ fetchFn = fetch, ffmpeg = require('ffmpeg-static') } = {}) {
  async function download(url, signal) {
    const response = await fetchFn(audioUrl(url), { redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]) });
    if (!response.ok) throw error('AUDIO_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw error('FILE_TOO_LARGE'); }
    const chunks = []; let size = 0;
    if (!response.body) throw error('AUDIO_INVALID');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw error('FILE_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    if (!size) throw error('AUDIO_INVALID');
    return Buffer.concat(chunks);
  }
  function decode(bytes, seconds, signal) {
    const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-vn', '-t', String(seconds),
      '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let rejectDone, settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const done = new Promise((resolve, reject) => {
      rejectDone = reject;
      child.once('error', () => { if (!settled) { settled = true; cleanup(); reject(error('AUDIO_INVALID')); } });
      child.once('close', code => {
        if (settled) return;
        settled = true; cleanup();
        if (code === 0) resolve(); else { child.stdout.destroy(error('AUDIO_INVALID')); reject(error('AUDIO_INVALID')); }
      });
    });
    // Keep cancellation safe before the caller has subscribed to the returned stream.
    child.stdout.on('error', () => {});
    child.stdin.on('error', () => {});
    const cancel = () => {
      if (!settled) { settled = true; cleanup(); rejectDone(error('AUDIO_CANCELLED')); }
      child.kill('SIGKILL'); child.stdout.destroy(error('AUDIO_CANCELLED'));
    };
    const timer = setTimeout(cancel, 25000); timer.unref?.();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel(); else child.stdin.end(bytes);
    void done.catch(() => {});
    return { stream: child.stdout, done, close: cancel };
  }
  return {
    async inspect(url) {
      const audio = decode(await download(url), 16);
      let size = 0;
      try { for await (const chunk of audio.stream) size += chunk.length; await audio.done; }
      catch { audio.close(); throw error('AUDIO_INVALID'); }
      const durationMs = size / 192;
      if (!size) throw error('AUDIO_INVALID');
      if (durationMs > 15000) throw error('AUDIO_TOO_LONG');
      return { durationMs };
    },
    async open(sound, { signal } = {}) { return decode(await download(sound.url, signal), 15, signal); },
  };
}
module.exports = { createWelcomeSource, audioUrl };
