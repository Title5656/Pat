const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessageHandler } = require('../src/chat/handle-message');

function createMessage({
  channelId = 'chat-room',
  content = 'หวัดดีแพท',
  bot = false,
} = {}) {
  const calls = [];
  return {
    channelId,
    content,
    author: { bot, globalName: 'มิน', username: 'min' },
    member: { displayName: 'คุณมิน' },
    channel: {
      sendTyping: async () => calls.push(['typing']),
      send: async (value) => calls.push(['send', value]),
    },
    calls,
  };
}

test('answers a normal message in the configured channel', async () => {
  const message = createMessage();
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: {
      reply: async (request) => {
        assert.deepEqual(request, {
          channelId: 'chat-room',
          userName: 'คุณมิน',
          text: 'หวัดดีแพท',
        });
        return 'เอ่อ หวัดดี...ใช่ หวัดดี';
      },
    },
    logger: { error() {} },
  });

  await handler(message);

  assert.deepEqual(message.calls, [
    ['typing'],
    ['send', {
      content: 'เอ่อ หวัดดี...ใช่ หวัดดี',
      allowedMentions: { parse: [] },
    }],
  ]);
});

test('ignores messages outside the configured channel, from bots, or without text', async () => {
  const messages = [
    createMessage({ channelId: 'other-room' }),
    createMessage({ bot: true }),
    createMessage({ content: '   ' }),
  ];
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: { reply: async () => { throw new Error('must not run'); } },
    logger: console,
  });

  for (const message of messages) {
    await handler(message);
    assert.deepEqual(message.calls, []);
  }
});

test('uses a friendly fallback when Gemini fails', async () => {
  const message = createMessage();
  const errors = [];
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: { reply: async () => { throw new Error('offline'); } },
    logger: { error: (...args) => errors.push(args) },
  });

  await handler(message);

  assert.deepEqual(message.calls.at(-1), ['send', {
    content: 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠\nGemini error: offline',
    allowedMentions: { parse: [] },
  }]);
  assert.equal(errors.length, 1);
});

test('redacts credentials and limits the public Gemini error', async () => {
  const message = createMessage();
  const fakeApiKey = `AQ.${'A'.repeat(40)}`;
  const bearerToken = 'ya29.private-bearer-token';
  const jsonApiKey = 'private-json-key';
  const quotedToken = 'private-quoted-token';
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: {
      reply: async () => {
        throw new Error(
          `request failed key=${fakeApiKey} Authorization: Bearer ${bearerToken} `
          + `{"apiKey":"${jsonApiKey}"} token "${quotedToken}" ${'x'.repeat(600)}`,
        );
      },
    },
    logger: { error() {} },
  });

  await handler(message);

  const content = message.calls.at(-1)[1].content;
  const publicError = content.split('Gemini error: ')[1];
  for (const credential of [fakeApiKey, bearerToken, jsonApiKey, quotedToken]) {
    assert.equal(content.includes(credential), false);
  }
  assert.match(content, /key=\[REDACTED\]/);
  assert.match(content, /Bearer \[REDACTED\]/);
  assert.match(content, /"apiKey":\s*"?\[REDACTED\]"?/);
  assert.match(content, /token "\[REDACTED\]"/);
  assert.equal(publicError.length, 500);
});

test('truncates Gemini responses to the Discord message limit', async () => {
  const message = createMessage();
  const handler = createMessageHandler({
    chatChannelId: 'chat-room',
    conversation: { reply: async () => 'ก'.repeat(2100) },
    logger: { error() {} },
  });

  await handler(message);

  assert.equal(message.calls.at(-1)[1].content.length, 2000);
});
