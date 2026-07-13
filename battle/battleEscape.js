// battle/battleEscape.js
// 망구스 탈주 시스템

const pool = require('../db');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');

// -------------------------------------------------
// 탈주 가능 여부 확인
// 망구스(id:2) 카드 사용 중 + user_cards에서 망구스 제외 다른 카드 보유
// -------------------------------------------------
async function canEscape(battleId, userId) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const myCardId   = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;

  // 망구스 카드(id:2)를 사용 중인지 확인
  if (myCardId !== 2) return false;

  // 망구스 제외 다른 보유 카드 확인
  const [otherCards] = await pool.query(`
    SELECT card_id FROM user_cards
    WHERE user_id = ? AND card_id != 2
  `, [userId]);

  return otherCards.length > 0;
}

// -------------------------------------------------
// 탈주 선택 UI 전송
// -------------------------------------------------
async function sendEscapeSelect(i, battleId, client) {
  const userId = i.user.id;

  // 망구스 제외 보유 카드 조회
  const [cards] = await pool.query(`
    SELECT c.id, c.name, c.rarity, c.attack, c.hp, c.comment
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ? AND uc.card_id != 2
    ORDER BY c.rarity DESC, c.name ASC
  `, [userId]);

  if (cards.length === 0) {
    return i.reply({ content: '변경할 수 있는 카드가 없습니다.', ephemeral: true });
  }

  let selectedIndex = null;

  const makeListEmbed = () => new EmbedBuilder()
    .setTitle('탈주 - 카드 변경')
    .setDescription(
      '이번 턴 행동을 마치고 다음 턴에 카드를 변경합니다.\n' +
      '변경 후 모든 디버프가 해제됩니다.\n\n' +
      '주의: 이번 턴 사망 시 사망 판정입니다.\n\n' +
      cards.map((c, idx) =>
        `${idx + 1}. **${c.name}** [${c.rarity}]  ATK ${c.attack} / HP ${c.hp}`
      ).join('\n')
    )
    .setColor(0xe67e22)
    .setTimestamp();

  const makeDetailEmbed = (c) => new EmbedBuilder()
    .setTitle(`${c.name}  [${c.rarity}]`)
    .setDescription(
      `ATK: **${c.attack}**  HP: **${c.hp}**\n\n` +
      `${c.comment || '설명 없음'}`
    )
    .setColor(0xe67e22)
    .setTimestamp();

  const makeSelectMenu = () => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`escape_select_${battleId}`)
      .setPlaceholder('변경할 카드를 선택하세요')
      .addOptions(cards.map((c, idx) => ({
        label: c.name,
        description: `[${c.rarity}] ATK ${c.attack} / HP ${c.hp}`,
        value: String(idx)
      })))
  );

  const makeButtons = (canConfirm = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`escape_confirm_${battleId}`)
      .setLabel('탈주 확정')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(`escape_cancel_${battleId}`)
      .setLabel('취소')
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await i.reply({
    embeds: [makeListEmbed()],
    components: [makeSelectMenu(), makeButtons(false)],
    fetchReply: true
  });

  const collector = msg.createMessageComponentCollector({
    filter: (btn) => btn.user.id === userId,
    time: 60_000
  });

  collector.on('collect', async (btn) => {
    try {
      const id = btn.customId;

      if (id === `escape_select_${battleId}`) {
        selectedIndex = parseInt(btn.values[0]);
        return await btn.update({
          embeds: [makeDetailEmbed(cards[selectedIndex])],
          components: [makeSelectMenu(), makeButtons(true)]
        });
      }

      if (id === `escape_cancel_${battleId}`) {
        collector.stop('cancelled');
        return await btn.update({ content: '탈주가 취소되었습니다.', embeds: [], components: [] });
      }

      if (id === `escape_confirm_${battleId}`) {
        if (selectedIndex === null) return;
        collector.stop('confirmed');

        const card = cards[selectedIndex];

        // 탈주 플래그 + 변경할 카드 id 저장
        const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
        const escapeCol  = battle.player1_id === userId ? 'p1_escape' : 'p2_escape';
        const escapeCardCol = battle.player1_id === userId ? 'p1_escape_card_id' : 'p2_escape_card_id';

        await pool.query(
          `UPDATE battles SET ${escapeCol} = 1, ${escapeCardCol} = ? WHERE id = ?`,
          [card.id, battleId]
        );

        return await btn.update({
          embeds: [
            new EmbedBuilder()
              .setTitle('탈주 확정!')
              .setDescription(
                `이번 턴 종료 후 **${card.name}**으로 변경됩니다.\n` +
                `모든 디버프가 해제됩니다.\n\n` +
                `턴 종료 버튼을 눌러주세요.`
              )
              .setColor(0xe67e22)
          ],
          components: []
        });
      }
    } catch (err) {
      console.error('[battleEscape collect] 오류:', err);
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'confirmed' || reason === 'cancelled') return;
    await msg.edit({
      content: '탈주 선택 시간이 초과되었습니다.',
      embeds: [],
      components: []
    }).catch(() => {});
  });
}

// -------------------------------------------------
// 탈주 처리 — processTurn에서 턴 결과 후 호출
// -------------------------------------------------
async function processEscape(battleId, client) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const escaped = [];

  for (const uid of [battle.player1_id, battle.player2_id]) {
    const isP1       = battle.player1_id === uid;
    const escapeFlag = isP1 ? battle.p1_escape : battle.p2_escape;
    const newCardId  = isP1 ? battle.p1_escape_card_id : battle.p2_escape_card_id;

    if (!escapeFlag || !newCardId) continue;

    // 카드 변경
    const cardCol = isP1 ? 'player1_card_id' : 'player2_card_id';
    await pool.query(`UPDATE battles SET ${cardCol} = ? WHERE id = ?`, [newCardId, battleId]);

    // battle_cards 업데이트 (새 카드 hp로 초기화)
    const [[newCard]] = await pool.query(`SELECT * FROM cards WHERE id = ?`, [newCardId]);
    await pool.query(`
      UPDATE battle_cards SET card_id = ?, current_hp = ?
      WHERE battle_id = ? AND user_id = ?
    `, [newCardId, newCard.hp, battleId, uid]);

    // 디버프 초기화
    const debuffCols = isP1
      ? 'p1_stunned = 0, p1_max_roll_debuff = 0, p1_dmg_reduce = 0, p1_atk_buff = 0, p1_escape = 0, p1_escape_card_id = NULL'
      : 'p2_stunned = 0, p2_max_roll_debuff = 0, p2_dmg_reduce = 0, p2_atk_buff = 0, p2_escape = 0, p2_escape_card_id = NULL';
    await pool.query(`UPDATE battles SET ${debuffCols} WHERE id = ?`, [battleId]);

    // 원호 스킬 초기화 후 크류로 변경 시 재지급
    await pool.query(
      `DELETE FROM battle_skills WHERE battle_id = ? AND user_id = ? AND is_support = 1`,
      [battleId, uid]
    );
    if (newCardId === 5) {
      const { assignSupportSkills } = require('./cardSelect');
      await assignSupportSkills(battleId, uid);
    }

    // 상대방 id
    const oppId = battle.player1_id === uid ? battle.player2_id : battle.player1_id;
    escaped.push({ uid, newCard, oppId });
  }

  // 상대방에게 카드 변경 알림
  for (const { uid, newCard, oppId } of escaped) {
    try {
      const opp = await client.users.fetch(oppId);
      await opp.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('상대방 카드 변경!')
            .setDescription(
              `상대방이 탈주 특성을 사용해 카드를 변경했습니다.\n\n` +
              `새 카드: **${newCard.name}** [${newCard.rarity}]\n` +
              `ATK: ${newCard.attack}  HP: ${newCard.hp}`
            )
            .setColor(0xe67e22)
            .setTimestamp()
        ]
      });
    } catch (e) { console.error('[processEscape] 상대 알림 실패:', e); }
  }

  return escaped; // 탈주한 유저 목록
}

module.exports = { canEscape, sendEscapeSelect, processEscape };