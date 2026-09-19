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

test('sends images with the current prompt without retaining their bytes', async () => {
  const memory = createMemory();
  let request;
  const conversation = createConversation({
    memory,
    generate: async (value) => {
      request = value;
      return 'เป็นแมว';
    },
  });
  const images = [{ data: 'Y2F0', mimeType: 'image/png' }];

  await conversation.reply({
    channelId: 'room',
    userName: 'มิน',
    text: 'รูปอะไร',
    images,
  });

  assert.deepEqual(request.input.at(-1), {
    role: 'user',
    content: 'มิน: รูปอะไร',
    images,
  });
  assert.deepEqual(memory.get('room'), [
    { role: 'user', content: 'มิน: รูปอะไร' },
    { role: 'model', content: 'เป็นแมว' },
  ]);
});

test('serializes overlapping replies in the same channel', async () => {
  const memory = createMemory();
  const requests = [];
  const resolvers = [];
  const conversation = createConversation({
    memory,
    generate: (request) => {
      requests.push(request);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const first = conversation.reply({ channelId: 'room', userName: 'เอ', text: 'หนึ่ง' });
  const second = conversation.reply({ channelId: 'room', userName: 'บี', text: 'สอง' });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requests.length, 1);

  resolvers[0]('ตอบหนึ่ง');
  await first;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].input, [
    { role: 'user', content: 'เอ: หนึ่ง' },
    { role: 'model', content: 'ตอบหนึ่ง' },
    { role: 'user', content: 'บี: สอง' },
  ]);

  resolvers[1]('ตอบสอง');
  await second;
});
