const FAILURE_REPLY = 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠';

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
      logger.error('Failed to answer chat message:', error.message);
      await message.channel.send(replyOptions(FAILURE_REPLY));
    }
  };
}

module.exports = { createMessageHandler };
