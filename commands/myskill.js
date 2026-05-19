// commands/myskills.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('내스킬')
    .setDescription('현재 전투 중 보유한 스킬을 확인합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
      // 1. 등록 확인
      const [userRows] = await pool.query(`
        SELECT *
        FROM users
        WHERE user_id = ?
      `, [userId]);

      if (userRows.length === 0) {
        return interaction.reply({
          content: '먼저 /등록 을 해주세요.',
          ephemeral: true
        });
      }

      // 2. 진행 중 battle 확인
      const [battleRows] = await pool.query(`
        SELECT *
        FROM battles
        WHERE
          (player1_id = ? OR player2_id = ?)
          AND status IN ('ongoing', 'selecting')
        ORDER BY id DESC
        LIMIT 1
      `, [userId, userId]);

      if (battleRows.length === 0) {
        return interaction.reply({
          content: '현재 진행 중인 전투가 없습니다.',
          ephemeral: true
        });
      }

      const battleId = battleRows[0].id;

      // 3. 지급된 스킬 조회
      const [skillRows] = await pool.query(`
        SELECT
          bs.skill_id,
          bs.skill_slot,
          s.name,
          s.attack,
          s.min,
          s.max,
          s.skill,
          s.is_common
        FROM battle_skills bs
        JOIN skill s
          ON bs.skill_id = s.id
        WHERE
          bs.battle_id = ?
          AND bs.user_id = ?
        ORDER BY
          s.skill ASC,
          s.name ASC
      `, [battleId, userId]);

      if (skillRows.length === 0) {
        return interaction.reply({
          content: '현재 지급된 스킬이 없습니다.',
          ephemeral: true
        });
      }

      let index = 0;

      const makeEmbed = (skill) => {
        const typeText = skill.is_common
          ? '공용 스킬'
          : '고유 스킬';

        return new EmbedBuilder()
          .setTitle(`🧠 ${username}님의 스킬`)
          .setDescription(
            `**${skill.name}**\n\n` +
            `📌 종류: ${skill.skill}스킬\n` +
            `🏷 분류: ${typeText}\n` +
            `⚔ 배율: ${skill.attack}x\n` +
            `🎯 범위: ${skill.min} ~ ${skill.max}`
          )
          .setColor(0x5865F2)
          .setFooter({
            text: `${index + 1} / ${skillRows.length}`
          })
          .setTimestamp();
      };

      const makeButtons = () => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev_skill')
            .setLabel('<')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0),

          new ButtonBuilder()
            .setCustomId('close_skill')
            .setLabel('닫기')
            .setStyle(ButtonStyle.Danger),

          new ButtonBuilder()
            .setCustomId('next_skill')
            .setLabel('>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === skillRows.length - 1)
        );
      };

      const message = await interaction.reply({
        embeds: [makeEmbed(skillRows[index])],
        components: [makeButtons()],
        fetchReply: true,
        ephemeral: true
      });

      const collector = message.createMessageComponentCollector({
        time: 300000
      });

      collector.on('collect', async (btnInteraction) => {
        if (btnInteraction.user.id !== userId) {
          return btnInteraction.reply({
            content: '본인만 사용할 수 있습니다.',
            ephemeral: true
          });
        }

        // 이전
        if (btnInteraction.customId === 'prev_skill') {
          if (index > 0) index--;

          return btnInteraction.update({
            embeds: [makeEmbed(skillRows[index])],
            components: [makeButtons()]
          });
        }

        // 다음
        if (btnInteraction.customId === 'next_skill') {
          if (index < skillRows.length - 1) index++;

          return btnInteraction.update({
            embeds: [makeEmbed(skillRows[index])],
            components: [makeButtons()]
          });
        }

        // 닫기
        if (btnInteraction.customId === 'close_skill') {
          collector.stop();

          return btnInteraction.update({
            content: '스킬 창을 닫았습니다.',
            embeds: [],
            components: []
          });
        }
      });

      collector.on('end', async () => {
        try {
          await message.edit({
            components: []
          });
        } catch (e) {}
      });

    } catch (error) {
      console.error(error);

      await interaction.reply({
        content: '스킬 조회 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }
};