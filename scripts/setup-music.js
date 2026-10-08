const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const VERSION = '2026.08.19';
function selectAsset(platform, arch) {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'yt-dlp_macos';
  if (platform === 'linux' && arch === 'x64') return 'yt-dlp_linux';
  if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (platform === 'win32' && arch === 'x64') return 'yt-dlp.exe';
  throw new Error('Unsupported music platform; set PIM_YTDLP_PATH to a host-installed yt-dlp');
}
function checksumFor(text, asset) {
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(\S+)$/i);
    if (match?.[2] === asset) return match[1].toLowerCase();
  }
  throw new Error('Official yt-dlp checksum not found');
}
async function install() {
  if (process.env.PIM_MUSIC_ENABLED?.trim().toLowerCase() === 'false' || process.env.PIM_YTDLP_PATH?.trim()) {
    console.log('Pim music: executable setup skipped by configuration.');
    return;
  }
  const asset = selectAsset(process.platform, process.arch);
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/`;
  const headers = { 'User-Agent': 'Pim-music-installer' };
  async function download(name) {
    const response = await fetch(base + name, { headers, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
    return response;
  }
  const expected = checksumFor(await (await download('SHA2-256SUMS')).text(), asset);
  const directory = path.join(__dirname, '../.tools');
  const destination = path.join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  try {
    if (hash(await fs.readFile(destination)) === expected) {
      await fs.chmod(destination, 0o755);
      console.log(`Pim music: yt-dlp ${VERSION} already verified.`);
      return;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bytes = Buffer.from(await (await download(asset)).arrayBuffer());
  if (hash(bytes) !== expected) throw new Error('yt-dlp checksum verification failed');
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o755 });
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
  console.log(`Pim music: installed verified yt-dlp ${VERSION}.`);
}

if (require.main === module) {
  install().catch(error => {
    console.error(`Pim music setup failed: ${error.code ?? error.message}.`);
    process.exitCode = 1;
  });
}
module.exports = { selectAsset, checksumFor, install };
