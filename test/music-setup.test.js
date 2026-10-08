const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectAsset, checksumFor } = require('../scripts/setup-music');

test('selects an official standalone binary for supported hosts', () => {
  assert.equal(selectAsset('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(selectAsset('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(selectAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');
  assert.equal(selectAsset('win32', 'x64'), 'yt-dlp.exe');
  assert.throws(() => selectAsset('linux', 'unknown'));
});

test('matches a complete checksum filename rather than a prefix', () => {
  const hash = 'a'.repeat(64);
  assert.equal(checksumFor(`${'b'.repeat(64)}  yt-dlp_linux.zip\n${hash}  yt-dlp_linux\n`, 'yt-dlp_linux'), hash);
  assert.throws(() => checksumFor(`${hash} yt-dlp_linux.zip`, 'yt-dlp_linux'));
});
