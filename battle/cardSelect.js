// battle/cardSelect.js

const pool = require('../db');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');
const { sendBattleStart } = require('./battleStart');
const { CARD_TRAITS } = require('./battleTraits');

async function sendCardSelect(client, battleId, userId) {
  const [cards] = await pool.query(`
    SELECT c.id, c.name, c.rarity, c.attack, c.hp, c.comment, uc.level
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    ORDER BY c.rarity DESC, c.name ASC
  `, [userId]);

  if (cards.length === 0) return;

  let selectedIndex = null;

  const makeListEmbed = () => {
    const lines = cards.map((c, idx) =>
      `${idx + 1}. **${c.name}** [${c.rarity}]  ATK ${c.attack} / HP ${c.hp}`
    );
    return new EmbedBuilder()
      .setTitle('전투 카드 선택')
      .setDescription(`이번 전투에 사용할 카드를 선택하세요.\n\n` + lines.join('\n'))
      .setColor(0x5865F2)
      .setTimestamp();
  };

  const makeDetailEmbed = (c) => {
    const cardTrait     = CARD_TRAITS[c.id];
    const cardTraitText = cardTrait ? `\n\n카드 특성\n${cardTrait.description}` : '';
    return new EmbedBuilder()
      .setTitle(`${c.name}  [${c.rarity}]`)
      .setDescription(
        `ATK: **${c.attack}**  HP: **${c.hp}**  LV: **${c.level}**\n\n` +
        `${c.comment || '설명 없음'}` + cardTraitText
      )
      .setColor(0x2ecc71)
      .setTimestamp();
  };

  const makeSelectMenu = () => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`csel_select_${battleId}_${userId}`)
      .setPlaceholder('카드를 선택하세요')
      .addOptions(cards.map((c, idx) => ({
        label: c.name,
        description: `[${c.rarity}] ATK ${c.attack} / HP ${c.hp}`,
        value: String(idx)
      })))
  );

  const makeButtons = (canPick = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`csel_pick_${battleId}_${userId}`)
      .setLabel('이 카드로 출전')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canPick)
  );

  try {
    const user = await client.users.fetch(userId);
    const msg  = await user.send({
      embeds: [makeListEmbed()],
      components: [makeSelectMenu(), makeButtons(false)]
    });

    const collector = msg.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 300_000
    });

    collector.on('collect', async (i) => {
      const id = i.customId;

      if (id === `csel_select_${battleId}_${userId}`) {
        selectedIndex = parseInt(i.values[0]);
        return i.update({
          embeds: [makeDetailEmbed(cards[selectedIndex])],
          components: [makeSelectMenu(), makeButtons(true)]
        });
      }

      if (id === `csel_pick_${battleId}_${userId}`) {
        if (selectedIndex === null) return;
        collector.stop('picked');

        const card = cards[selectedIndex];

        await pool.query(`
          INSERT INTO battle_cards (battle_id, user_id, card_id, current_hp)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE card_id = VALUES(card_id), current_hp = VALUES(current_hp)
        `, [battleId, userId, card.id, card.hp]);

        const [[battle]] = await pool.query(`SELECT player1_id FROM battles WHERE id = ?`, [battleId]);
        const col = battle.player1_id === userId ? 'player1_card_id' : 'player2_card_id';
        await pool.query(`UPDATE battles SET ${col} = ? WHERE id = ?`, [card.id, battleId]);

        await assignSkills(battleId, userId, card.id);
        if (card.id === 5) await assignSupportSkills(battleId, userId);

        const [skills] = await pool.query(`
          SELECT s.name, s.skill, s.is_special
          FROM battle_skills bs
          JOIN skill s ON bs.skill_id = s.id
          WHERE bs.battle_id = ? AND bs.user_id = ? AND bs.is_support = 0
          ORDER BY s.is_special ASC, s.skill ASC
        `, [battleId, userId]);

        const skillText = skills.map(s =>
          `[${s.is_special ? '스페셜' : `${s.skill}스킬`}] ${s.name}`
        ).join('\n') || '없음';

        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle('카드 선택 완료')
              .setDescription(`**${card.name}** [${card.rarity}]\nATK ${card.attack}  HP ${card.hp}`)
              .addFields({ name: '지급된 스킬', value: skillText })
              .setColor(0x00cc66)
              .setTimestamp()
          ],
          components: []
        });

        await checkAndStartBattle(client, battleId);
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'picked') return;
      await pool.query(`UPDATE battles SET status = 'cancelled' WHERE id = ?`, [battleId]);
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle('카드 선택 시간 초과')
            .setDescription('시간이 초과되어 전투가 취소되었습니다.')
            .setColor(0xff9900)
        ],
        components: []
      }).catch(() => {});
    });

  } catch (err) {
    console.error('[cardSelect] DM 전송 실패:', err);
    throw err;
  }
}

async function assignSkills(battleId, userId, cardId) {
  await pool.query(`DELETE FROM battle_skills WHERE battle_id = ? AND user_id = ?`, [battleId, userId]);

  const skillConfig = [
    { type: 1, limit: 1 },
    { type: 2, limit: 2 },
    { type: 3, limit: 1 }
  ];

  for (const { type, limit } of skillConfig) {
    const [rows] = await pool.query(`
      SELECT s.*
      FROM skill s
      LEFT JOIN card_skill cs ON s.id = cs.skill_id
      WHERE (cs.card_id = ? OR s.is_common = 1)
        AND s.skill = ? AND s.is_special = 0
      GROUP BY s.id
      ORDER BY RAND()
      LIMIT ?
    `, [cardId, type, limit]);

    for (const skill of rows) {
      await pool.query(`
        INSERT INTO battle_skills (battle_id, user_id, skill_id, skill_slot, is_special)
        VALUES (?, ?, ?, ?, 0)
      `, [battleId, userId, skill.id, skill.skill]);
    }
  }
}

async function assignSupportSkills(battleId, userId) {
  const SUPPORT_MAP = [
    { card_id: 1, skill_name: '크류의 뜻대로 - 봉' },
    { card_id: 2, skill_name: '크류의 뜻대로 - 망' },
    { card_id: 4, skill_name: '크류의 뜻대로 - 곤' },
  ];

  const [ownedCards] = await pool.query(
    `SELECT card_id FROM user_cards WHERE user_id = ? AND card_id IN (1, 2, 4)`,
    [userId]
  );
  const ownedSet = new Set(ownedCards.map(r => r.card_id));

  for (const { card_id, skill_name } of SUPPORT_MAP) {
    if (!ownedSet.has(card_id)) continue;
    const [[skill]] = await pool.query(`SELECT id FROM skill WHERE name = ?`, [skill_name]);
    if (!skill) continue;
    // skill_slot에 원호 카드 id 저장 (데미지 계산 시 해당 카드 공격력 참조용)
    await pool.query(`
      INSERT INTO battle_skills (battle_id, user_id, skill_id, skill_slot, is_special, is_support)
      VALUES (?, ?, ?, ?, 0, 1)
    `, [battleId, userId, skill.id, card_id]);
  }
}

async function checkAndStartBattle(client, battleId) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  if (!battle.player1_card_id || !battle.player2_card_id) return;

  const [result] = await pool.query(`
    UPDATE battles SET status = 'battle', battle_cost_p1 = 0, battle_cost_p2 = 0
    WHERE id = ? AND status = 'selecting'
  `, [battleId]);

  if (result.affectedRows === 0) return;

  await sendBattleStart(client, battleId, battle.player1_id);
  await sendBattleStart(client, battleId, battle.player2_id);
}

module.exports = { sendCardSelect, assignSupportSkills };