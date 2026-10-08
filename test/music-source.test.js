const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createYouTubeSource, normalizeQuery, parseTrack } = require('../src/music/source');

test('canonicalizes a single YouTube video and drops playlist parameters', () => {
  assert.equal(normalizeQuery('https://youtu.be/abcdefghijk?list=PL123'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(normalizeQuery('https://www.youtube.com/shorts/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(normalizeQuery('ลมหนาว'), 'ytsearch1:ลมหนาว');
});

test('rejects non-YouTube URLs, option-like inputs, missing videos, and oversized searches', () => {
  for (const input of ['', '-o /tmp/file', 'https://example.com/a', 'file:///etc/passwd',
    'https://youtube.com/playlist?list=PL1', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'x'.repeat(201)]) {
    assert.throws(() => normalizeQuery(input));
  }
});

test('accepts only playable public video metadata and canonical URLs', () => {
  assert.deepEqual(parseTrack({ id: 'abcdefghijk', title: 'Song', duration: 123 }),
    { title: 'Song', duration: 123, url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(parseTrack({ entries: [{ id: 'abcdefghijk', title: 'Result' }] }).title, 'Result');
  for (const metadata of [{}, { entries: [] }, { id: 'bad', title: 'Song' },
    { id: 'abcdefghijk', title: 'Live', is_live: true }, { id: 'abcdefghijk', title: 'Upcoming', live_status: 'is_upcoming' }]) {
    assert.throws(() => parseTrack(metadata));
  }
});

function subprocess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit('close', null, 'SIGTERM'); return true; };
  return child;
}

test('resolves through bounded shell-free yt-dlp metadata without leaking stderr', async () => {
  let args;
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg',
    spawn: (_bin, argv, options) => {
      args = argv;
      assert.equal(options.shell, false);
      const child = subprocess();
      queueMicrotask(() => {
        child.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Song' }));
        child.emit('close', 0);
      });
      return child;
    } });
  const track = await source.resolve('name $(echo secrets)');
  assert.equal(track.title, 'Song');
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), 'ytsearch1:name $(echo secrets)');
  assert.ok(args.includes('--js-runtimes'));
});

test('aborting metadata extraction terminates the child and rejects promptly', async () => {
  const child = subprocess();
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => child });
  const controller = new AbortController();
  const pending = source.resolve('Song', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(child.killed, true);
});

test('extractor failures expose a safe error and never signed URLs or stderr', async () => {
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
    const child = subprocess();
    queueMicrotask(() => { child.stderr.write('SECRET_TOKEN signed-url'); child.emit('close', 1); });
    return child;
  } });
  await assert.rejects(source.resolve('Song'), error => error.code === 'YOUTUBE_UNAVAILABLE' && !/SECRET|signed-url/.test(error.message));
});

test('classifies YouTube refusals and extractor failures without exposing stderr', async () => {
  const cases = [
    ["Sign in to confirm you're not a bot", 'YOUTUBE_BOT_BLOCKED'],
    ['Sign in to confirm you’re not a bot', 'YOUTUBE_BOT_BLOCKED'],
    ['The uploader has not made this video available in your country', 'YOUTUBE_REGION_BLOCKED'],
    ['Private video. Sign in if you have been granted access', 'YOUTUBE_RESTRICTED'],
    ['Sign in to confirm your age', 'YOUTUBE_RESTRICTED'],
    ['HTTP Error 403: Forbidden', 'YOUTUBE_ACCESS_DENIED'],
    ['HTTP Error 429: Too Many Requests', 'YOUTUBE_RATE_LIMITED'],
    ['Unable to download webpage: The read operation timed out', 'YOUTUBE_TIMEOUT'],
    ['No supported JavaScript runtime could be found. Requested format is not available', 'EXTRACTOR_FAILED'],
  ];
  for (const [diagnostic, code] of cases) {
    const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
      const child = subprocess();
      queueMicrotask(() => {
        child.stderr.write(`SECRET_TOKEN https://audio.example/?signature=SECRET ${diagnostic}`);
        child.emit('close', 1);
      });
      return child;
    } });
    await assert.rejects(source.resolve('Song'), error => {
      assert.equal(error.code, code, diagnostic);
      assert.equal(error.message, code);
      assert.doesNotMatch(JSON.stringify(error), /SECRET|signature|audio\.example/);
      return true;
    });
  }
});

test('detects a bot challenge split across stderr chunks after large output', async () => {
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
    const child = subprocess();
    queueMicrotask(() => {
      child.stderr.write('x'.repeat(100_000));
      child.stderr.write('Sign in to confirm you');
      child.stderr.write("'re not a bot");
      child.emit('close', 1);
    });
    return child;
  } });
  await assert.rejects(source.resolve('Song'), { code: 'YOUTUBE_BOT_BLOCKED' });
});

test('audio is piped to FFmpeg and close terminates both subprocesses', async () => {
  const children = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: (_bin, args) => {
    const child = subprocess();
    children.push({ child, args });
    return child;
  } });
  const opened = await source.open({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(children.length, 2);
  assert.ok(children[0].args.includes('-o'));
  assert.ok(children[1].args.includes('s16le'));
  children[1].child.stdout.write(Buffer.from([1, 2]));
  assert.deepEqual(opened.stream.read(), Buffer.from([1, 2]));
  opened.close();
  assert.ok(children.every(({ child }) => child.killed));
});

test('audio process errors reach the stream and cancel the other process', async () => {
  const children = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
    const child = subprocess(); children.push(child); return child;
  } });
  const opened = await source.open({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const error = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].emit('close', 1);
  assert.equal((await error).code, 'YOUTUBE_UNAVAILABLE');
  assert.ok(children.every(child => child.killed));
});

test('audio extraction preserves the classified refusal and cleans up both children', async () => {
  const children = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
    const child = subprocess(); children.push(child); return child;
  } });
  const opened = await source.open({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const error = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].stderr.write("ERROR: Sign in to confirm you're not a bot https://audio.example/?signature=SECRET");
  children[0].emit('close', 1);
  assert.equal((await error).code, 'YOUTUBE_BOT_BLOCKED');
  assert.ok(children.every(child => child.killed));
});

test('a decoder failure after a YouTube refusal keeps the original cause', async () => {
  const children = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', spawn: () => {
    const child = subprocess(); children.push(child); return child;
  } });
  const opened = await source.open({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const error = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].stderr.write('ERROR: HTTP Error 403: Forbidden');
  children[1].emit('close', 1);
  assert.equal((await error).code, 'YOUTUBE_ACCESS_DENIED');
  assert.ok(children.every(child => child.killed));
});
