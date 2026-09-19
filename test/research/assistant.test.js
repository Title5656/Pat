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
