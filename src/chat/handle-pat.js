const FAILURE_REPLY = 'แพทคิดไม่ออกอะ ลองถามใหม่อีกทีได้มั้ย 🫠';

function createPatHandler({ conversation, logger = console }) {
  return async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'pat') {
      return;
    }

    const text = interaction.options.getString('ข้อความ', true);
    await interaction.deferReply();

    try {
      const answer = await conversation.reply({
        channelId: interaction.channelId,
        userName: interaction.user.globalName ?? interaction.user.username,
        text,
      });
      await interaction.editReply({
        content: answer.slice(0, 2000),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.error('Failed to answer /pat:', error.message);
      await interaction.editReply(FAILURE_REPLY);
    }
  };
}

module.exports = { createPatHandler };
