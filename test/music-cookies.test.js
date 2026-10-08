const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createYouTubeSource } = require('../src/music/source');

const contents = '# Netscape HTTP Cookie File\r\n'
  + '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tDUMMY_YOUTUBE_SESSION\r\n'
  + '.unrelated.example\tTRUE\t/\tTRUE\t0\tSID\tDUMMY_UNRELATED_SESSION\r\n';

function fixture(t, text = contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pim-cookie-test-'));
  const filename = path.join(directory, 'youtube-cookies.txt');
  fs.writeFileSync(filename, text, { mode: 0o400 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return filename;
}

function childProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; child.emit('close', null); return true; };
  return child;
}

test('uses a private writable YouTube-only cookie copy and leaves the Render secret unchanged', async t => {
  const cookieFile = fixture(t);
  let copy;
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
    spawn: (_bin, args) => {
      assert.ok(args.includes('--cookies'));
      copy = args[args.indexOf('--cookies') + 1];
      assert.notEqual(copy, cookieFile);
      assert.equal(fs.statSync(copy).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(copy)).mode & 0o777, 0o700);
      const jar = fs.readFileSync(copy, 'utf8');
      assert.match(jar, /DUMMY_YOUTUBE_SESSION/);
      assert.doesNotMatch(jar, /UNRELATED|\r/);
      fs.appendFileSync(copy, '# refreshed by yt-dlp\n');
      const child = childProcess();
      queueMicrotask(() => {
        child.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Song' })); child.emit('close', 0);
      });
      return child;
    } });
  assert.equal((await source.resolve('Song')).title, 'Song');
  assert.equal(fs.existsSync(path.dirname(copy)), false);
  assert.equal(fs.readFileSync(cookieFile, 'utf8'), contents);
});

test('metadata failure and cancellation delete the temporary cookie copy', async t => {
  const cookieFile = fixture(t);
  for (const cancel of [false, true]) {
    let copy;
    const child = childProcess();
    const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
      spawn: (_bin, args) => { copy = args[args.indexOf('--cookies') + 1]; return child; } });
    const controller = new AbortController();
    const pending = source.resolve('Song', { signal: controller.signal });
    if (cancel) controller.abort();
    else { child.stderr.write("Sign in to confirm you're not a bot"); child.emit('close', 1); }
    await assert.rejects(pending, { code: cancel ? 'CANCELLED' : 'YOUTUBE_BOT_BLOCKED' });
    assert.equal(fs.existsSync(path.dirname(copy)), false);
  }
});

test('audio extraction uses cookies and removes them when the extractor closes', async t => {
  const cookieFile = fixture(t);
  const children = [];
  let copy;
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
    spawn: (_bin, args) => {
      const child = childProcess(); children.push(child);
      if (children.length === 1) { assert.ok(args.includes('--cookies')); copy = args[args.indexOf('--cookies') + 1]; }
      else assert.ok(!args.includes('--cookies'));
      return child;
    } });
  const opened = await source.open({ url: 'https://youtu.be/abcdefghijk' });
  assert.equal(fs.existsSync(copy), true);
  opened.close();
  assert.equal(fs.existsSync(path.dirname(copy)), false);
  assert.ok(children.every(child => child.killed));
});

test('parallel extractions have separate jars so yt-dlp cannot overwrite another request', async t => {
  const cookieFile = fixture(t), copies = [], children = [];
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
    spawn: (_bin, args) => {
      copies.push(args[args.indexOf('--cookies') + 1]);
      const child = childProcess(); children.push(child); return child;
    } });
  const pending = [source.resolve('First'), source.resolve('Second')];
  assert.notEqual(copies[0], copies[1]);
  for (const child of children) { child.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Song' })); child.emit('close', 0); }
  await Promise.all(pending);
  assert.ok(copies.every(copy => !fs.existsSync(path.dirname(copy))));
});

test('missing, malformed, oversized, and unrelated-only cookie files fail safely before spawning', async t => {
  for (const file of [path.join(os.tmpdir(), 'pim-missing-cookie-test'),
    fixture(t, 'SECRET bad cookie format'), fixture(t, contents + 'x'.repeat(1024 * 1024)),
    fixture(t, '# Netscape HTTP Cookie File\n.unrelated.example\tTRUE\t/\tTRUE\t0\tSID\tSECRET\n')]) {
    let spawned = false;
    const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile: file,
      spawn: () => { spawned = true; return childProcess(); } });
    await assert.rejects(source.resolve('Song'), error => {
      assert.equal(error.code, 'YOUTUBE_COOKIES_INVALID');
      assert.equal(error.message, 'YOUTUBE_COOKIES_INVALID');
      assert.doesNotMatch(JSON.stringify(error), /SECRET|pim-missing|bad cookie/);
      return true;
    });
    assert.equal(spawned, false);
  }
});

test('a synchronous spawn failure removes the prepared cookie jar', async t => {
  const cookieFile = fixture(t);
  let copy;
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
    spawn: (_bin, args) => { copy = args[args.indexOf('--cookies') + 1]; throw new Error('spawn failed'); } });
  await assert.rejects(source.resolve('Song'), { code: 'EXTRACTOR_FAILED' });
  assert.equal(fs.existsSync(path.dirname(copy)), false);
});

test('a decoder spawn failure kills the extractor and deletes its cookie copy', async t => {
  const cookieFile = fixture(t);
  let copy, extractor;
  const source = createYouTubeSource({ ytDlpPath: '/yt-dlp', ffmpegPath: '/ffmpeg', cookieFile,
    spawn: (bin, args) => {
      if (bin === '/ffmpeg') throw new Error('decoder spawn failed');
      copy = args[args.indexOf('--cookies') + 1]; extractor = childProcess(); return extractor;
    } });
  await assert.rejects(source.open({ url: 'https://youtu.be/abcdefghijk' }), { code: 'EXTRACTOR_FAILED' });
  assert.equal(extractor.killed, true);
  assert.equal(fs.existsSync(path.dirname(copy)), false);
});
