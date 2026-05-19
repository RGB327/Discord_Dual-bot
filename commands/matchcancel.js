// commands/matchCancel.js

const { SlashCommandBuilder } = require('discord.js');
const pool = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('매칭취소')
    .setDescription('대기 중인 매칭을 취소합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      const [[inQueue]] = await pool.query(
        `SELECT user_id FROM match_queue WHERE user_id = ?`, [userId]
      );

      if (!inQueue) {
        return interaction.reply({ content: '대기 중인 매칭이 없습니다.', ephemeral: true });
      }

      await pool.query(`DELETE FROM match_queue WHERE user_id = ?`, [userId]);

      return interaction.reply({ content: '매칭이 취소되었습니다.', ephemeral: true });

    } catch (err) {
      console.error('[matchCancel] 오류:', err);
      return interaction.reply({ content: '매칭 취소 중 오류가 발생했습니다.', ephemeral: true });
    }
  }
};