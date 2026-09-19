const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMemory } = require('../src/chat/memory');
const { PAT_PERSONA } = require('../src/chat/persona');
const { createConversation } = require('../src/chat/conversation');

test('sends persona and channel history to the model then saves both sides', async () => {
  const memory = createMemory();
  memory.append('room', { role: 'model', content: 'จำได้สิ...มั้งนะ' });
  let request;
  const conversation = createConversation({
    memory,
    generate: async (value) => {
      request = value;
      return 'อ๋อ เข้าใจแล้ว เดี๋ยวนะ เข้าใจจริงปะ';
    },
  });

  const answer = await conversation.reply({
    channelId: 'room',
    userName: 'มิน',
    text: 'หวัดดี',
  });

  assert.equal(request.instructions, PAT_PERSONA);
  assert.deepEqual(request.input, [
    { role: 'model', content: 'จำได้สิ...มั้งนะ' },
    { role: 'user', content: 'มิน: หวัดดี' },
  ]);
  assert.equal(answer, 'อ๋อ เข้าใจแล้ว เดี๋ยวนะ เข้าใจจริงปะ');
  assert.deepEqual(memory.get('room').slice(-2), [
    { role: 'user', content: 'มิน: หวัดดี' },
    { role: 'model', content: answer },
  ]);
});

test('does not save a failed model request', async () => {
  const memory = createMemory();
  const conversation = createConversation({
    memory,
    generate: async () => { throw new Error('offline'); },
  });

  await assert.rejects(() => conversation.reply({
    channelId: 'room',
    userName: 'มิน',
    text: 'อยู่ไหม',
  }));

  assert.deepEqual(memory.get('room'), []);
});
