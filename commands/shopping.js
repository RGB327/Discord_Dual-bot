// commands/shop.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');

const pool = require('../db');
const { CARD_TRAITS } = require('../battle/battleTraits');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('상점')
    .setDescription('카드 상점을 확인합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      const [[user]] = await pool.query(
        `SELECT * FROM users WHERE user_id = ?`, [userId]
      );
      if (!user) {
        return interaction.reply({ content: '먼저 /등록 을 해주세요.', ephemeral: true });
      }

      let userCost = user.cost;

      // 상점 목록 + 보유 여부 한 번에 조회
      const [shopRows] = await pool.query(`
        SELECT
          cs.id, cs.price,
          c.id AS card_id, c.name, c.rarity, c.attack, c.hp, c.comment,
          EXISTS(
            SELECT 1 FROM user_cards uc
            WHERE uc.user_id = ? AND uc.card_id = c.id
          ) AS already_owned
        FROM card_shop cs
        JOIN cards c ON cs.card_id = c.id
        ORDER BY cs.price DESC
      `, [userId]);

      if (shopRows.length === 0) {
        return interaction.reply({ content: '상점에 상품이 없습니다.', ephemeral: true });
      }

      let selectedIndex = null;

      // -------------------------------------------------
      // 목록 임베드
      // -------------------------------------------------
      const makeListEmbed = () => {
        const lines = shopRows.map((item, idx) => {
          const owned = item.already_owned ? ' ~~(보유 중)~~' : '';
          const affordable = userCost >= item.price ? '' : ' ❌';
          return `${idx + 1}. **${item.name}** [${item.rarity}]  ${item.price}코스트${owned}${affordable}`;
        });

        return new EmbedBuilder()
          .setTitle('카드 상점')
          .setDescription(
            `현재 잔액: **${userCost}**\n\n` +
            lines.join('\n')
          )
          .setColor(0x5865F2)
          .setTimestamp();
      };

      // -------------------------------------------------
      // 상세 임베드
      // -------------------------------------------------
      const makeDetailEmbed = (item) => {
        const canBuy    = userCost >= item.price && !item.already_owned;
        const owned     = item.already_owned;

        const cardTrait     = CARD_TRAITS[item.card_id];
        const cardTraitText = cardTrait ? `\n\n카드 특성\n${cardTrait.description}` : '';

        return new EmbedBuilder()
          .setTitle(`${item.name}  [${item.rarity}]`)
          .setDescription(
            `ATK: **${item.attack}**  HP: **${item.hp}**\n` +
            `가격: **${item.price}** 코스트\n\n` +
            `${item.comment || '설명 없음'}` +
            cardTraitText +
            `\n\n현재 잔액: **${userCost}**\n` +
            (owned ? '~~이미 보유 중~~' : canBuy ? '구매 가능' : '코스트 부족')
          )
          .setColor(owned ? 0x7f8c8d : canBuy ? 0x2ecc71 : 0xe74c3c)
          .setTimestamp();
      };

      // -------------------------------------------------
      // Select Menu
      // -------------------------------------------------
      const makeSelectMenu = () => new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('shop_card_select')
          .setPlaceholder('카드를 선택하세요')
          .addOptions(shopRows.map((item, idx) => ({
            label: item.name,
            description: `[${item.rarity}] ${item.price}코스트${item.already_owned ? ' (보유 중)' : ''}`,
            value: String(idx)
          })))
      );

      // -------------------------------------------------
      // 구매 버튼
      // -------------------------------------------------
      const makeButtons = (item = null) => {
        const canBuy = item && userCost >= item.price && !item.already_owned;
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('shop_card_buy')
            .setLabel(item?.already_owned ? '이미 보유 중' : '구매')
            .setStyle(canBuy ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(!canBuy)
        );
      };

      const message = await interaction.reply({
        embeds: [makeListEmbed()],
        components: [makeSelectMenu(), makeButtons()],
        fetchReply: true,
        ephemeral: true
      });

      const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 300_000
      });

      collector.on('collect', async (i) => {
        const id = i.customId;

        // 카드 선택
        if (id === 'shop_card_select') {
          selectedIndex = parseInt(i.values[0]);
          const item = shopRows[selectedIndex];
          return i.update({
            embeds: [makeDetailEmbed(item)],
            components: [makeSelectMenu(), makeButtons(item)]
          });
        }

        // 구매
        if (id === 'shop_card_buy') {
          if (selectedIndex === null) return;
          const item = shopRows[selectedIndex];

          await i.deferUpdate();

          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();

            // 최신 cost + 보유 여부 재확인
            const [[freshUser]] = await connection.query(
              `SELECT cost FROM users WHERE user_id = ? FOR UPDATE`, [userId]
            );
            const [[owned]] = await connection.query(
              `SELECT 1 FROM user_cards WHERE user_id = ? AND card_id = ?`,
              [userId, item.card_id]
            );

            if (owned) {
              await connection.rollback();
              connection.release();
              shopRows[selectedIndex].already_owned = 1;
              return interaction.editReply({
                embeds: [makeDetailEmbed(item)],
                components: [makeSelectMenu(), makeButtons(item)]
              });
            }

            if (freshUser.cost < item.price) {
              await connection.rollback();
              connection.release();
              return interaction.editReply({
                content: '잔액이 부족합니다.',
                embeds: [makeDetailEmbed(item)],
                components: [makeSelectMenu(), makeButtons(item)]
              });
            }

            await connection.query(
              `UPDATE users SET cost = cost - ? WHERE user_id = ?`,
              [item.price, userId]
            );
            await connection.query(
              `INSERT INTO user_cards (user_id, card_id, level) VALUES (?, ?, 1)`,
              [userId, item.card_id]
            );

            await connection.commit();
            connection.release();

            // 로컬 상태 갱신
            userCost -= item.price;
            shopRows[selectedIndex].already_owned = 1;

            return interaction.editReply({
              content: `**${item.name}** 구매 완료!`,
              embeds: [makeDetailEmbed(shopRows[selectedIndex])],
              components: [makeSelectMenu(), makeButtons(shopRows[selectedIndex])]
            });

          } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('[shop] 구매 오류:', err);
            return interaction.editReply({ content: '구매 중 오류가 발생했습니다.' });
          }
        }
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });

    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '상점 조회 중 오류가 발생했습니다.', ephemeral: true });
    }
  }
};