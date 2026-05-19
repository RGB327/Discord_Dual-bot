// battle/battleStart.js

const pool = require('../db');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { handleBattleButton, makeTurnResultEmbed, makeSupportResultEmbed } = require('./battleHandler');
const { canEscape } = require('./battleEscape');

const battleCollectors = new Map();

async function canCoverAttack(battleId, userId) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const myCardId = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;
  if (myCardId !== 5) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM battle_skills WHERE battle_id = ? AND user_id = ? AND is_support = 1 LIMIT 1`,
    [battleId, userId]
  );
  return rows.length > 0;
}

// -------------------------------------------------
// 전투 시작 DM
// -------------------------------------------------
async function sendBattleStart(client, battleId, userId) {
  const [[battle]]  = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const oppId       = battle.player1_id === userId ? battle.player2_id      : battle.player1_id;
  const myCardId    = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;
  const oppCardId   = battle.player1_id === userId ? battle.player2_card_id : battle.player1_card_id;

  const [[myCard]]  = await pool.query(`SELECT * FROM cards WHERE id = ?`, [myCardId]);
  const [[oppCard]] = await pool.query(`SELECT * FROM cards WHERE id = ?`, [oppCardId]);
  const [[oppUser]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [oppId]);

  const embed = new EmbedBuilder()
    .setTitle('전투 시작!')
    .setDescription(
      `VS ${oppUser.username}\n\n` +
      `내 카드: **${myCard.name}** [${myCard.rarity}]\n` +
      `공격력: ${myCard.attack}  체력: ${myCard.hp}\n\n` +
      `상대 카드: **${oppCard.name}** [${oppCard.rarity}]\n` +
      `공격력: ${oppCard.attack}  체력: ${oppCard.hp}\n\n` +
      `현재 턴: **${battle.turn_number}**`
    )
    .setColor(0xe74c3c)
    .setTimestamp();

  await _sendAndListen(client, battleId, userId, [embed]);
  _registerBattleEndedEvent(client, battleId);
}

// -------------------------------------------------
// 새 턴 DM
// -------------------------------------------------
async function sendBattleMessage(client, battleId, userId, turnNumber, turnResult = null) {
  const [[battle]]  = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const oppId       = battle.player1_id === userId ? battle.player2_id : battle.player1_id;

  const [[bc]]      = await pool.query(`SELECT current_hp FROM battle_cards WHERE battle_id = ? AND user_id = ?`, [battleId, userId]);
  const [[oppBc]]   = await pool.query(`SELECT current_hp FROM battle_cards WHERE battle_id = ? AND user_id = ?`, [battleId, oppId]);
  const [[oppUser]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [oppId]);

  const embeds = [];

  if (turnResult) {
    const supEmbed = makeSupportResultEmbed(turnResult, userId);
    if (supEmbed) embeds.push(supEmbed);
    embeds.push(makeTurnResultEmbed(turnResult, userId));
  }

  embeds.push(
    new EmbedBuilder()
      .setTitle(`턴 ${turnNumber} 시작`)
      .setDescription(
        `VS ${oppUser.username}\n\n` +
        `내 체력: **${bc?.current_hp ?? '?'}**\n` +
        `${oppUser.username} 체력: **${oppBc?.current_hp ?? '?'}**`
      )
      .setColor(0x3498db)
      .setTimestamp()
  );

  await _sendAndListen(client, battleId, userId, embeds);
}

// -------------------------------------------------
// DM 전송 + collector 등록
// -------------------------------------------------
async function _sendAndListen(client, battleId, userId, embeds) {
  try {
    const user = await client.users.fetch(userId);

    const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
    const isStunned        = battle.player1_id === userId ? battle.p1_stunned : battle.p2_stunned;
    const escapeAvail      = await canEscape(battleId, userId);
    const coverDefenseAvail = await canCoverAttack(battleId, userId);

    const msg = await user.send({
      embeds,
      components: makeBattleRows(battleId, !!isStunned, escapeAvail, coverDefenseAvail)
    });

    const key      = `${battleId}_${userId}`;
    const existing = battleCollectors.get(key);
    if (existing) existing.stop('replaced');

    const collector = msg.createMessageComponentCollector({
      filter: (i) => {
        if (i.user.id !== userId) return false;
        if (i.customId.startsWith('shop_')) return false;
        return true;
      },
      time: 300_000
    });

    battleCollectors.set(key, collector);

    collector.on('collect', async (i) => {
      await handleBattleButton(i, battleId, client, collector);
    });

    collector.on('end', async (_, reason) => {
      battleCollectors.delete(key);

      if (reason === 'battleEnd' || reason === 'replaced') {
        await msg.edit({ components: [] }).catch(() => {});
        return;
      }

      if (reason === 'time') {
        const [[b]] = await pool.query(
          `SELECT * FROM battles WHERE id = ? AND status = 'battle'`, [battleId]
        ).catch(() => [[null]]);

        if (!b) {
          await msg.edit({ components: [] }).catch(() => {});
          return;
        }

        const winnerId = b.player1_id === userId ? b.player2_id : b.player1_id;

        await pool.query(
          `UPDATE battles SET status = 'ended', winner_id = ? WHERE id = ? AND status = 'battle'`,
          [winnerId, battleId]
        ).catch(() => {});

        client.emit('battleEnded', String(battleId));

        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle('턴 시간 초과')
              .setDescription('턴 제한 시간이 초과되어 자동 패배 처리되었습니다.')
              .setColor(0x7f8c8d)
          ],
          components: []
        }).catch(() => {});

        try {
          const winner = await client.users.fetch(winnerId);
          await winner.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('전투 종료 - 승리!')
                .setDescription('상대방이 턴 제한 시간을 초과하여 승리하셨습니다!')
                .setColor(0xf1c40f)
                .setTimestamp()
            ]
          });
        } catch (e) {}
        return;
      }

      await msg.edit({ components: [] }).catch(() => {});
    });

  } catch (err) {
    console.error(`[battleStart] DM 전송 실패 (${userId}):`, err);
  }
}

// -------------------------------------------------
// battleEnded 이벤트
// -------------------------------------------------
function _registerBattleEndedEvent(client, battleId) {
  const key = `battleEnded_${battleId}`;
  if (client[key]) return;
  client[key] = true;

  client.once('battleEnded', (endedId) => {
    if (String(endedId) !== String(battleId)) return;
    delete client[key];

    for (const [mapKey, col] of battleCollectors.entries()) {
      if (mapKey.startsWith(`${battleId}_`)) {
        col.stop('battleEnd');
        battleCollectors.delete(mapKey);
      }
    }
  });
}

// -------------------------------------------------
// 전투 버튼 rows
// -------------------------------------------------
function makeBattleRows(battleId, isStunned = false, escapeAvail = false, coverDefenseAvail = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_skill_${battleId}`)
      .setLabel(isStunned ? '[스턴] 스킬 사용 불가' : '스킬 사용')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isStunned),
    new ButtonBuilder()
      .setCustomId(`battle_info_${battleId}`)
      .setLabel('내 정보')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`battle_turnend_${battleId}`)
      .setLabel('턴 종료')
      .setStyle(ButtonStyle.Success)
  );

  const row2Buttons = [
    new ButtonBuilder()
      .setCustomId(`battle_surrender_${battleId}`)
      .setLabel('항복')
      .setStyle(ButtonStyle.Danger)
  ];

  if (escapeAvail) {
    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId(`battle_escape_${battleId}`)
        .setLabel('탈주')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (coverDefenseAvail) {
    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId(`battle_cover_${battleId}`)
        .setLabel('원호공격')
        .setStyle(ButtonStyle.Primary)
    );
  }

  return [row1, new ActionRowBuilder().addComponents(...row2Buttons)];
}

module.exports = { sendBattleStart, sendBattleMessage, makeBattleRows };