const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../../src/research/store');
const { createAssistant } = require('../../src/research/assistant');

const evidence = { id: '100', guildId: '10', channelId: '20', guildName: 'Friends', channelName: 'food', authorName: 'Alice', authorId: '30', content: 'กินหมูกระทะวันศุกร์', createdAt: 1700000000000 };
function fixture(overrides = {}) {
  const sent = [];
  const store = createStore(':memory:');
  const message = { id: '200', guildId: '10', channelId: '99', author: { id: 'owner', bot: false }, content: 'หมูกระทะวันไหน', channel: { sendTyping: async () => {}, send: async payload => sent.push(payload) } };
  const assistant = createAssistant({ store, source: { refresh: async () => evidence },
    model: { plan: async () => ['หมูกระทะ'], answer: async () => ({ answer: 'วันศุกร์ครับ [1]', sourceIds: [1] }) },
    qaChannelId: '99', status: () => ({ messages: 1, channels: 1, complete: 1, errors: 0 }),
    logger: { warn() {} }, ...overrides,
  });
  return { assistant, store, message, sent };
}

test('answers contain verified citations with server, channel, date and exact message URL', async () => {
  const { assistant, store, message, sent } = fixture();
  try {
    store.upsert(evidence);
    await assistant.handle(message);
    const text = sent.map(p => p.content).join('\n');
    assert.match(text, /วันศุกร์/);
    assert.match(text, /Friends.*food/);
    assert.match(text, /2023/);
    assert.match(text, /https:\/\/discord.com\/channels\/10\/20\/100/);
    assert.ok(sent.every(p => p.allowedMentions.parse.length === 0));
  } finally { store.close(); }
});

test('bots, DMs and other channels never invoke retrieval or generation', async () => {
  const { assistant, store, message, sent } = fixture({ model: { plan: async () => { throw new Error('must not call'); } } });
  try {
    await assistant.handle({ ...message, author: { id: 'owner', bot: true } });
    await assistant.handle({ ...message, channelId: 'elsewhere' });
    await assistant.handle({ ...message, guildId: null });
    assert.equal(sent.length, 0);
  } finally { store.close(); }
});

test('missing evidence is reported without generating a fabricated answer', async () => {
  const { assistant, store, message, sent } = fixture({ model: { plan: async () => [], answer: async () => { throw new Error('must not call'); } } });
  try {
    await assistant.handle(message);
    assert.match(sent[0].content, /ไม่พบ/);
  } finally { store.close(); }
});

test('deleted and inaccessible search hits are removed before they reach the model', async () => {
  const { assistant, store, message, sent } = fixture({ source: { refresh: async () => null } });
  try {
    store.upsert(evidence);
    await assistant.handle(message);
    assert.match(sent[0].content, /ไม่พบ/);
    assert.equal(store.stats().messages, 0);
  } finally { store.close(); }
});

test('edited text is refreshed and becomes the only evidence passed to generation', async () => {
  const updated = { ...evidence, content: 'เปลี่ยนหมูกระทะเป็นวันเสาร์' };
  const { assistant, store, message, sent } = fixture({ source: { refresh: async () => updated }, model: {
    plan: async () => ['หมูกระทะ'], answer: async ({ sources }) => {
      assert.equal(sources[0].content, 'เปลี่ยนหมูกระทะเป็นวันเสาร์');
      return { answer: 'วันเสาร์ [1]', sourceIds: [1] };
    },
  } });
  try {
    store.upsert(evidence);
    await assistant.handle(message);
    assert.match(sent[0].content, /วันเสาร์/);
    assert.equal(store.search(['หมูกระทะ'])[0].content, updated.content);
  } finally { store.close(); }
});

test('invalid citations and model errors produce a generic failure without exposing raw errors', async () => {
  for (const answer of [async () => ({ answer: 'claim [99]', sourceIds: [99] }), async () => { throw new Error('SECRET_API_KEY'); }]) {
    const { assistant, store, message, sent } = fixture({ model: { plan: async () => ['หมูกระทะ'], answer } });
    try {
      store.upsert(evidence);
      await assistant.handle(message);
      assert.doesNotMatch(sent.map(p => p.content).join(''), /SECRET|claim|99/);
      assert.match(sent[0].content, /ขัดข้อง/);
    } finally { store.close(); }
  }
});

test('model-authored links and unused source IDs cannot masquerade as verified citations', async () => {
  for (const answer of ['Claim [1](https://discord.com/channels/999/999/999)', 'Claim [1]\n[1]: https://evil.example', 'Claim https://evil.example [1]', 'Claim with no citation']) {
    const { assistant, store, message, sent } = fixture({ model: {
      plan: async () => ['หมูกระทะ'], answer: async () => ({ answer, sourceIds: [1] }),
    } });
    try {
      store.upsert(evidence);
      await assistant.handle(message);
      assert.match(sent[0].content, /ขัดข้อง/);
      assert.doesNotMatch(sent[0].content, /Claim|evil|999/);
    } finally { store.close(); }
  }
});

test('stale top matches do not hide the next live matching message', async () => {
  const { assistant, store, message, sent } = fixture({ source: {
    refresh: async item => item.id === '130' ? item : null,
  } });
  try {
    for (let id = 100; id <= 130; id++) store.upsert({ ...evidence, id: String(id) });
    await assistant.handle(message);
    assert.match(sent.map(p => p.content).join('\n'), /\/10\/20\/130/);
    assert.equal(store.stats().messages, 1);
  } finally { store.close(); }
});

test('long answers are split without dropping source links and questions stay isolated by user', async () => {
  const histories = [];
  const { assistant, store, message, sent } = fixture({ model: {
    plan: async ({ history }) => { histories.push([...history]); return ['หมูกระทะ']; },
    answer: async () => ({ answer: 'ก'.repeat(3500) + ' [1]', sourceIds: [1] }),
  } });
  try {
    store.upsert(evidence);
    await assistant.handle(message);
    await assistant.handle({ ...message, content: 'แล้วกี่โมง' });
    await assistant.handle({ ...message, author: { id: 'other' } });
    assert.deepEqual(histories, [[], ['หมูกระทะวันไหน'], []]);
    assert.ok(sent.every(p => p.content.length <= 2000));
    assert.ok(sent.some(p => p.content.includes('/10/20/100')));
  } finally { store.close(); }
});

function browsingFixture({ guilds, channels, messages = [], model, sendPayload } = {}) {
  const sent = [];
  const store = createStore(':memory:');
  const source = {
    listGuilds: async () => guilds ?? [{ id: '10', name: 'Friends' }],
    listChannels: async guildId => (channels ?? [{ id: '20', guildId: '10', guildName: 'Friends', name: 'general', type: 0 }])
      .filter(channel => channel.guildId === guildId),
    readMessages: async (channelId, { before, limit }) => messages
      .filter(item => item.channelId === channelId && (!before || BigInt(item.id) < BigInt(before))).slice(0, limit),
    refresh: async () => null,
  };
  const assistant = createAssistant({ store, source,
    model: model ?? { plan: async () => { throw new Error('metadata reads must not invoke Gemini'); } },
    qaChannelId: '99', status: () => ({ messages: 0, channels: 0, complete: 0, errors: 0 }),
    logger: { warn() {} },
  });
  const deliver = content => assistant.handle({ guildId: '10', channelId: '99',
    author: { id: 'owner', bot: false }, content,
    channel: { sendTyping: async () => {}, send: async payload => {
      if (sendPayload) await sendPayload(payload, sent);
      else sent.push(payload);
    } } });
  return { assistant, store, source, sent, deliver };
}

test('a server room question returns a numbered live channel list without text search', async () => {
  const browsing = browsingFixture({ channels: [
    { id: '20', guildId: '10', guildName: 'Friends', name: 'general', type: 0 },
    { id: '21', guildId: '10', guildName: 'Friends', name: 'อาหาร', type: 0 },
  ] });
  try {
    await browsing.deliver('เซิร์ฟเวอร์ Friends มีห้องไหนบ้าง');
    const output = browsing.sent.map(item => item.content).join('\n');
    assert.match(output, /Friends/);
    assert.match(output, /1\. #general/);
    assert.match(output, /2\. #อาหาร/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('more than 50 requested messages are delivered as chronological read-only pages', async () => {
  const messages = Array.from({ length: 120 }, (_, index) => {
    const id = 120 - index;
    return { id: String(id), guildId: '10', channelId: '20', guildName: 'Friends', channelName: 'general',
      authorId: '30', authorName: id % 2 ? 'Alice' : 'Bob', content: `ข้อความ-${String(id).padStart(3, '0')}`,
      createdAt: 1700000000000 + id * 1000 };
  });
  const browsing = browsingFixture({ messages });
  try {
    await browsing.deliver('ขอดู 120 ข้อความล่าสุดในห้อง general server Friends');
    let output = browsing.sent.map(item => item.content).join('\n');
    assert.match(output, /ข้อความ-071/);
    assert.match(output, /ข้อความ-120/);
    assert.doesNotMatch(output, /ข้อความ-070/);
    assert.ok(output.indexOf('ข้อความ-071') < output.indexOf('ข้อความ-120'));
    assert.match(output, /เหลืออีก 70/);

    const firstPageSends = browsing.sent.length;
    await browsing.deliver('ต่อ');
    output = browsing.sent.slice(firstPageSends).map(item => item.content).join('\n');
    assert.match(output, /ข้อความ-021/);
    assert.match(output, /ข้อความ-070/);
    assert.doesNotMatch(output, /ข้อความ-020/);
    assert.match(output, /เหลืออีก 20/);

    const secondPageSends = browsing.sent.length;
    await browsing.deliver('ต่อ');
    output = browsing.sent.slice(secondPageSends).map(item => item.content).join('\n');
    assert.match(output, /ข้อความ-001/);
    assert.match(output, /ข้อความ-020/);
    assert.match(output, /ครบ 120 ข้อความตามที่ขอ/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('reset immediately invalidates a stuck answer and starts a fresh command session', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const browsing = browsingFixture({ model: { plan: async () => waiting } });
  try {
    const stale = browsing.deliver('หาเรื่องที่ไม่มีข้อมูล');
    await new Promise(resolve => setImmediate(resolve));
    await browsing.deliver('!reset');
    await browsing.deliver('server Friends มีห้องไหนบ้าง');
    release([]);
    await stale;
    const output = browsing.sent.map(item => item.content).join('\n');
    assert.match(output, /รีเซ็ตคำสั่งและบริบท/);
    assert.match(output, /1\. #general/);
    assert.doesNotMatch(output, /ไม่พบข้อความ/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('repeated resets release stuck command capacity and shutdown waits for no stale work', async () => {
  const releases = [];
  const staleHandles = [];
  let aborts = 0;
  const browsing = browsingFixture({ model: { plan: async ({ signal }) => new Promise((resolve, reject) => {
    releases.push(resolve);
    signal?.addEventListener('abort', () => {
      aborts++;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  }) } });
  try {
    for (let index = 0; index < 6; index++) {
      staleHandles.push(browsing.deliver(`คำถามค้าง ${index}`));
      await new Promise(resolve => setImmediate(resolve));
      await browsing.deliver('!reset');
    }
    const beforeFresh = browsing.sent.length;
    await browsing.deliver('server Friends มีห้องไหนบ้าง');
    const fresh = browsing.sent.slice(beforeFresh).map(item => item.content).join('\n');
    assert.match(fresh, /1\. #general/);
    assert.doesNotMatch(fresh, /กำลังประมวลผล/);
    assert.equal(aborts, 6);

    const stopped = await Promise.race([
      browsing.assistant.stop().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(stopped, true);
  } finally {
    releases.forEach(resolve => resolve([]));
    await Promise.allSettled(staleHandles);
    await browsing.assistant.stop();
    browsing.store.close();
  }
});

test('uncancellable reset work remains capped until its underlying operations settle', async () => {
  const releases = [];
  const staleHandles = [];
  const browsing = browsingFixture({ model: { plan: async () => new Promise(resolve => releases.push(resolve)) } });
  try {
    for (let index = 0; index < 6; index++) {
      staleHandles.push(browsing.deliver(`งานภายนอกค้าง ${index}`));
      await new Promise(resolve => setImmediate(resolve));
      await browsing.deliver('!reset');
    }
    const beforeBlocked = browsing.sent.length;
    await browsing.deliver('server Friends มีห้องไหนบ้าง');
    assert.match(browsing.sent.slice(beforeBlocked).map(item => item.content).join('\n'), /กำลังประมวลผล/);

    releases.forEach(resolve => resolve([]));
    await Promise.allSettled(staleHandles);
    await new Promise(resolve => setImmediate(resolve));
    const beforeRecovered = browsing.sent.length;
    await browsing.deliver('server Friends มีห้องไหนบ้าง');
    assert.match(browsing.sent.slice(beforeRecovered).map(item => item.content).join('\n'), /1\. #general/);
  } finally {
    releases.forEach(resolve => resolve([]));
    await Promise.allSettled(staleHandles);
    await browsing.assistant.stop();
    browsing.store.close();
  }
});

test('mutation requests are refused before any Discord or Gemini operation', async () => {
  const browsing = browsingFixture();
  try {
    await browsing.deliver('ช่วยลบห้อง general');
    assert.match(browsing.sent[0].content, /อ่านและค้นข้อมูลเท่านั้น/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('an explicitly named missing server never falls back to the only connected server', async () => {
  const browsing = browsingFixture();
  try {
    await browsing.deliver('เซิร์ฟเวอร์ Missing มีห้องไหนบ้าง');
    const output = browsing.sent.map(item => item.content).join('\n');
    assert.match(output, /ไม่พบเซิร์ฟเวอร์.*Missing/);
    assert.match(output, /รายชื่อเซิร์ฟเวอร์ที่ Pat เชื่อมต่ออยู่/);
    assert.match(output, /1\. Friends/);
    assert.doesNotMatch(output, /#general/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('server and room names are resolved exactly rather than as substrings', async () => {
  const browsing = browsingFixture({
    guilds: [{ id: '10', name: 'Art' }],
    channels: [{ id: '20', guildId: '10', guildName: 'Art', name: 'art', type: 0 }],
  });
  try {
    await browsing.deliver('server Party มีห้องไหนบ้าง');
    await browsing.deliver('ห้อง party มีข้อความอะไรบ้าง');
    const output = browsing.sent.map(item => item.content).join('\n');
    assert.match(output, /ไม่พบเซิร์ฟเวอร์ Party/);
    assert.match(output, /ยังระบุห้องที่จะอ่านไม่ได้/);
    assert.doesNotMatch(output, /ห้องข้อความในเซิร์ฟเวอร์ Art/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('duplicate room names require an explicit server even after a previous server selection', async () => {
  const browsing = browsingFixture({
    guilds: [{ id: '10', name: 'Friends' }, { id: '11', name: 'Work' }],
    channels: [
      { id: '20', guildId: '10', guildName: 'Friends', name: 'general', type: 0 },
      { id: '21', guildId: '11', guildName: 'Work', name: 'general', type: 0 },
    ],
  });
  try {
    await browsing.deliver('server Friends มีห้องไหนบ้าง');
    const sentBeforeRead = browsing.sent.length;
    await browsing.deliver('ห้อง general มีข้อความอะไรบ้าง');
    const output = browsing.sent.slice(sentBeforeRead).map(item => item.content).join('\n');
    assert.match(output, /พบชื่อห้องซ้ำ/);
    assert.match(output, /Friends \/ #general/);
    assert.match(output, /Work \/ #general/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});

test('a failed later Discord chunk does not advance the room-history cursor', async () => {
  const messages = Array.from({ length: 100 }, (_, index) => {
    const id = 100 - index;
    return { id: String(id), guildId: '10', channelId: '20', guildName: 'Friends', channelName: 'general',
      authorId: '30', authorName: 'Alice', content: `ข้อความ-${String(id).padStart(3, '0')}-${'ก'.repeat(20)}`,
      createdAt: 1700000000000 + id * 1000 };
  });
  let sends = 0;
  let failSecondChunk = true;
  const browsing = browsingFixture({ messages, sendPayload: async (payload, sent) => {
    sends++;
    if (failSecondChunk && sends === 2) {
      failSecondChunk = false;
      throw new Error('temporary Discord send failure');
    }
    sent.push(payload);
  } });
  try {
    await browsing.deliver('ขอดู 100 ข้อความล่าสุดในห้อง general server Friends');
    const beforeRetry = browsing.sent.length;
    await browsing.deliver('ต่อ');
    const retry = browsing.sent.slice(beforeRetry).map(item => item.content).join('\n');
    assert.match(retry, /ข้อความ-051/);
    assert.match(retry, /ข้อความ-100/);
    assert.doesNotMatch(retry, /ข้อความ-050/);
  } finally { await browsing.assistant.stop(); browsing.store.close(); }
});
