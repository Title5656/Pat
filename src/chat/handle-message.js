const FAILURE_REPLY = 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠';
const MAX_PUBLIC_ERROR_LENGTH = 500;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_IMAGE_PROMPT = 'ช่วยดูรูปนี้หน่อย';

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

function createMessageHandler({ chatChannelId, conversation, fetchFn = fetch, logger = console }) {
  return async (message) => {
    const imageAttachments = [...(message.attachments?.values() ?? [])]
      .filter(({ contentType, size }) => contentType?.startsWith('image/')
        && size <= MAX_IMAGE_BYTES);
    if (
      message.channelId !== chatChannelId
      || message.author.bot
      || (!message.content.trim() && imageAttachments.length === 0)
    ) {
      return;
    }

    await message.channel.sendTyping().catch(() => {});

    let answer;
    try {
      const images = await Promise.all(imageAttachments.map(async ({ contentType, url }) => {
        const response = await fetchFn(url);
        if (!response.ok) throw new Error(`Could not download image (${response.status}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 10 MB limit.');
        return { data: bytes.toString('base64'), mimeType: contentType };
      }));
      answer = await conversation.reply({
        channelId: message.channelId,
        userName: message.member?.displayName
          ?? message.author.globalName
          ?? message.author.username,
        text: message.content.trim() || DEFAULT_IMAGE_PROMPT,
        ...(images.length ? { images } : {}),
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
