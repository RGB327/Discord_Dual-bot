// commands/mycards.js

const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const pool = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('내카드')
    .setDescription('자신의 보유 카드를 확인합니다')

    // 옵션 추가
    .addStringOption(option =>
      option
        .setName('공개설정')
        .setDescription('공개 여부를 선택하세요')
        .setRequired(true)
        .addChoices(
          { name: '공개', value: 'public' },
          { name: '비공개', value: 'private' }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // 옵션 값 가져오기
    const visibility =
      interaction.options.getString('공개설정');

    // 공개 여부 결정
    const isEphemeral = visibility === 'private';

    try {
      // 1. 유저 등록 확인
      const [userRows] = await pool.query(
        `SELECT * FROM users WHERE user_id = ?`,
        [userId]
      );

      if (userRows.length === 0) {
        return interaction.reply({
          content: '가입되지 않은 유저입니다.',
          ephemeral: true
        });
      }

      // 2. 보유 카드 조회
      const [cardRows] = await pool.query(`
        SELECT
          c.name,
          c.rarity,
          c.attack,
          c.hp,
          uc.level
        FROM user_cards uc
        JOIN cards c
          ON uc.card_id = c.id
        WHERE uc.user_id = ?
        ORDER BY c.rarity DESC, c.name ASC
      `, [userId]);
      
      // 3. 카드 없음
      if (cardRows.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle(`📚 ${username}님의 카드 목록`)
          .setDescription('보유한 카드가 없습니다.')
          .setColor(0xffcc00)
          .setThumbnail(
            interaction.user.displayAvatarURL({
              dynamic: true
            })
          )
          .setFooter({
            text: '카드를 구매해 주세요.'
          })
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          ephemeral: isEphemeral
        });
      }

      // 4. 카드 목록 Embed
      const embed = new EmbedBuilder()
        .setTitle(`📚 ${username}님의 카드 목록`)
        .setDescription('현재 보유 중인 카드입니다.')
        .setColor(0x5865F2)
        .setThumbnail(
          interaction.user.displayAvatarURL({
            dynamic: true
          })
        )
        .setFooter({
          text: `총 ${cardRows.length}장의 카드 보유`
        })
        .setTimestamp();

      for (const card of cardRows) {
        embed.addFields({
          name: `${card.name} [${card.rarity}]`,
          value:
            `⚔ 공격력: ${card.attack}\n` +
            `❤️ 체력: ${card.hp}\n` +
            `⭐ 레벨: ${card.level}`,
          inline: false
        });
      }

      await interaction.reply({
        embeds: [embed],
        ephemeral: isEphemeral
      });

    } catch (error) {
      console.error(error);

      await interaction.reply({
        content: '카드 조회 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }
};