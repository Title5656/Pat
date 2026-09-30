function displayNameOf(message) {
  return message.member?.displayName
    ?? message.author?.globalName
    ?? message.author?.username
    ?? 'ใครบางคน';
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} ชั่วโมง`);
  if (minutes > 0) parts.push(`${minutes} นาที`);
  if (seconds > 0) parts.push(`${seconds} วินาที`);
  return parts.length ? parts.join(' ') : 'ไม่ถึง 1 วินาที';
}

function createStopwatch({ now = Date.now } = {}) {
  const timers = new Map();
  let runCounter = 0;

  const START_PATTERN = /เริ่ม\s*จับเวลา/;
  const STOP_PATTERN = /หยุด\s*จับเวลา/;
  const LIST_PATTERN = /ดู\s*จับเวลา/;

  // Fuzzy layer: exact regexes above stay the source of truth; these catch
  // typos only. Thai strips upper vowels/tone marks (keeps ุ ู so short
  // keywords stay distinctive); English allows one edit per word.
  const THAI_COMMANDS = [
    { cmd: 'start', keyword: 'เรมจบเวลา' },
    { cmd: 'stop', keyword: 'หยุดจบเวลา' },
    { cmd: 'list', keyword: 'ดูจบเวลา' },
  ];

  function isThaiStrippable(code) {
    return code === 0x0E31 || (code >= 0x0E34 && code <= 0x0E37)
      || (code >= 0x0E47 && code <= 0x0E4E);
  }

  function normalizeThai(text) {
    const lower = text.toLowerCase();
    let norm = '';
    const map = [];
    for (let i = 0; i < lower.length; i++) {
      const code = lower.charCodeAt(i);
      if (lower[i] === ' ' || isThaiStrippable(code)) continue;
      norm += lower[i];
      map.push(i);
    }
    return { norm, map };
  }

  function withinOneEdit(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; continue; }
      if (a[i + 1] === b[j + 1]) { i++; j++; continue; }
      if (a[i + 1] === b[j]) { i++; continue; }
      if (a[i] === b[j + 1]) { j++; continue; }
      return false;
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  function fuzzyThai(content) {
    const { norm, map } = normalizeThai(content);
    if (!norm) return null;
    for (const { cmd, keyword } of THAI_COMMANDS) {
      const found = norm.indexOf(keyword);
      if (found >= 0) {
        const end = map[found + keyword.length - 1] + 1;
        return { cmd, name: content.slice(end).trim() };
      }
      for (const len of [keyword.length - 1, keyword.length + 1]) {
        if (len <= 0) continue;
        for (let s = 0; s + len <= norm.length; s++) {
          if (withinOneEdit(norm.slice(s, s + len), keyword)) {
            const end = map[s + len - 1] + 1;
            return { cmd, name: content.slice(end).trim() };
          }
        }
      }
    }
    return null;
  }

  function fuzzyEnglish(content) {
    const tokens = content.toLowerCase().replace(/^pim\s+/, '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const name = (from) => tokens.slice(from).join(' ');
    if (withinOneEdit(tokens[0], 'start')
      && (withinOneEdit(tokens[1] ?? '', 'timer') || withinOneEdit(tokens[1] ?? '', 'stopwatch'))) {
      return { cmd: 'start', name: name(2) };
    }
    if (withinOneEdit(tokens[0], 'stop')
      && (withinOneEdit(tokens[1] ?? '', 'timer') || withinOneEdit(tokens[1] ?? '', 'stopwatch'))) {
      return { cmd: 'stop', name: name(2) };
    }
    if (withinOneEdit(tokens[0], 'timers')
      || (withinOneEdit(tokens[0], 'list') && withinOneEdit(tokens[1] ?? '', 'timers'))) {
      return { cmd: 'list', name: '' };
    }
    return null;
  }

  const commandWords = {
    start: (name, starter) => start(name, starter),
    stop: (name, stopper) => stop(name, stopper),
    list: () => list(),
  };

  function nextRunName() {
    let name;
    do {
      name = `run ${++runCounter}`;
    } while (timers.has(name.toLowerCase()));
    return name;
  }

  function start(rawName, starter) {
    const name = rawName || nextRunName();
    const key = name.toLowerCase();
    if (timers.has(key)) {
      return `มีนาฬิกา "${name}" กำลังนับอยู่แล้วนะ จะเริ่มใหม่ก็หยุดอันเดิมก่อนนะ`;
    }
    timers.set(key, { name, startedAt: now(), startedBy: starter });
    return `เริ่มจับ "${name}" ให้แล้วนะ (เริ่มโดย ${starter}) ⏱️`;
  }

  function stop(rawName, stopper) {
    if (!rawName) {
      if (timers.size === 0) {
        return 'ยังไม่มีนาฬิกาที่กำลังนับอยู่เลยนะ';
      }
      if (timers.size > 1) {
        const names = [...timers.values()].map((timer) => timer.name).join(', ');
        return `กำลังนับอยู่หลายอันเลยนะ: ${names} — จะหยุดอันไหน พิมพ์ "พิม หยุดจับเวลา <ชื่อ>" มาได้เลยนะ`;
      }
      rawName = [...timers.values()][0].name;
    }
    const key = rawName.toLowerCase();
    const timer = timers.get(key);
    if (!timer) {
      return `ไม่เห็นมีนาฬิกา "${rawName}" ที่กำลังนับอยู่นะ`;
    }
    timers.delete(key);
    return `หยุด "${timer.name}" แล้ว จับได้ ${formatDuration(now() - timer.startedAt)} (เริ่มโดย ${timer.startedBy})`;
  }

  function list() {
    if (timers.size === 0) {
      return 'ยังไม่มีนาฬิกาที่กำลังนับอยู่เลยนะ';
    }
    const lines = [...timers.values()].map((timer) =>
      `• ${timer.name} (เริ่มโดย ${timer.startedBy}) — ${formatDuration(now() - timer.startedAt)}`);
    return `นาฬิกาที่กำลังนับอยู่:\n${lines.join('\n')}`;
  }

  function tryHandle(message) {
    const content = (message.content ?? '').trim();
    let match = content.match(START_PATTERN);
    if (match) {
      return start(content.slice(match.index + match[0].length).trim(), displayNameOf(message));
    }
    match = content.match(STOP_PATTERN);
    if (match) {
      return stop(content.slice(match.index + match[0].length).trim(), displayNameOf(message));
    }
    if (LIST_PATTERN.test(content)) {
      return list();
    }
    if (content.replace(/^พิม\s+|^pim\s+/i, '') === 'จับเวลา') {
      return list();
    }
    const fuzzy = fuzzyEnglish(content) ?? fuzzyThai(content);
    if (fuzzy) {
      return commandWords[fuzzy.cmd](fuzzy.name, displayNameOf(message));
    }
    return null;
  }

  return { tryHandle };
}

module.exports = { createStopwatch };
