const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PAT_COMMAND, registerPatCommand } = require('../src/chat/command');

test('defines /pat with one required Thai string option', () => {
  assert.equal(PAT_COMMAND.name, 'pat');
  assert.deepEqual(PAT_COMMAND.options, [{
    type: 3,
    name: 'ข้อความ',
    description: 'ข้อความที่อยากคุยกับแพท',
    required: true,
    max_length: 1000,
  }]);
});

test('registers /pat in the configured guild', async () => {
  const calls = [];
  const application = { commands: { set: async (...args) => calls.push(args) } };

  await registerPatCommand(application, 'guild-1');

  assert.deepEqual(calls, [[[PAT_COMMAND], 'guild-1']]);
});
