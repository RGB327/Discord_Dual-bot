// battle/battleShop.js


const pool = require('../db');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');
const { SKILL_TRAITS, CARD_TRAITS } = require('./battleTraits');

// -------------------------------------------------
// 확률 테이블 - 총 5개 슬롯
// 1스킬 20% / 2스킬 40% / 3스킬 30% / 스페셜 10%
// -------------------------------------------------
function pickSlotType() {
  const r = Math.random() * 100;
  if (r < 20) return 'skill1';
  if (r < 60) return 'skill2';
  if (r < 90) return 'skill3';
  return 'special';
}

async function generateShopItems(battleId, userId, cardId, turn) {
  await pool.query(
    `DELETE FROM battle_shop WHERE battle_id = ? AND user_id = ?`,
    [battleId, userId]
  );

  const slots = Array.from({ length: 5 }, () => pickSlotType());
  const count = { skill1: 0, skill2: 0, skill3: 0, special: 0 };
  for (const s of slots) count[s]++;

  // 슬롯 하나씩 독립적으로 뽑기 (중복 허용, 확률 구조 유지)
  const fetchOneSkill = async (skillType) => {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.skill, s.attack, s.min, s.max,
             COALESCE(bsp.price, 100) AS price, 0 AS is_special
      FROM skill s
      LEFT JOIN card_skill cs ON s.id = cs.skill_id
      LEFT JOIN battle_shop_price bsp ON bsp.item_type = 'skill' AND bsp.item_id = s.id
      WHERE (cs.card_id = ? OR s.is_common = 1)
        AND s.skill = ? AND s.is_special = 0
      GROUP BY s.id
      ORDER BY RAND()
      LIMIT 1
    `, [cardId, skillType]);
    return rows[0] ?? null;
  };

  const fetchOneSpecial = async () => {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.skill, s.attack, s.min, s.max,
             COALESCE(bsp.price, 100) AS price, 1 AS is_special
      FROM skill s
      LEFT JOIN battle_shop_price bsp ON bsp.item_type = 'skill' AND bsp.item_id = s.id
      WHERE s.is_special = 1
      ORDER BY RAND()
      LIMIT 1
    `);
    return rows[0] ?? null;
  };

  const allItemsRaw = [];
  for (const slotType of slots) {
    const typeNum = slotType === 'special' ? null : parseInt(slotType.replace('skill', ''));
    const skill   = slotType === 'special' ? await fetchOneSpecial() : await fetchOneSkill(typeNum);
    if (skill) allItemsRaw.push(skill);
  }

  // 1스킬 → 2스킬 → 3스킬 → 스페셜 순 정렬
  const allItems = allItemsRaw.sort((a, b) => {
    if (a.is_special !== b.is_special) return a.is_special - b.is_special;
    return a.skill - b.skill;
  });
  const items = [];

  for (let idx = 0; idx < allItems.length; idx++) {
    const s = allItems[idx];
    items.push({
      item_id:    s.id,
      price:      s.price,
      name:       s.name,
      attack:     s.attack,
      min:        s.min,
      max:        s.max,
      skill_type: s.skill,
      is_special: s.is_special,
      is_sold:    0
    });

    await pool.query(`
      INSERT INTO battle_shop (battle_id, user_id, item_type, item_id, price, turn)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [battleId, userId, 'skill', s.id, s.price, turn]);

    const [[inserted]] = await pool.query(
      `SELECT id AS shop_id FROM battle_shop
       WHERE battle_id = ? AND user_id = ? AND item_id = ? AND turn = ?
       ORDER BY id DESC LIMIT 1`,
      [battleId, userId, s.id, turn]
    );
    items[idx].shop_id = inserted.shop_id;
  }

  return items;
}

// -------------------------------------------------
// 상점 UI 전송
// -------------------------------------------------
async function sendBattleShop(client, battleId, userId, turn, result) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const myCardId   = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;
  let   myCost     = battle.player1_id === userId ? battle.battle_cost_p1  : battle.battle_cost_p2;

  const items = await generateShopItems(battleId, userId, myCardId, turn);

  if (items.length === 0) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ content: '이번 상점에는 구매 가능한 아이템이 없습니다.' });
    } catch (e) {}
    const { onShopClosed } = require('./battleHandler');
    await onShopClosed(battleId, userId, turn, result, client);
    return;
  }

  let selectedIndex = null;

  const makeListEmbed = () => {
    const lines = items.map((item, idx) => {
      const typeLabel = item.is_special ? '[스페셜]' : `[${item.skill_type}스킬]`;
      const soldMark  = item.is_sold ? ' (판매완료)' : '';
      return `${idx + 1}. **${item.name}** ${typeLabel} - ${item.price}코스트${soldMark}`;
    });

    return new EmbedBuilder()
      .setTitle('전투 상점')
      .setDescription(`현재 전투 코스트: **${myCost}**\n\n` + lines.join('\n') + '\n\n아래 메뉴에서 아이템을 선택하세요.')
      .setColor(0x3498db)
      .setTimestamp();
  };

  const makeDetailEmbed = (item) => {
    const canBuy      = myCost >= item.price && !item.is_sold;
    const typeLabel   = item.is_special ? '스페셜 스킬' : `${item.skill_type}스킬`;
    const skillTrait  = SKILL_TRAITS[item.item_id];
    const skillTraitText = skillTrait ? `\n\n스킬 특성\n${skillTrait.description}` : '';
    const cardTrait   = CARD_TRAITS[myCardId];
    const cardTraitText  = cardTrait ? `\n\n카드 특성\n${cardTrait.description}` : '';

    return new EmbedBuilder()
      .setTitle(`${item.name}  [${typeLabel}]`)
      .setDescription(
        `배율: **${parseFloat(item.attack).toFixed(1)}x**\n` +
        `주사위 범위: **${item.min} ~ ${item.max}**\n` +
        `가격: **${item.price}** 코스트` +
        skillTraitText +
        cardTraitText +
        `\n\n현재 전투 코스트: **${myCost}**\n` +
        (item.is_sold ? '판매 완료' : canBuy ? '구매 가능' : '코스트 부족')
      )
      .setColor(item.is_sold ? 0x7f8c8d : canBuy ? 0x2ecc71 : 0xe74c3c)
      .setTimestamp();
  };

  const makeSelectMenu = () => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`shop_select_${battleId}`)
      .setPlaceholder('아이템을 선택하세요')
      .addOptions(items.map((item, idx) => ({
        label: item.name,
        description: `[${item.is_special ? '스페셜' : `${item.skill_type}스킬`}] ${item.price}코스트${item.is_sold ? ' (판매완료)' : ''}`,
        value: String(idx)
      })))
  );

  const makeButtons = (item = null) => {
    const canBuy = item && myCost >= item.price && !item.is_sold;
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_buy_${battleId}`)
        .setLabel('구매')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canBuy),
      new ButtonBuilder()
        .setCustomId(`shop_close_${battleId}`)
        .setLabel('닫기')
        .setStyle(ButtonStyle.Danger)
    );
  };

  const closeShop = async (interaction, method) => {
    const closeEmbed = new EmbedBuilder()
      .setTitle('상점 종료')
      .setDescription('상점을 닫았습니다.')
      .setColor(0x7f8c8d);

    if (method === 'update') {
      await interaction.update({ embeds: [closeEmbed], components: [] }).catch(() => {});
    } else {
      await interaction.edit({ embeds: [closeEmbed], components: [] }).catch(() => {});
    }

    const { onShopClosed } = require('./battleHandler');
    await onShopClosed(battleId, userId, turn, result, client);
  };

  try {
    const user = await client.users.fetch(userId);
    const msg  = await user.send({
      embeds: [makeListEmbed()],
      components: [makeSelectMenu(), makeButtons()]
    });

    const collector = msg.createMessageComponentCollector({
      filter: (i) => i.user.id === userId,
      time: 180_000
    });

    collector.on('collect', async (i) => {
      const id = i.customId;

      if (id === `shop_select_${battleId}`) {
        selectedIndex = parseInt(i.values[0]);
        return i.update({
          embeds: [makeDetailEmbed(items[selectedIndex])],
          components: [makeSelectMenu(), makeButtons(items[selectedIndex])]
        }).catch(() => {});
      }

      if (id === `shop_buy_${battleId}`) {
        if (selectedIndex === null) {
          return i.reply({ content: '아이템을 먼저 선택해주세요.', ephemeral: true });
        }

        const item = items[selectedIndex];

        const [[freshBattle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
        const freshCost = freshBattle.player1_id === userId
          ? freshBattle.battle_cost_p1
          : freshBattle.battle_cost_p2;

        if (freshCost < item.price) {
          return i.reply({ content: '코스트가 부족합니다.', ephemeral: true });
        }

        const costCol = freshBattle.player1_id === userId ? 'battle_cost_p1' : 'battle_cost_p2';
        await pool.query(
          `UPDATE battles SET ${costCol} = ${costCol} - ? WHERE id = ?`,
          [item.price, battleId]
        );
        myCost -= item.price;

        // skill 테이블 단일 구조 — is_special 값 그대로 사용
        await pool.query(`
          INSERT INTO battle_skills (battle_id, user_id, skill_id, skill_slot, is_special)
          VALUES (?, ?, ?, ?, ?)
        `, [battleId, userId, item.item_id, item.skill_type ?? 0, item.is_special]);

        items[selectedIndex].is_sold = 1;
        await pool.query(`UPDATE battle_shop SET is_sold = 1 WHERE id = ?`, [item.shop_id]);

        return i.update({
          embeds: [makeDetailEmbed(items[selectedIndex])],
          components: [makeSelectMenu(), makeButtons(null)]
        }).catch(() => {});
      }

      if (id === `shop_close_${battleId}`) {
        collector.stop('closed');
        await closeShop(i, 'update');
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'closed') return;
      await closeShop(msg, 'edit');
    });

  } catch (err) {
    console.error('[battleShop] DM 전송 실패:', err);
  }
}

module.exports = { sendBattleShop };