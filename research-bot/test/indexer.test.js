const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { createIndexer } = require('../src/indexer');

const record = id => ({ id: String(id), channelId: '20', guildId: '10', guildName: 'Guild', channelName: 'general', authorId: '30', authorName: 'Alice', content: `evidence ${id}`, createdAt: 1700000000000 });
function fixture(store, ids) {
  const channel = { id: '20' };
  const source = {
    discover: async () => [channel],
    fetchPage: async (_channel, before) => ids.filter(id => !before || BigInt(id) < BigInt(before))
      .sort((a, b) => b - a).slice(0, 100).map(record),
  };
  return createIndexer({ store, source, pagesPerChannel: 1, logger: { warn() {} } });
}

test('history is paginated across rounds and resumes after restart without losing messages', async () => {
  const store = createStore(':memory:');
  try {
    const ids = Array.from({ length: 305 }, (_, i) => i + 1);
    let indexer = fixture(store, ids);
    await indexer.sync();
    assert.ok(store.stats().messages < 305);
    indexer = fixture(store, ids);
    for (let i = 0; i < 5; i++) await indexer.sync();
    assert.equal(store.stats().messages, 305);
    assert.equal(store.getState('20').complete, true);
    assert.equal(store.getState('20').newest, '305');
  } finally { store.close(); }
});

test('more than one page of messages sent offline is recovered across bounded rounds', async () => {
  const store = createStore(':memory:');
  try {
    const ids = [1, 2, 3];
    let indexer = fixture(store, ids);
    await indexer.sync();
    ids.push(...Array.from({ length: 310 }, (_, i) => i + 4));
    await indexer.sync();
    indexer = fixture(store, ids);
    for (let i = 0; i < 6; i++) await indexer.sync();
    assert.equal(store.stats().messages, 313);
    assert.equal(store.getState('20').newest, '313');
  } finally { store.close(); }
});

test('a failing channel does not prevent other channels from indexing or advance its cursor', async () => {
  const store = createStore(':memory:');
  try {
    const source = { discover: async () => [{ id: 'bad' }, { id: '20' }], fetchPage: async c => {
      if (c.id === 'bad') throw new Error('temporary');
      return [record(1)];
    } };
    const indexer = createIndexer({ store, source, pagesPerChannel: 1, logger: { warn() {} } });
    await indexer.sync();
    assert.equal(store.stats().messages, 1);
    assert.equal(store.getState('bad'), null);
    assert.equal(indexer.status().errors, 1);
  } finally { store.close(); }
});
