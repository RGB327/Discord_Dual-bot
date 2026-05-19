// commands/spectateCancel.js

const { SlashCommandBuilder } = require('discord.js');
const { pendingSpectators, battleSpectators } = require('../battle/spectatorStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('관전취소')
    .setDescription('현재 관전을 취소합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // pendingSpectators에서 제거
    for (const [hostId, specs] of pendingSpectators.entries()) {
      if (specs.has(userId)) {
        specs.delete(userId);
        return interaction.reply({ content: '관전 대기가 취소되었습니다.', ephemeral: true });
      }
    }

    // battleSpectators에서 제거
    for (const [battleId, specs] of battleSpectators.entries()) {
      if (specs.has(userId)) {
        specs.delete(userId);
        return interaction.reply({ content: '관전이 취소되었습니다.', ephemeral: true });
      }
    }

    return interaction.reply({ content: '현재 관전 중이 아닙니다.', ephemeral: true });
  }
};
