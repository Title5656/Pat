const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createYouTubeSource } = require('../src/music/source');

function child() {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.killed = false;
  process.kill = () => { process.killed = true; process.emit('close', null); return true; };
  return process;
}

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const children = [], logs = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile: '',
    logger: { warn: line => logs.push(line) },
    spawn: () => { const process = child(); children.push(process); return process; }, ...options });
  return { source, children, logs };
}

test('metadata that takes 35 seconds still resolves', async t => {
  const { source, children } = setup(t);
  const pending = source.resolve('Song');
  void pending.catch(() => {});
  t.mock.timers.tick(35_000);
  children[0].stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Song' }));
  children[0].emit('close', 0);
  assert.equal((await pending).title, 'Song');
  assert.equal(children[0].killed, false);
});

test('first PCM arriving after 35 seconds plays and cancels the startup deadline', async t => {
  const { source, children, logs } = setup(t);
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  const errors = [];
  opened.stream.on('error', error => errors.push(error));
  t.mock.timers.tick(35_000);
  assert.equal(opened.stream.destroyed, false);
  children[1].stdout.write(Buffer.from([1, 2]));
  assert.deepEqual(opened.stream.read(), Buffer.from([1, 2]));
  t.mock.timers.tick(90_000);
  assert.equal(opened.stream.destroyed, false);
  assert.equal(errors.length, 0);
  assert.equal(logs.length, 0);
  opened.close();
});

test('an audio startup with no media is still bounded at 90 seconds', async t => {
  const { source, children, logs } = setup(t);
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  const failure = new Promise(resolve => opened.stream.once('error', resolve));
  t.mock.timers.tick(89_999);
  assert.equal(opened.stream.destroyed, false);
  t.mock.timers.tick(1);
  assert.equal((await failure).code, 'YOUTUBE_TIMEOUT');
  assert.ok(children.every(process => process.killed));
  assert.match(logs[0], /elapsedMs=90000;.*receivedMedia=false/);
});

test('cancelling a slow startup terminates it immediately without waiting for the deadline', async t => {
  const { source, children, logs } = setup(t);
  const controller = new AbortController();
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' }, { signal: controller.signal });
  t.mock.timers.tick(35_000);
  controller.abort();
  assert.ok(children.every(process => process.killed));
  assert.equal(opened.stream.destroyed, true);
  t.mock.timers.tick(90_000);
  assert.equal(logs.length, 0);
});

test('stalled JavaScript extraction logs only safe startup diagnostics and kills both children', async t => {
  const { source, children, logs } = setup(t, { timeoutMs: 100 });
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  const failure = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].stderr.write('[youtube] Downloading webpage\n[youtube] [jsc:node] Solving JS challenges using node\nSECRET_TOKEN https://media.example/?signature=SECRET\n');
  t.mock.timers.tick(100);
  assert.equal((await failure).code, 'YOUTUBE_TIMEOUT');
  assert.ok(children.every(process => process.killed));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /phase=audio; stage=javascript; code=YOUTUBE_TIMEOUT; elapsedMs=100; cookies=none; receivedMedia=false/);
  assert.doesNotMatch(logs[0], /SECRET|signature|media\.example|Solving|abcdefghijk/);
});

test('a decoder stall is distinguished from waiting for YouTube media', async t => {
  const { source, children, logs } = setup(t, { timeoutMs: 100 });
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  const failure = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].stdout.write(Buffer.from([1, 2]));
  t.mock.timers.tick(100);
  assert.equal((await failure).code, 'YOUTUBE_TIMEOUT');
  assert.match(logs[0], /stage=decoding;.*receivedMedia=true/);
});

test('a bot refusal observed before a metadata deadline keeps its cause', async t => {
  const { source, children, logs } = setup(t, { timeoutMs: 100 });
  const pending = source.resolve('Song');
  const rejected = assert.rejects(pending, { code: 'YOUTUBE_BOT_BLOCKED' });
  children[0].stderr.write("ERROR: Sign in to confirm you're not a bot SECRET_TOKEN");
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(children[0].killed, true);
  assert.match(logs[0], /phase=metadata;.*code=YOUTUBE_BOT_BLOCKED/);
  assert.doesNotMatch(logs[0], /SECRET|Song|Sign in/);
});

test('an HTTP refusal observed before an audio deadline keeps its cause', async t => {
  const { source, children, logs } = setup(t, { timeoutMs: 100 });
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  const failure = new Promise(resolve => opened.stream.once('error', resolve));
  children[0].stderr.write('ERROR: HTTP Error 403: Forbidden SECRET_TOKEN');
  t.mock.timers.tick(100);
  assert.equal((await failure).code, 'YOUTUBE_ACCESS_DENIED');
  assert.match(logs[0], /phase=audio;.*code=YOUTUBE_ACCESS_DENIED/);
  assert.doesNotMatch(logs[0], /SECRET|HTTP Error/);
});
