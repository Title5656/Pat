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

    if (!response.text) {
      throw new Error('Gemini returned an empty response.');
    }
    return response.text;
  };
}

module.exports = { createGeminiGenerator };
