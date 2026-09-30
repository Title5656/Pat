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
    return null;
  }

  return { tryHandle };
}

module.exports = { createStopwatch };
