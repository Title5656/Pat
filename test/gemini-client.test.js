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

test('rejects partial text when Gemini finishes for safety', async () => {
  class FakeGoogleGenAI {
    models = {
      generateContent: async () => ({
        text: 'partial text that must not be posted',
        candidates: [{ finishReason: 'SAFETY' }],
      }),
    };
  }
  const generate = createGeminiGenerator({
    apiKey: 'key',
    model: 'configured-model',
    GoogleGenAIClass: FakeGoogleGenAI,
  });

  await assert.rejects(() => generate({ instructions: 'persona', input: [] }), {
    message: 'Gemini did not return a complete response (finish reason: SAFETY).',
  });
});

for (const finishReason of [
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'IMAGE_OTHER',
]) {
  test(`rejects partial text when Gemini finishes for ${finishReason}`, async () => {
    class FakeGoogleGenAI {
      models = {
        generateContent: async () => ({
          text: 'partial text that must not be posted',
          candidates: [{ finishReason }],
        }),
      };
    }
    const generate = createGeminiGenerator({
      apiKey: 'key',
      model: 'configured-model',
      GoogleGenAIClass: FakeGoogleGenAI,
    });

    await assert.rejects(() => generate({ instructions: 'persona', input: [] }), {
      message: `Gemini did not return a complete response (finish reason: ${finishReason}).`,
    });
  });
}
