const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessageHandler } = require('../src/chat/handle-message');

function createMessage({ channelId = 'watch-room', content = 'หวัดดี', bot = false } = {}) {
  const calls = [];
  return {
    channelId,
    content,
    attachments: new Map(),
    author: { bot, globalName: 'มิน', username: 'min' },
    member: { displayName: 'คุณมิน' },
    channel: {
      sendTyping: async () => calls.push(['typing']),
      send: async (value) => calls.push(['send', value]),
    },
    calls,
  };
}

function createHandler({ stopwatchChannelId = 'watch-room', conversation, stopwatch } = {}) {
  return createMessageHandler({
    chatChannelId: 'chat-room',
    stopwatchChannelId,
    stopwatch,
    conversation,
    logger: { error() {} },
  });
}

test('answers stopwatch commands in the stopwatch channel without calling Gemini', async () => {
  const stopwatch = { tryHandle: () => 'เริ่มจับ "run 1" ให้แล้วนะ ⏱️' };
  const message = createMessage({ content: 'พิม เริ่มจับเวลา' });
  const handler = createHandler({
    stopwatch,
    conversation: { reply: async () => { throw new Error('must not run'); } },
  });

  await handler(message);

  assert.deepEqual(message.calls, [
    ['send', { content: 'เริ่มจับ "run 1" ให้แล้วนะ ⏱️', allowedMentions: { parse: [] } }],
  ]);
});

test('ignores non-command messages in the stopwatch channel', async () => {
  const message = createMessage({ content: 'วันนี้เหนื่อยจัง' });
  const handler = createHandler({
    stopwatch: { tryHandle: () => null },
    conversation: { reply: async () => { throw new Error('must not run'); } },
  });

  await handler(message);

  assert.deepEqual(message.calls, []);
});

test('keeps stopwatch commands out of the chat channel so Pim answers them', async () => {
  const message = createMessage({ channelId: 'chat-room', content: 'พิม เริ่มจับเวลา' });
  const handler = createHandler({
    stopwatch: { tryHandle: () => { throw new Error('must not run'); } },
    conversation: {
      reply: async (request) => {
        assert.equal(request.channelId, 'chat-room');
        assert.equal(request.text, 'พิม เริ่มจับเวลา');
        return 'จับเวลาทำไมอะ 😏';
      },
    },
  });

  await handler(message);

  assert.equal(message.calls.at(-1)[1].content, 'จับเวลาทำไมอะ 😏');
});

test('works without a stopwatch channel configured', async () => {
  const chatMessage = createMessage({ channelId: 'chat-room', content: 'หวัดดีพิม' });
  const watchMessage = createMessage({ content: 'พิม เริ่มจับเวลา' });
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: { reply: async () => 'หวัดดีจ้า' },
    logger: { error() {} },
  });

  await handler(chatMessage);
  assert.equal(chatMessage.calls.at(-1)[1].content, 'หวัดดีจ้า');

  await handler(watchMessage);
  assert.deepEqual(watchMessage.calls, []);
});

test('ignores bot messages in the stopwatch channel', async () => {
  const message = createMessage({ content: 'พิม เริ่มจับเวลา', bot: true });
  const handler = createHandler({
    stopwatch: { tryHandle: () => { throw new Error('must not run'); } },
    conversation: { reply: async () => { throw new Error('must not run'); } },
  });

  await handler(message);

  assert.deepEqual(message.calls, []);
});
