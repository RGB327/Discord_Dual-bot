// commands/register.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const pool = require('../db'); // mysql 연결 파일

module.exports = {
  data: new SlashCommandBuilder()
    .setName('등록')
    .setDescription('유저를 등록하고 기본 코스트를 지급합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;      // 디스코드 고유 ID
    const username = interaction.user.username;
    const defaultCost = 4000; // 시작 코스트

    try {
      // 이미 등록된 유저인지 확인
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE user_id = ?',
        [userId]
      );

      if (rows.length > 0) {
        return interaction.reply({
          content: '이미 등록된 유저입니다.',
          ephemeral: true
        });
      }

      // 신규 유저 등록
      await pool.query(`
        INSERT INTO users (user_id, username, cost)
        VALUES (?, ?, ?)
      `, [userId, username, defaultCost]);

    const embed = new EmbedBuilder()
        .setTitle('🎉 등록 완료')
        .setDescription(
            `${username}님 등록이 완료되었습니다!\n\n` +
            `💰 기본 코스트 **${defaultCost}** 지급되었습니다.`
        )
  .setColor(0x00ff99)
  .setThumbnail(interaction.user.displayAvatarURL()) // 프로필 사진
  .setFooter({
    text: '등록'
  })
  .setTimestamp();

await interaction.reply({
  embeds: [embed],
  ephemeral: false
});

    } catch (error) {
      console.error(error);

      await interaction.reply({
        content: '등록 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }
};