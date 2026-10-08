const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function invalidCookies() {
  return Object.assign(new Error('YOUTUBE_COOKIES_INVALID'), { code: 'YOUTUBE_COOKIES_INVALID' });
}

function configuredCookieFile() {
  const configured = process.env.PIM_YOUTUBE_COOKIES_FILE?.trim();
  if (configured) return configured;
  const secret = '/etc/secrets/youtube-cookies.txt';
  return fs.existsSync(secret) ? secret : undefined;
}

function prepareCookieJar(filename) {
  if (!filename) return { args: [], cleanup() {} };
  let directory;
  function cleanup() {
    if (!directory) return;
    try { fs.rmSync(directory, { recursive: true, force: true }); directory = undefined; }
    catch { console.warn('Pim music cookie cleanup failed; code=COOKIE_CLEANUP_FAILED'); }
  }
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw invalidCookies();
    const lines = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
    if (!/^# (?:Netscape )?HTTP Cookie File\s*$/.test(lines[0])) throw invalidCookies();
    const cookies = [];
    for (const line of lines.slice(1)) {
      if (!line.trim() || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
      const columns = line.replace(/^#HttpOnly_/, '').split('\t');
      if (columns.length !== 7 || !/^(?:TRUE|FALSE)$/.test(columns[1])
        || !columns[2].startsWith('/') || !/^(?:TRUE|FALSE)$/.test(columns[3])
        || !/^\d+$/.test(columns[4]) || !columns[5] || line.includes('\r')) throw invalidCookies();
      const domain = columns[0].replace(/^\./, '').toLowerCase();
      if (domain === 'youtube.com' || domain.endsWith('.youtube.com')) cookies.push(line);
    }
    if (!cookies.length) throw invalidCookies();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pim-youtube-cookies-'));
    const jar = path.join(directory, 'cookies.txt');
    fs.writeFileSync(jar, `# Netscape HTTP Cookie File\n${cookies.join('\n')}\n`, { mode: 0o600 });
    return { args: ['--cookies', jar], cleanup };
  } catch {
    cleanup();
    throw invalidCookies();
  }
}

module.exports = { configuredCookieFile, prepareCookieJar };
