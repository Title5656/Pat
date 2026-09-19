const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createStore } = require('../src/store');

const record = (id, content) => ({ id, channelId: '20', guildId: '10', guildName: 'Friends', channelName: 'general', authorName: 'Somchai', authorId: '30', content, createdAt: 1700000000000 });

test('Thai words, English, and source metadata find messages across channels', () => {
  const store = createStore(':memory:');
  try {
    store.upsert(record('100', 'นัดกินหมูกระทะวันศุกร์ที่สยาม'));
    store.upsert({ ...record('101', 'The deployment is on Friday'), channelId: '21' });
    assert.deepEqual(store.search(['หมูกระทะ']).map(m => m.id), ['100']);
    assert.deepEqual(store.search(['deployment']).map(m => m.id), ['101']);
    assert.equal(store.search(['Somchai']).length, 2);
    assert.deepEqual(store.search(['" OR * NOT ()']).map(m => m.id), []);
  } finally { store.close(); }
});

test('updates replace search terms and deletes remove matches', () => {
  const store = createStore(':memory:');
  try {
    store.upsert(record('100', 'pizza'));
    store.upsert(record('100', 'sushi'));
    assert.equal(store.search(['pizza']).length, 0);
    assert.equal(store.search(['sushi']).length, 1);
    store.deleteMessage('100');
    assert.equal(store.search(['sushi']).length, 0);
    store.upsert(record('101', 'pizza'));
    store.setState('20', { oldest: '101', complete: true });
    store.deleteChannel('20');
    assert.equal(store.search(['pizza']).length, 0);
    assert.equal(store.getState('20'), null);
  } finally { store.close(); }
});

test('messages and synchronization cursors survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-store-'));
  const file = join(dir, 'index.sqlite');
  let store = createStore(file);
  try {
    store.upsert(record('100', 'restart evidence'));
    store.setState('20', { oldest: '100', newest: '200', complete: false });
    store.close();
    store = createStore(file);
    assert.equal(store.search(['evidence'])[0].content, 'restart evidence');
    assert.equal(store.getState('20').oldest, '100');
    assert.equal(store.stats().messages, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
