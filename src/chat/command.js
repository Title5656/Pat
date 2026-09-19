const PAT_COMMAND = {
  name: 'pat',
  description: 'คุยกับแพท',
  options: [{
    type: 3,
    name: 'ข้อความ',
    description: 'ข้อความที่อยากคุยกับแพท',
    required: true,
    max_length: 1000,
  }],
};

async function registerPatCommand(application, guildId) {
  await application.commands.set([PAT_COMMAND], guildId);
}

module.exports = { PAT_COMMAND, registerPatCommand };
