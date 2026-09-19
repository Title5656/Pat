function createMemory({ maxMessages = 12 } = {}) {
  const histories = new Map();

  return {
    get(channelId) {
      return [...(histories.get(channelId) ?? [])];
    },

    append(channelId, ...messages) {
      const next = [...(histories.get(channelId) ?? []), ...messages];
      histories.set(channelId, next.slice(-maxMessages));
    },
  };
}

module.exports = { createMemory };
