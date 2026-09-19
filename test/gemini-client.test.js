const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createGeminiGenerator } = require('../src/chat/gemini-client');

test('maps conversation history to Gemini and returns response text', async () => {
  let request;
  class FakeGoogleGenAI {
    constructor(config) {
      assert.deepEqual(config, { apiKey: 'key' });
    }

    models = {
      generateContent: async (value) => {
        request = value;
        return { text: 'คำตอบ' };
      },
    };
  }
  const generate = createGeminiGenerator({
    apiKey: 'key',
    model: 'configured-model',
    GoogleGenAIClass: FakeGoogleGenAI,
  });

  const result = await generate({
    instructions: 'persona',
    input: [
      { role: 'user', content: 'มิน: สวัสดี' },
      { role: 'model', content: 'เอ่อ หวัดดี' },
    ],
  });

  assert.deepEqual(request, {
    model: 'configured-model',
    contents: [
      { role: 'user', parts: [{ text: 'มิน: สวัสดี' }] },
      { role: 'model', parts: [{ text: 'เอ่อ หวัดดี' }] },
    ],
    config: { systemInstruction: 'persona' },
  });
  assert.equal(result, 'คำตอบ');
});

test('rejects an empty Gemini response', async () => {
  class FakeGoogleGenAI {
    models = { generateContent: async () => ({ text: '' }) };
  }
  const generate = createGeminiGenerator({
    apiKey: 'key',
    model: 'configured-model',
    GoogleGenAIClass: FakeGoogleGenAI,
  });

  await assert.rejects(() => generate({ instructions: 'persona', input: [] }), {
    message: 'Gemini returned an empty response.',
  });
});

test('reports the Gemini safety reason when a response is blocked', async () => {
  class FakeGoogleGenAI {
    models = {
      generateContent: async () => ({
        text: '',
        promptFeedback: { blockReason: 'SAFETY' },
      }),
    };
  }
  const generate = createGeminiGenerator({
    apiKey: 'key',
    model: 'configured-model',
    GoogleGenAIClass: FakeGoogleGenAI,
  });

  await assert.rejects(() => generate({ instructions: 'persona', input: [] }), {
    message: 'Gemini blocked the prompt: SAFETY.',
  });
});
