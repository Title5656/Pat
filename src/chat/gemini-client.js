const { GoogleGenAI } = require('@google/genai');

function createGeminiGenerator({ apiKey, model, GoogleGenAIClass = GoogleGenAI }) {
  const client = new GoogleGenAIClass({ apiKey });

  return async ({ instructions, input }) => {
    const response = await client.models.generateContent({
      model,
      contents: input.map(({ role, content }) => ({
        role,
        parts: [{ text: content }],
      })),
      config: { systemInstruction: instructions },
    });

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini blocked the prompt: ${blockReason}.`);
    }
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      throw new Error(`Gemini did not return a complete response (finish reason: ${finishReason}).`);
    }
    if (!response.text) {
      if (finishReason) {
        throw new Error(`Gemini did not return text (finish reason: ${finishReason}).`);
      }
      throw new Error('Gemini returned an empty response.');
    }
    return response.text;
  };
}

module.exports = { createGeminiGenerator };
