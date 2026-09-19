const NO_EVIDENCE = 'ไม่พบข้อความที่เกี่ยวข้องและตรวจสอบได้ในข้อมูลที่ค้นครั้งนี้ ลองระบุชื่อคน ห้อง เซิร์ฟเวอร์ หรือคำสำคัญเพิ่มครับ';
const FAILURE = 'ระบบค้นหาหรือตอบคำถามขัดข้องชั่วคราว ลองใหม่อีกครั้งครับ';

function splitMessage(text, max = 1900) {
  const chunks = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function createAssistant({ store, source, model, qaChannelId, status, logger = console, authorizeOutput = async () => {} }) {
  const histories = new Map();
  const queues = new Map();
  const counts = new Map();
  let pending = 0;
  let stopped = false;

  function coverage() {
    const s = status();
    return `ดัชนี: ${s.messages} ข้อความ · ประวัติครบ ${s.complete}/${s.channels} ห้องที่เริ่มเก็บแล้ว`
      + (s.running ? ' · กำลังซิงก์' : '')
      + (s.errors ? ` · พบปัญหา ${s.errors} จุดในการซิงก์ล่าสุด` : '')
      + '\nผลค้นอาจไม่ครอบคลุมทุกข้อความ โดยเฉพาะช่วงเก็บประวัติครั้งแรก';
  }
  async function send(message, text) {
    for (const content of splitMessage(text)) {
      await authorizeOutput();
      await message.channel.send({ content, allowedMentions: { parse: [], repliedUser: false }, flags: 4 });
    }
  }
  function label(text) { return String(text).replace(/[\[\]()<>`*_~\r\n]/g, ' ').slice(0, 100); }

  async function answer(message, key) {
    const question = message.content.trim();
    if (question === '!status') return send(message, coverage());
    if (question === '!forget') {
      histories.delete(key);
      return send(message, 'ล้างบริบทคำถามของคุณแล้วครับ');
    }
    if (question.length > 4000) return send(message, 'ช่วยย่อคำถามให้ไม่เกิน 4,000 ตัวอักษรครับ');
    await message.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => { void message.channel.sendTyping().catch(() => {}); }, 8000);
    typing.unref?.();
    try {
      const history = histories.get(key) ?? [];
      let planned = [];
      try { planned = await model.plan({ question, history }); } catch { /* Literal search remains useful. */ }
      const queries = [question, ...planned.filter(q => typeof q === 'string').slice(0, 3)];
      const verified = new Map();
      const attempted = new Set();
      let failures = 0;
      for (let batch = 0; batch < 3; batch++) {
        const candidates = store.search(queries, 90).filter(item => !attempted.has(item.id)).slice(0, 30);
        if (!candidates.length) break;
        for (const candidate of candidates) {
          attempted.add(candidate.id);
          try {
            const current = await source.refresh(candidate);
            if (!current) store.deleteMessage(candidate.id);
            else { store.upsert(current); verified.set(current.id, current); }
          } catch { failures++; }
        }
        if (store.search(queries, 90).filter(item => verified.has(item.id)).length >= 6) break;
      }
      // Re-rank after live refresh: an edited message may no longer match.
      const sources = store.search(queries, 90).filter(item => verified.has(item.id)).slice(0, 6)
        .map(item => verified.get(item.id));
      if (!sources.length) {
        await send(message, `${failures ? 'ตรวจสอบข้อความต้นทางกับ Discord ไม่สำเร็จ จึงยังสรุปไม่ได้ครับ' : NO_EVIDENCE}\n\n${coverage()}`);
        return;
      }
      const result = await model.answer({ question, history, sources });
      if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 10000
        || !Array.isArray(result.sourceIds)) throw new Error('Invalid model response');
      const ids = [...new Set(result.sourceIds)];
      if (ids.some(id => !Number.isInteger(id) || id < 1 || id > sources.length)) throw new Error('Invalid source ID');
      const references = [...result.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
      if (references.some(id => !ids.includes(id)) || ids.some(id => !references.includes(id))
        || /\]\s*[(\[:]|[a-z][a-z0-9+.-]*:\/\/|(?:https?|mailto|discord):|www\.|discord(?:app)?\.com\//i.test(result.answer)) {
        throw new Error('Invalid citation');
      }
      if (!ids.length) { await send(message, `${NO_EVIDENCE}\n\n${coverage()}`); return; }
      const links = ids.map(id => {
        const item = sources[id - 1];
        const date = new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
        return `[${id}] ${label(item.guildName)} / #${label(item.channelName)} · ${label(item.authorName)} · ${date} (ไทย)\n`
          + `https://discord.com/channels/${item.guildId}/${item.channelId}/${item.id}`;
      });
      await send(message, `${result.answer}\n\nแหล่งข้อมูล\n${links.join('\n')}\n\n${coverage()}`);
      // Previous answers never become evidence for subsequent questions.
      histories.delete(key);
      histories.set(key, [...history, question].slice(-6));
      if (histories.size > 100) histories.delete(histories.keys().next().value);
    } catch (error) {
      logger.warn(`Answer failed; code=${error.code ?? error.name ?? 'unknown'}`);
      await send(message, FAILURE);
    } finally { clearInterval(typing); }
  }

  return {
    async handle(message) {
      if (stopped || !message.guildId || message.channelId !== qaChannelId || message.author?.bot
        || !message.content?.trim()) return;
      const key = `${message.channelId}:${message.author.id}`;
      if (pending >= 6 || (counts.get(key) ?? 0) >= 2) {
        await send(message, 'มีคำถามกำลังประมวลผลอยู่ รอสักครู่แล้วลองใหม่ครับ');
        return;
      }
      pending++;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const previous = queues.get(key) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => answer(message, key));
      queues.set(key, current);
      try { await current; } finally {
        pending--;
        const left = counts.get(key) - 1;
        if (left) counts.set(key, left); else counts.delete(key);
        if (queues.get(key) === current) queues.delete(key);
      }
    },
    async stop() { stopped = true; await Promise.allSettled([...queues.values()]); },
  };
}

module.exports = { createAssistant };
