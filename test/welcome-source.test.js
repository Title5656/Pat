const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createWelcomeSource } = require('../src/welcome/source');
function wav(seconds) {
  const result = spawnSync(require('ffmpeg-static'), ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-f', 'wav', 'pipe:1'], { maxBuffer: 5 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
}
function compressed(format, flags = []) {
  const result = spawnSync(require('ffmpeg-static'), ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', ...flags, '-f', format, 'pipe:1'], { maxBuffer: 5 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout;
}
const url = 'https://s3.us-west-004.backblazeb2.com/bucket/hello.wav?signature=private';
test('decodes actual audio and measures duration on the server', async () => {
  const source = createWelcomeSource({ fetchFn: async () => new Response(wav(1)) });
  const result = await source.inspect(url);
  assert.ok(result.durationMs >= 990 && result.durationMs <= 1010);
});
test('accepts real MP3, OGG and M4A audio as well as WAV', async () => {
  for (const bytes of [compressed('mp3'), compressed('ogg'), compressed('mp4', ['-movflags', 'frag_keyframe+empty_moov'])]) {
    const result = await createWelcomeSource({ fetchFn: async () => new Response(bytes) }).inspect(url);
    assert.ok(result.durationMs >= 900 && result.durationMs <= 1200);
  }
});
test('rejects invalid audio bytes and files longer than 15 seconds', async () => {
  await assert.rejects(createWelcomeSource({ fetchFn: async () => new Response('not audio') }).inspect(url), { code: 'AUDIO_INVALID' });
  await assert.rejects(createWelcomeSource({ fetchFn: async () => new Response(wav(16)) }).inspect(url), { code: 'AUDIO_TOO_LONG' });
});
test('rejects non-B2 URLs, redirects and oversized download declarations', async () => {
  const source = createWelcomeSource({ fetchFn: async () => new Response('', { headers: { 'content-length': '5242881' } }) });
  await assert.rejects(source.inspect('http://127.0.0.1/private'), { code: 'AUDIO_URL' });
  await assert.rejects(source.inspect('https://evil.example/hello.mp3'), { code: 'AUDIO_URL' });
  await assert.rejects(source.inspect(url), { code: 'FILE_TOO_LARGE' });
});
test('playback stops its decoding process when cancelled', async () => {
  const source = createWelcomeSource({ fetchFn: async () => new Response(wav(2)) });
  const controller = new AbortController();
  const audio = await source.open({ url }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(audio.done, { code: 'AUDIO_CANCELLED' });
  assert.equal(audio.stream.destroyed, true);
});
