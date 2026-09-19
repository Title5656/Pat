const FAILURE_REPLY = 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠';
const MAX_PUBLIC_ERROR_LENGTH = 500;

function publicGeminiError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|key|token)\s*[=:]\s*)[^\s&]+/gi, '$1[REDACTED]')
    .slice(0, MAX_PUBLIC_ERROR_LENGTH);
}

function replyOptions(content) {
  return {
    content: content.slice(0, 2000),
    allowedMentions: { parse: [] },
  };
}

function createMessageHandler({ chatChannelId, conversation, logger = console }) {
  return async (message) => {
    if (
      message.channelId !== chatChannelId
      || message.author.bot
      || !message.content.trim()
    ) {
      return;
    }

    await message.channel.sendTyping().catch(() => {});

    try {
      const answer = await conversation.reply({
        channelId: message.channelId,
        userName: message.member?.displayName
          ?? message.author.globalName
          ?? message.author.username,
        text: message.content.trim(),
      });
      await message.channel.send(replyOptions(answer));
    } catch (error) {
      logger.error('Failed to answer chat message:', error);
      await message.channel.send(replyOptions(
        `${FAILURE_REPLY}\nGemini error: ${publicGeminiError(error)}`,
      ));
    }
  };
}

module.exports = { createMessageHandler };
