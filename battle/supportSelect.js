// battle/supportSelect.js

const pool = require('../db');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');

async function sendSupportSelect(interaction, battleId) {
  const userId = interaction.user.id;

  await interaction.deferReply();

  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const supportUsedCol = battle.player1_id === userId ? 'p1_support_used' : 'p2_support_used';
  const supportUsed    = battle.player1_id === userId ? battle.p1_support_used : battle.p2_support_used;

  if (supportUsed) {
    return interaction.editReply({ content: '이번 주기에 이미 원호공격을 사용했습니다. 다음 상점 이후에 다시 사용 가능합니다.' });
  }

  const SUPPORT_TRAITS = {
    '크류의 뜻대로 - 봉': '적중 시 상대 다음 턴 기절'
  };

  const [skills] = await pool.query(`
    SELECT bs.id AS bs_id, bs.turn_selected,
           s.id AS skill_id, s.name, s.attack AS coefficient,
           c.name AS card_name, c.attack AS card_attack
    FROM battle_skills bs
    JOIN skill s ON bs.skill_id = s.id
    JOIN cards c ON c.id = bs.skill_slot
    WHERE bs.battle_id = ? AND bs.user_id = ? AND bs.is_support = 1
  `, [battleId, userId]);

  if (skills.length === 0) {
    return interaction.editReply({ content: '원호공격 스킬이 없습니다.' });
  }

  let selectedIndex = null;

  const calcDmg = (s) => Math.floor(s.card_attack * parseFloat(s.coefficient));

  const makeListEmbed = () => {
    const lines = skills.map((s, idx) => {
      const selected = s.turn_selected === 1 ? ' (선택됨)' : '';
      return `${idx + 1}. **${s.name}**  원호: ${s.card_name} / 데미지 ${calcDmg(s)}${selected}`;
    });
    return new EmbedBuilder()
      .setTitle('원호공격 스킬 선택')
      .setDescription('보유한 원호공격 스킬 목록입니다.\n\n' + lines.join('\n'))
      .setColor(0xe67e22)
      .setTimestamp();
  };

  const makeDetailEmbed = (s) => {
    const trait     = SUPPORT_TRAITS[s.name];
    const traitText = trait ? `\n스킬 특성: **${trait}**` : '';
    return new EmbedBuilder()
      .setTitle(s.name)
      .setDescription(
        `${s.turn_selected === 1 ? '[이번 턴 선택됨]\n\n' : ''}` +
        `원호 카드: **${s.card_name}**\n` +
        `데미지: **${calcDmg(s)}** (계수 ${parseFloat(s.coefficient).toFixed(1)}x)` +
        traitText
      )
      .setColor(s.turn_selected === 1 ? 0x00cc66 : 0xe67e22)
      .setTimestamp();
  };

  const makeSelectMenu = () => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`sup_select_${battleId}`)
      .setPlaceholder('원호공격 스킬을 선택하세요')
      .addOptions(skills.map((s, idx) => ({
        label: s.name,
        description: `원호: ${s.card_name} / 데미지 ${calcDmg(s)}`,
        value: String(idx)
      })))
  );

  const makeButtons = (canUse = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sup_use_${battleId}`)
      .setLabel('원호공격 사용')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canUse),
    new ButtonBuilder()
      .setCustomId(`sup_back_${battleId}`)
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await interaction.editReply({
    embeds: [makeListEmbed()],
    components: [makeSelectMenu(), makeButtons(false)]
  });

  const safeUpdate = async (i, data) => {
    try {
      await i.update(data);
    } catch (e) {
      if (e.code !== 10062) throw e;
      await msg.edit(data).catch(() => {});
    }
  };

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId,
    time: 120_000
  });

  collector.on('collect', async (i) => {
    const id = i.customId;

    if (id === `sup_select_${battleId}`) {
      selectedIndex = parseInt(i.values[0]);
      await safeUpdate(i, {
        embeds: [makeDetailEmbed(skills[selectedIndex])],
        components: [makeSelectMenu(), makeButtons(true)]
      });
      return;
    }

    if (id === `sup_back_${battleId}`) {
      collector.stop('back');
      await safeUpdate(i, { content: '전투로 돌아갑니다.', embeds: [], components: [] });
      return;
    }

    if (id === `sup_use_${battleId}`) {
      if (selectedIndex === null) return;
      const skill = skills[selectedIndex];

      await pool.query(
        `UPDATE battle_skills SET turn_selected = 0 WHERE battle_id = ? AND user_id = ? AND is_support = 1`,
        [battleId, userId]
      );
      await pool.query(
        `UPDATE battle_skills SET turn_selected = 1 WHERE id = ?`,
        [skill.bs_id]
      );
      await pool.query(
        `UPDATE battles SET ${supportUsedCol} = 1 WHERE id = ?`,
        [battleId]
      );

      for (const s of skills) s.turn_selected = 0;
      skill.turn_selected = 1;

      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle('원호공격 선택 완료')
            .setDescription(
              `**${skill.name}** 선택됨\n\n` +
              `원호 카드: ${skill.card_name}\n` +
              `데미지: ${skill.card_attack}\n\n` +
              `턴 종료 버튼을 눌러주세요.`
            )
            .setColor(0x00cc66)
        ],
        components: []
      });

      collector.stop('used');
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'used' || reason === 'back') return;
    await msg.edit({
      content: '원호공격 선택 시간이 초과되었습니다.\n이전 전투 콘솔에서 턴 종료를 눌러주세요.',
      embeds: [],
      components: []
    }).catch(() => {});
  });
}

module.exports = { sendSupportSelect };
