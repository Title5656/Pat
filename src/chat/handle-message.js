const FAILURE_REPLY = 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠';
const MAX_PUBLIC_ERROR_LENGTH = 500;

function publicGeminiError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,}"']+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|password|secret|cookie)["']?\s*[:=]\s*)["'][^"']*["']/gi, '$1"[REDACTED]"')
    .replace(/\b((?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|password|secret|cookie))\s+["'][^"']*["']/gi, '$1 "[REDACTED]"')
    .replace(/(["']?(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|password|secret|cookie)["']?\s*[:=]\s*)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(/(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/g, '[REDACTED]')
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

    let answer;
    try {
      answer = await conversation.reply({
        channelId: message.channelId,
        userName: message.member?.displayName
          ?? message.author.globalName
          ?? message.author.username,
        text: message.content.trim(),
      });
    } catch (error) {
      logger.error('Failed to answer chat message:', error);
      try {
        await message.channel.send(replyOptions(
          `${FAILURE_REPLY}\nGemini error: ${publicGeminiError(error)}`,
        ));
      } catch (sendError) {
        logger.error('Failed to send Gemini error reply:', sendError);
      }
      return;
    }

    try {
      await message.channel.send(replyOptions(answer));
    } catch (error) {
      logger.error('Failed to send chat message:', error);
    }
  };
}

module.exports = { createMessageHandler };
