const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPatHandler } = require('../src/chat/handle-pat');

function createInteraction({ commandName = 'pat', chatInput = true } = {}) {
  const calls = [];
  return {
    commandName,
    channelId: 'room',
    user: { globalName: 'มิน', username: 'min' },
    options: {
      getString: (name, required) => {
        calls.push(['option', name, required]);
        return 'หวัดดี';
      },
    },
    isChatInputCommand: () => chatInput,
    deferReply: async () => calls.push(['defer']),
    editReply: async (value) => calls.push(['edit', value]),
    calls,
  };
}

test('defers and publishes the conversation answer', async () => {
  const interaction = createInteraction();
  const handler = createPatHandler({
    conversation: {
      reply: async (request) => {
        assert.deepEqual(request, {
          channelId: 'room',
          userName: 'มิน',
          text: 'หวัดดี',
        });
        return 'เอ่อ หวัดดี...ใช่ หวัดดี';
      },
    },
    logger: { error() {} },
  });

  await handler(interaction);

  assert.deepEqual(interaction.calls, [
    ['option', 'ข้อความ', true],
    ['defer'],
    ['edit', {
      content: 'เอ่อ หวัดดี...ใช่ หวัดดี',
      allowedMentions: { parse: [] },
    }],
  ]);
});

test('uses a friendly fallback and logs model failures', async () => {
  const interaction = createInteraction();
  const errors = [];
  const handler = createPatHandler({
    conversation: { reply: async () => { throw new Error('offline'); } },
    logger: { error: (...args) => errors.push(args) },
  });

  await handler(interaction);

  assert.deepEqual(interaction.calls.at(-1), [
    'edit',
    'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠',
  ]);
  assert.equal(errors.length, 1);
});

test('truncates responses to the Discord message limit', async () => {
  const interaction = createInteraction();
  const handler = createPatHandler({
    conversation: { reply: async () => 'ก'.repeat(2100) },
    logger: { error() {} },
  });

  await handler(interaction);

  assert.equal(interaction.calls.at(-1)[1].content.length, 2000);
  assert.deepEqual(interaction.calls.at(-1)[1].allowedMentions, { parse: [] });
});

test('ignores unrelated interactions', async () => {
  for (const interaction of [
    createInteraction({ commandName: 'other' }),
    createInteraction({ chatInput: false }),
  ]) {
    const handler = createPatHandler({ conversation: {}, logger: console });
    await handler(interaction);
    assert.deepEqual(interaction.calls, []);
  }
});
