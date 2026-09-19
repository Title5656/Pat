const { PAT_PERSONA } = require('./persona');

function createConversation({ generate, memory }) {
  const queues = new Map();

  return {
    async reply({ channelId, userName, text }) {
      const previous = queues.get(channelId) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(async () => {
        const userMessage = { role: 'user', content: `${userName}: ${text}` };
        const answer = await generate({
          instructions: PAT_PERSONA,
          input: [...memory.get(channelId), userMessage],
        });

        memory.append(channelId, userMessage, { role: 'model', content: answer });
        return answer;
      });
      queues.set(channelId, current);

      try {
        return await current;
      } finally {
        if (queues.get(channelId) === current) {
          queues.delete(channelId);
        }
      }
    },
  };
}

module.exports = { createConversation };
