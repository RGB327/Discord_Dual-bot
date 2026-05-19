// commands/match.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../db');
const { sendCardSelect } = require('../battle/cardSelect');
const { pendingSpectators, battleSpectators } = require('../battle/spectatorStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('매칭')
    .setDescription('매칭 방을 생성합니다'),

  async execute(interaction) {
    const hostId   = interaction.user.id;
    const hostName = interaction.user.username;

    try {
      // 관전 중 확인
      const { pendingSpectators: ps, battleSpectators: bs } = require('../battle/spectatorStore');
      const isSpectating = [...bs.values()].some(s => s.has(hostId)) || [...ps.values()].some(s => s.has(hostId));
      if (isSpectating) {
        return interaction.reply({ content: '관전 중에는 매칭을 생성할 수 없습니다. /관전취소 후 다시 시도하세요.', ephemeral: true });
      }

      // 1. 등록 확인
      const [[hostUser]] = await pool.query(
        `SELECT user_id FROM users WHERE user_id = ?`, [hostId]
      );
      if (!hostUser) {
        return interaction.reply({ content: '먼저 /등록 을 해주세요.', ephemeral: true });
      }

      // 2. 카드 보유 확인
      const [hostCards] = await pool.query(
        `SELECT card_id FROM user_cards WHERE user_id = ? LIMIT 1`, [hostId]
      );
      if (hostCards.length === 0) {
        return interaction.reply({ content: '보유한 카드가 없어 매칭을 시작할 수 없습니다.', ephemeral: true });
      }

      // 3. 진행 중 전투 확인
      const [ongoingBattle] = await pool.query(`
        SELECT id FROM battles
        WHERE (player1_id = ? OR player2_id = ?)
          AND status NOT IN ('ended', 'cancelled')
      `, [hostId, hostId]);
      if (ongoingBattle.length > 0) {
        return interaction.reply({ content: '이미 진행 중인 전투가 있습니다.', ephemeral: true });
      }

      // 4. 매칭 대기 중 확인 (match_queue)
      const [[inQueue]] = await pool.query(
        `SELECT user_id FROM match_queue WHERE user_id = ?`, [hostId]
      );
      if (inQueue) {
        return interaction.reply({ content: '이미 매칭 대기 중입니다.', ephemeral: true });
      }

      // 5. 매칭 대기열 등록
      await pool.query(
        `INSERT INTO match_queue (user_id) VALUES (?)`, [hostId]
      );

      // 6. 매칭 임베드 전송
      const embed = new EmbedBuilder()
        .setTitle('⚔ 대결 매칭')
        .setDescription(
          `**방장:** ${hostName}\n` +
          `**정원:** 1 / 2\n\n` +
          `아래 버튼을 눌러 대결에 참가하세요.`
        )
        .setColor(0x5865F2)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: '선착순 1명만 참가 가능 · 5분 후 자동 종료' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_${hostId}`)
          .setLabel('매칭 참가')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`spectate_${hostId}`)
          .setLabel('관전')
          .setStyle(ButtonStyle.Secondary)
      );

      const message = await interaction.reply({
        embeds: [embed],
        components: [row],
        fetchReply: true
      });

      let matched = false;

      const collector = message.createMessageComponentCollector({ time: 300_000 });

      collector.on('collect', async (btn) => {
        try {
        const joinId   = btn.user.id;
        const joinName = btn.user.username;

        // 관전 버튼
        if (btn.customId === `spectate_${hostId}`) {
          if (joinId === hostId) {
            return btn.reply({ content: '본인의 매칭은 관전할 수 없습니다.', ephemeral: true });
          }
          if (matched) {
            return btn.reply({ content: '이미 매칭이 완료되어 관전할 수 없습니다.', ephemeral: true });
          }

          // 진행 중 전투 / 매칭 대기 중 확인
          const [specOngoing] = await pool.query(`
            SELECT id FROM battles
            WHERE (player1_id = ? OR player2_id = ?)
              AND status NOT IN ('ended', 'cancelled')
          `, [joinId, joinId]);
          if (specOngoing.length > 0) {
            return btn.reply({ content: '진행 중인 전투가 있어 관전할 수 없습니다.', ephemeral: true });
          }
          const [[specInQueue]] = await pool.query(
            `SELECT user_id FROM match_queue WHERE user_id = ?`, [joinId]
          );
          if (specInQueue) {
            return btn.reply({ content: '매칭 대기 중에는 관전할 수 없습니다.', ephemeral: true });
          }

          if (!pendingSpectators.has(hostId)) pendingSpectators.set(hostId, new Set());
          const specs = pendingSpectators.get(hostId);
          if (specs.has(joinId)) {
            return btn.reply({ content: '이미 관전 등록되어 있습니다.', ephemeral: true });
          }
          specs.add(joinId);
          return btn.reply({ content: '관전 등록 완료! 매칭 성사 시 DM으로 전투 현황이 전송됩니다.', ephemeral: true });
        }

        if (joinId === hostId) {
          return btn.reply({ content: '본인은 참가할 수 없습니다.', ephemeral: true });
        }

        if (matched) {
          return btn.reply({ content: '이미 매칭이 완료되었습니다.', ephemeral: true });
        }

        // 방장이 대기열에 있는지 확인 (매칭 취소 여부)
        const [[hostInQueue]] = await pool.query(
          `SELECT user_id FROM match_queue WHERE user_id = ?`, [hostId]
        );
        if (!hostInQueue) {
          collector.stop('cancelled');
          return btn.reply({ content: '방장이 매칭을 취소했습니다.', ephemeral: true });
        }

        // 등록 확인
        const [[joinUser]] = await pool.query(
          `SELECT user_id FROM users WHERE user_id = ?`, [joinId]
        );
        if (!joinUser) {
          return btn.reply({ content: '먼저 /등록 을 해주세요.', ephemeral: true });
        }

        // 카드 보유 확인
        const [joinCards] = await pool.query(
          `SELECT card_id FROM user_cards WHERE user_id = ? LIMIT 1`, [joinId]
        );
        if (joinCards.length === 0) {
          return btn.reply({ content: '보유한 카드가 없어 참가할 수 없습니다.', ephemeral: true });
        }

        // 진행 중 전투 확인
        const [joinOngoing] = await pool.query(`
          SELECT id FROM battles
          WHERE (player1_id = ? OR player2_id = ?)
            AND status NOT IN ('ended', 'cancelled')
        `, [joinId, joinId]);
        if (joinOngoing.length > 0) {
          return btn.reply({ content: '이미 진행 중인 전투가 있습니다.', ephemeral: true });
        }

        // 매칭 대기 중 확인
        const [[joinInQueue]] = await pool.query(
          `SELECT user_id FROM match_queue WHERE user_id = ?`, [joinId]
        );
        if (joinInQueue) {
          return btn.reply({ content: '이미 매칭 대기 중입니다.', ephemeral: true });
        }

        // 매칭 성사
        matched = true;
        collector.stop('matched');

        // 참가자가 관전 중이었으면 제거
        for (const specs of pendingSpectators.values()) specs.delete(joinId);
        for (const specs of battleSpectators.values()) specs.delete(joinId);

        // 대기열 제거
        await pool.query(`DELETE FROM match_queue WHERE user_id = ?`, [hostId]);

        // battle 생성
        const [result] = await pool.query(`
          INSERT INTO battles (player1_id, player2_id, turn_user_id, status)
          VALUES (?, ?, ?, 'selecting')
        `, [hostId, joinId, hostId]);

        const battleId = result.insertId;

        const matchedEmbed = new EmbedBuilder()
          .setTitle('🔥 매칭 성공!')
          .setDescription(
            `**${hostName}** VS **${joinName}**\n\n` +
            `각자 DM으로 카드 선택 메시지가 전송됩니다.`
          )
          .setColor(0x00cc66)
          .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('matched_done')
            .setLabel('매칭 완료')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        await btn.update({ embeds: [matchedEmbed], components: [disabledRow] });

        // 관전자 이전
        if (pendingSpectators.has(hostId)) {
          battleSpectators.set(String(battleId), pendingSpectators.get(hostId));
          pendingSpectators.delete(hostId);

          for (const specId of battleSpectators.get(String(battleId))) {
            try {
              const specUser = await interaction.client.users.fetch(specId);
              await specUser.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle('관전 시작!')
                    .setDescription(`**${hostName}** VS **${joinName}** 전투가 시작됩니다.\n이제부터 턴 결과가 DM으로 전송됩니다.`)
                    .setColor(0x9b59b6)
                    .setTimestamp()
                ]
              });
            } catch (e) {}
          }
        }

        await sendCardSelect(interaction.client, battleId, hostId);
        await sendCardSelect(interaction.client, battleId, joinId);
        } catch (err) {
          console.error('[match collector] 오류:', err);
          try { await btn.reply({ content: '오류가 발생했습니다.', ephemeral: true }); } catch(e) {}
        }
      });

      collector.on('end', async (_, reason) => {
        await pool.query(`DELETE FROM match_queue WHERE user_id = ?`, [hostId]).catch(() => {});

        if (reason === 'matched') return; // 관전자 이전은 collect 핸들러에서 처리
        pendingSpectators.delete(hostId);

        // 방장이 취소한 경우
        if (reason === 'cancelled') {
          const cancelEmbed = new EmbedBuilder()
            .setTitle('매칭 취소됨')
            .setDescription('방장이 매칭을 취소했습니다.')
            .setColor(0xff4444)
            .setTimestamp();

          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cancelled_done')
              .setLabel('매칭 취소')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );

          await message.edit({ embeds: [cancelEmbed], components: [disabledRow] }).catch(() => {});
          return;
        }

        // 시간 초과
        const timeoutEmbed = new EmbedBuilder()
          .setTitle('⌛ 매칭 종료')
          .setDescription('참가자가 없어 매칭이 종료되었습니다.')
          .setColor(0xff9900)
          .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('timeout_done')
            .setLabel('매칭 종료')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        await message.edit({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
      });

    } catch (err) {
      console.error('[match] 오류:', err);
      // 오류 시 대기열 제거
      await pool.query(`DELETE FROM match_queue WHERE user_id = ?`, [hostId]).catch(() => {});
      await interaction.reply({ content: '매칭 생성 중 오류가 발생했습니다.', ephemeral: true }).catch(() => {});
    }
  }
};