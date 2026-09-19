const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMemory } = require('../src/chat/memory');

test('keeps channel histories isolated and returns copies', () => {
  const memory = createMemory({ maxMessages: 3 });
  memory.append('a', { role: 'user', content: 'หนึ่ง' });

  assert.deepEqual(memory.get('a'), [{ role: 'user', content: 'หนึ่ง' }]);
  assert.deepEqual(memory.get('b'), []);

  memory.get('a').push({ role: 'model', content: 'แก้ข้างนอก' });
  assert.equal(memory.get('a').length, 1);
});

test('retains only the newest configured number of messages', () => {
  const memory = createMemory({ maxMessages: 3 });
  memory.append('a',
    { role: 'user', content: '1' },
    { role: 'model', content: '2' },
    { role: 'user', content: '3' },
    { role: 'model', content: '4' });

  assert.deepEqual(memory.get('a').map((item) => item.content), ['2', '3', '4']);
});
