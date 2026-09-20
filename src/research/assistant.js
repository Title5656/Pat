const { parseCommand } = require('./commands');

const NO_EVIDENCE = 'ไม่พบข้อความที่เกี่ยวข้องและตรวจสอบได้ในข้อมูลที่ค้นครั้งนี้ ลองระบุชื่อคน ห้อง เซิร์ฟเวอร์ หรือคำสำคัญเพิ่มครับ';
const FAILURE = 'ระบบค้นหาหรือตอบคำถามขัดข้องชั่วคราว ลองใหม่อีกครั้งครับ';
const READ_ONLY = 'Pat ในห้องนี้ทำได้เฉพาะอ่านและค้นข้อมูลเท่านั้น จึงไม่สามารถลบ แก้ไข หรือเปลี่ยนแปลงข้อมูลในเซิร์ฟเวอร์ได้ครับ';
const PAGE_SIZE = 50;

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

function normalized(text) {
  return String(text).normalize('NFKC').toLocaleLowerCase('th').replace(/\s+/g, ' ').trim();
}

function exactMatches(items, name, field = 'name') {
  if (!name) return [];
  return items.filter(item => normalized(item[field]) === normalized(name));
}

function createAssistant({ store, source, model, qaChannelId, status, logger = console, authorizeOutput = async () => {} }) {
  const histories = new Map();
  const sessions = new Map();
  const generations = new Map();
  const queues = new Map();
  const counts = new Map();
  const activeTokens = new Map();
  const abandonedOperations = new Set();
  let pending = 0;
  let stopped = false;

  function waitFor(value, token, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let operationSettled = false;
      let abandoned = false;
      const operation = Promise.resolve(value);
      const markAbandoned = () => {
        if (operationSettled || abandoned) return;
        abandoned = true;
        abandonedOperations.add(operation);
      };
      const finish = (callback, result, abandon = false) => {
        if (settled) return;
        settled = true;
        if (abandon) markAbandoned();
        clearTimeout(timeout);
        token?.cancellers.delete(cancel);
        callback(result);
      };
      const cancel = () => finish(reject, Object.assign(new Error('Command reset'), { code: 'RESET' }), true);
      const timeout = setTimeout(() => {
        token?.controller.abort();
        finish(reject, Object.assign(new Error('Operation timed out'), { code: 'TIMEOUT' }), true);
      }, timeoutMs);
      timeout.unref?.();
      if (token?.cancelled) { cancel(); return; }
      token?.cancellers.add(cancel);
      operation.then(result => {
        operationSettled = true;
        abandonedOperations.delete(operation);
        finish(resolve, result);
      }, error => {
        operationSettled = true;
        abandonedOperations.delete(operation);
        finish(reject, error);
      });
    });
  }

  function releaseToken(token) {
    if (token.released) return;
    token.released = true;
    pending--;
    const left = (counts.get(token.operationKey) ?? 1) - 1;
    if (left) counts.set(token.operationKey, left); else counts.delete(token.operationKey);
    const tokens = activeTokens.get(token.key);
    tokens?.delete(token);
    if (!tokens?.size) activeTokens.delete(token.key);
  }

  function cancelToken(token) {
    if (token.cancelled) return;
    token.cancelled = true;
    token.controller.abort();
    for (const timer of token.timers) clearInterval(timer);
    token.timers.clear();
    for (const cancel of [...token.cancellers]) cancel();
    releaseToken(token);
  }

  function coverage() {
    const s = status();
    return `ดัชนี: ${s.messages} ข้อความ · ประวัติครบ ${s.complete}/${s.channels} ห้องที่เริ่มเก็บแล้ว`
      + (s.running ? ' · กำลังซิงก์' : '')
      + (s.errors ? ` · พบปัญหา ${s.errors} จุดในการซิงก์ล่าสุด` : '')
      + '\nผลค้นอาจไม่ครอบคลุมทุกข้อความ โดยเฉพาะช่วงเก็บประวัติครั้งแรก';
  }
  async function send(message, text, guard = () => true, token) {
    for (const content of splitMessage(text)) {
      if (!guard()) return;
      await waitFor(authorizeOutput(), token, 15000);
      if (!guard()) return;
      await waitFor(message.channel.send({ content, allowedMentions: { parse: [], repliedUser: false }, flags: 4 }), token, 15000);
    }
  }
  function label(text) { return String(text).replace(/[\[\]()<>`*_~\r\n]/g, ' ').slice(0, 100); }
  function alive(key, generation, token) {
    return !stopped && !token?.cancelled && (generations.get(key) ?? 0) === generation;
  }

  function guildOptions(guilds) {
    if (!guilds.length) return 'ไม่พบเซิร์ฟเวอร์ที่ Pat เชื่อมต่ออยู่ครับ';
    return `รายชื่อเซิร์ฟเวอร์ที่ Pat เชื่อมต่ออยู่\n${guilds.map((guild, index) => `${index + 1}. ${label(guild.name)}`).join('\n')}`;
  }

  async function chooseGuild(command, session, token) {
    const guilds = await waitFor(source.listGuilds({ signal: token.controller.signal }), token);
    if (command.relativeServer && session?.guildId) {
      const guild = guilds.find(item => item.id === session.guildId);
      if (guild) return { guild, guilds };
    }
    if (command.serverName) {
      const matches = exactMatches(guilds, command.serverName);
      if (matches.length === 1) return { guild: matches[0], guilds };
      if (matches.length > 1) return { error: guildOptions(matches), guilds };
      return { error: `ไม่พบเซิร์ฟเวอร์ ${label(command.serverName)} ในรายการที่ Pat เชื่อมต่ออยู่ครับ\n${guildOptions(guilds)}`, guilds };
    }
    if (guilds.length === 1) return { guild: guilds[0], guilds };
    return { error: guildOptions(guilds), guilds };
  }

  async function listChannels(message, command, key, generation, token) {
    const session = sessions.get(key);
    const choice = await chooseGuild(command, session, token);
    if (!alive(key, generation, token)) return;
    if (!choice.guild) return send(message, choice.error, () => alive(key, generation, token), token);
    const channels = await waitFor(source.listChannels(choice.guild.id, { signal: token.controller.signal }), token);
    if (!alive(key, generation, token)) return;
    sessions.set(key, { ...session, guildId: choice.guild.id, guildName: choice.guild.name });
    const body = channels.length
      ? channels.map((channel, index) => `${index + 1}. #${label(channel.name)}`).join('\n')
      : 'ไม่พบห้องข้อความที่ Pat มีสิทธิ์อ่าน';
    await send(message, `ห้องข้อความในเซิร์ฟเวอร์ ${label(choice.guild.name)}\n${body}`,
      () => alive(key, generation, token), token);
  }

  async function chooseChannel(command, session, token) {
    const guilds = await waitFor(source.listGuilds({ signal: token.controller.signal }), token);
    if (command.relativeChannel && session?.channelId) return { channel: session };

    let scopedGuilds = guilds;
    if (command.serverName) {
      scopedGuilds = exactMatches(guilds, command.serverName);
      if (!scopedGuilds.length) {
        return { error: `ไม่พบเซิร์ฟเวอร์ ${label(command.serverName)} ในรายการที่ Pat เชื่อมต่ออยู่ครับ` };
      }
      if (scopedGuilds.length > 1) return { error: guildOptions(scopedGuilds) };
    } else if (command.relativeServer && session?.guildId) {
      const current = guilds.find(guild => guild.id === session.guildId);
      if (current) scopedGuilds = [current];
    }
    const channels = (await waitFor(Promise.all(scopedGuilds
      .map(guild => source.listChannels(guild.id, { signal: token.controller.signal }))), token)).flat();
    const channelId = command.channelName?.match(/^<#(\d{17,20})>$/)?.[1];
    const matches = channelId ? channels.filter(channel => channel.id === channelId)
      : exactMatches(channels, command.channelName);
    if (matches.length === 1) return { channel: matches[0] };
    if (matches.length > 1) {
      return { error: `พบชื่อห้องซ้ำ กรุณาระบุเซิร์ฟเวอร์ด้วย\n${matches.map((channel, index) => `${index + 1}. ${label(channel.guildName)} / #${label(channel.name)}`).join('\n')}` };
    }
    const choices = channels.slice(0, 30).map((channel, index) => `${index + 1}. ${label(channel.guildName)} / #${label(channel.name)}`).join('\n');
    return { error: `ยังระบุห้องที่จะอ่านไม่ได้ กรุณาพิมพ์ชื่อห้อง${choices ? ` เช่นรายการต่อไปนี้\n${choices}` : 'อีกครั้งครับ'}` };
  }

  function messageTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-GB', {
      timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  async function sendMessagePage(message, key, generation, state, token) {
    if (state.exhausted) {
      await send(message, 'ถึงข้อความแรกที่ Pat อ่านได้ในห้องนี้แล้วครับ',
        () => alive(key, generation, token), token);
      return;
    }
    const next = { ...state };
    if (next.remaining <= 0) {
      next.remaining = PAGE_SIZE;
      next.total += PAGE_SIZE;
    }
    const limit = Number.isFinite(next.remaining) ? Math.min(PAGE_SIZE, next.remaining) : PAGE_SIZE;
    const page = await waitFor(source.readMessages(next.channelId, {
      before: next.before, limit, signal: token.controller.signal,
    }), token);
    if (!alive(key, generation, token)) return;
    if (!page.length) {
      next.exhausted = true;
      await send(message, next.delivered
        ? 'ถึงข้อความแรกที่ Pat อ่านได้ในห้องนี้แล้วครับ'
        : 'ไม่พบข้อความตัวอักษรในห้องนี้ครับ', () => alive(key, generation, token), token);
      if (alive(key, generation, token)) sessions.set(key, next);
      return;
    }

    next.before = page.at(-1).id;
    next.page++;
    next.delivered += page.length;
    if (Number.isFinite(next.remaining)) next.remaining -= page.length;
    if (page.length < limit) next.exhausted = true;

    const chronological = [...page].sort((a, b) => a.createdAt - b.createdAt);
    const lines = chronological.map(item => `[${messageTime(item.createdAt)}] ${label(item.authorName)}: ${String(item.content).replace(/[\r\n]+/g, ' ↩ ')}`);
    const first = chronological[0];
    const last = chronological.at(-1);
    let footer;
    if (Number.isFinite(next.remaining) && next.remaining > 0) {
      footer = `เหลืออีก ${next.remaining} ข้อความตามที่ขอ · พิมพ์ \`ต่อ\` เพื่อดูชุดก่อนหน้า`;
    } else if (Number.isFinite(next.total)) {
      footer = `แสดงครบ ${next.total} ข้อความตามที่ขอแล้ว · พิมพ์ \`ต่อ\` หากต้องการย้อนหลังอีก ${PAGE_SIZE} ข้อความ`;
    } else {
      footer = next.exhausted ? 'ถึงข้อความแรกที่ Pat อ่านได้แล้ว' : 'พิมพ์ `ต่อ` เพื่อดูชุดก่อนหน้า';
    }
    const header = `${label(next.guildName)} / #${label(next.channelName)} · ชุดที่ ${next.page} · ${page.length} ข้อความ\n`
      + `ช่วง ${messageTime(first.createdAt)} – ${messageTime(last.createdAt)}`;
    await send(message, `${header}\n\n${lines.join('\n')}\n\n${footer}`,
      () => alive(key, generation, token), token);
    if (alive(key, generation, token)) sessions.set(key, next);
  }

  async function beginMessageRead(message, key, generation, command, token) {
    const selected = await chooseChannel(command, sessions.get(key), token);
    if (!alive(key, generation, token)) return;
    if (!selected.channel) return send(message, selected.error, () => alive(key, generation, token), token);
    const channel = selected.channel;
    const state = {
      guildId: channel.guildId, guildName: channel.guildName, channelId: channel.id, channelName: channel.name,
      before: undefined, page: 0, delivered: 0, total: command.requested,
      remaining: command.requested, exhausted: false,
    };
    sessions.set(key, state);
    await sendMessagePage(message, key, generation, state, token);
  }

  async function continueMessageRead(message, key, generation, command, token) {
    const state = sessions.get(key);
    if (!state?.channelId || state.page === undefined) {
      await send(message, 'ยังไม่มีรายการข้อความให้ดูต่อ กรุณาระบุเซิร์ฟเวอร์และชื่อห้องก่อนครับ',
        () => alive(key, generation, token), token);
      return;
    }
    let next = state;
    if (command.additional && Number.isFinite(state.remaining)) {
      next = { ...state, remaining: state.remaining + command.additional,
        total: state.total + command.additional, exhausted: false };
    }
    await sendMessagePage(message, key, generation, next, token);
  }

  async function answer(message, key, generation, token) {
    if (!alive(key, generation, token)) return;
    const question = message.content.trim();
    if (question === '!status') return send(message, coverage(), () => alive(key, generation, token), token);
    if (question === '!forget') {
      histories.delete(key);
      return send(message, 'ล้างบริบทคำถามของคุณแล้วครับ', () => alive(key, generation, token), token);
    }
    if (question.length > 4000) return send(message, 'ช่วยย่อคำถามให้ไม่เกิน 4,000 ตัวอักษรครับ',
      () => alive(key, generation, token), token);
    const command = parseCommand(question);
    if (command.type === 'forbidden-mutation') return send(message, READ_ONLY, () => alive(key, generation, token), token);
    void message.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => { void message.channel.sendTyping().catch(() => {}); }, 8000);
    typing.unref?.();
    token.timers.add(typing);
    try {
      if (command.type === 'list-channels') return await listChannels(message, command, key, generation, token);
      if (command.type === 'read-messages') return await beginMessageRead(message, key, generation, command, token);
      if (command.type === 'continue') return await continueMessageRead(message, key, generation, command, token);

      const history = histories.get(key) ?? [];
      let planned = [];
      try { planned = await waitFor(model.plan({ question, history, signal: token.controller.signal }), token); } catch (error) {
        if (error.code === 'RESET') return;
        /* Literal search remains useful. */
      }
      if (!alive(key, generation, token)) return;
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
            const current = await waitFor(source.refresh(candidate, { signal: token.controller.signal }), token);
            if (!current) store.deleteMessage(candidate.id);
            else { store.upsert(current); verified.set(current.id, current); }
          } catch { failures++; }
          if (!alive(key, generation, token)) return;
        }
        if (store.search(queries, 90).filter(item => verified.has(item.id)).length >= 6) break;
      }
      const sources = store.search(queries, 90).filter(item => verified.has(item.id)).slice(0, 6)
        .map(item => verified.get(item.id));
      if (!sources.length) {
        await send(message, `${failures ? 'ตรวจสอบข้อความต้นทางกับ Discord ไม่สำเร็จ จึงยังสรุปไม่ได้ครับ' : NO_EVIDENCE}\n\n${coverage()}`,
          () => alive(key, generation, token), token);
        return;
      }
      const result = await waitFor(model.answer({ question, history, sources, signal: token.controller.signal }), token);
      if (!alive(key, generation, token)) return;
      if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 10000
        || !Array.isArray(result.sourceIds)) throw new Error('Invalid model response');
      const ids = [...new Set(result.sourceIds)];
      if (ids.some(id => !Number.isInteger(id) || id < 1 || id > sources.length)) throw new Error('Invalid source ID');
      const references = [...result.answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
      if (references.some(id => !ids.includes(id)) || ids.some(id => !references.includes(id))
        || /\]\s*[(\[:]|[a-z][a-z0-9+.-]*:\/\/|(?:https?|mailto|discord):|www\.|discord(?:app)?\.com\//i.test(result.answer)) {
        throw new Error('Invalid citation');
      }
      if (!ids.length) {
        await send(message, `${NO_EVIDENCE}\n\n${coverage()}`, () => alive(key, generation, token), token);
        return;
      }
      const links = ids.map(id => {
        const item = sources[id - 1];
        const date = new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
        return `[${id}] ${label(item.guildName)} / #${label(item.channelName)} · ${label(item.authorName)} · ${date} (ไทย)\n`
          + `https://discord.com/channels/${item.guildId}/${item.channelId}/${item.id}`;
      });
      await send(message, `${result.answer}\n\nแหล่งข้อมูล\n${links.join('\n')}\n\n${coverage()}`,
        () => alive(key, generation, token), token);
      if (!alive(key, generation, token)) return;
      histories.delete(key);
      histories.set(key, [...history, question].slice(-6));
      if (histories.size > 100) histories.delete(histories.keys().next().value);
    } catch (error) {
      if (!alive(key, generation, token)) return;
      logger.warn(`Answer failed; code=${error.code ?? error.name ?? 'unknown'}`);
      await send(message, FAILURE, () => alive(key, generation, token), token);
    } finally {
      clearInterval(typing);
      token.timers.delete(typing);
    }
  }

  return {
    async handle(message) {
      if (stopped || !message.guildId || message.channelId !== qaChannelId || message.author?.bot
        || !message.content?.trim()) return;
      const key = `${message.channelId}:${message.author.id}`;
      if (message.content.trim().toLowerCase() === '!reset') {
        generations.set(key, (generations.get(key) ?? 0) + 1);
        for (const token of [...(activeTokens.get(key) ?? [])]) cancelToken(token);
        histories.delete(key);
        sessions.delete(key);
        await send(message, 'รีเซ็ตคำสั่งและบริบทของคุณแล้วครับ พร้อมเริ่มใหม่');
        return;
      }
      const generation = generations.get(key) ?? 0;
      const operationKey = `${key}:${generation}`;
      if (pending >= 6 || abandonedOperations.size >= 6 || (counts.get(operationKey) ?? 0) >= 2) {
        await send(message, 'มีคำถามกำลังประมวลผลอยู่ รอสักครู่แล้วลองใหม่ครับ');
        return;
      }
      pending++;
      counts.set(operationKey, (counts.get(operationKey) ?? 0) + 1);
      const token = { key, operationKey, cancelled: false, released: false, controller: new AbortController(),
        cancellers: new Set(), timers: new Set() };
      if (!activeTokens.has(key)) activeTokens.set(key, new Set());
      activeTokens.get(key).add(token);
      const previous = queues.get(operationKey) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => answer(message, key, generation, token));
      queues.set(operationKey, current);
      try { await current; } finally {
        releaseToken(token);
        if (queues.get(operationKey) === current) queues.delete(operationKey);
      }
    },
    async stop() {
      stopped = true;
      for (const tokens of activeTokens.values()) for (const token of [...tokens]) cancelToken(token);
      await Promise.allSettled([...queues.values()]);
    },
  };
}

module.exports = { createAssistant };
