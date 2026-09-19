const { PAT_PERSONA } = require('./persona');

function createConversation({ generate, memory }) {
  return {
    async reply({ channelId, userName, text }) {
      const userMessage = { role: 'user', content: `${userName}: ${text}` };
      const answer = await generate({
        instructions: PAT_PERSONA,
        input: [...memory.get(channelId), userMessage],
      });

      memory.append(channelId, userMessage, { role: 'model', content: answer });
      return answer;
    },
  };
}

module.exports = { createConversation };
