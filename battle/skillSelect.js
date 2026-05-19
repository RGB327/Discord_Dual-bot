// battle/skillSelect.js

const pool = require('../db');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle
} = require('discord.js');
const { CARD_TRAITS, SKILL_TRAITS, applyOnUseTraits } = require('./battleTraits');

async function sendSkillSelect(interaction, battleId) {
  const userId = interaction.user.id;

  // DB 조회 전에 먼저 응답 잡기 (3초 제한 방지)
  await interaction.deferReply();

  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const myCardId   = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;

  const [skills] = await pool.query(`
    SELECT bs.id AS bs_id, bs.turn_selected,
           s.id AS skill_id, s.name, s.skill AS skill_type,
           s.attack, s.min, s.max, s.is_special,
           CASE WHEN s.is_special = 1 THEN 'special' ELSE 'normal' END AS kind
    FROM battle_skills bs
    JOIN skill s ON bs.skill_id = s.id
    WHERE bs.battle_id = ? AND bs.user_id = ? AND bs.is_support = 0
    ORDER BY s.is_special ASC, s.skill ASC
  `, [battleId, userId]);

  if (skills.length === 0) {
    return interaction.editReply({ content: '사용 가능한 스킬이 없습니다. 스킬 없이 턴 종료하세요.' });
  }

  const cardTrait     = CARD_TRAITS[myCardId];
  const cardTraitText = cardTrait ? `\n\n카드 특성\n${cardTrait.description}` : '';

  let selectedIndex = null;

  const makeListEmbed = () => {
    const lines = skills.map((s, idx) => {
      const typeLabel = s.is_special ? '[스페셜]' : `[${s.skill_type}스킬]`;
      const selected  = s.turn_selected === 1 ? ' (선택됨)' : '';
      return `${idx + 1}. **${s.name}** ${typeLabel}  ${s.min}~${s.max} / ${parseFloat(s.attack).toFixed(1)}x${selected}`;
    });

    return new EmbedBuilder()
      .setTitle('스킬 선택')
      .setDescription('보유 스킬 목록입니다.\n\n' + lines.join('\n') + cardTraitText)
      .setColor(0x9b59b6)
      .setTimestamp();
  };

  const makeDetailEmbed = (s) => {
    const typeLabel      = s.is_special ? '스페셜 스킬' : `${s.skill_type}스킬`;
    const skillTrait     = SKILL_TRAITS[s.skill_id];
    const skillTraitText = skillTrait ? `\n\n스킬 특성\n${skillTrait.description}` : '';
    const isSelected     = s.turn_selected === 1;

    return new EmbedBuilder()
      .setTitle(`${s.name}  [${typeLabel}]`)
      .setDescription(
        `${isSelected ? '[이번 턴 선택됨]\n\n' : ''}` +
        `배율: **${parseFloat(s.attack).toFixed(1)}x**\n` +
        `주사위 범위: **${s.min} ~ ${s.max}**` +
        skillTraitText +
        cardTraitText
      )
      .setColor(isSelected ? 0x00cc66 : s.is_special ? 0xf1c40f : 0x9b59b6)
      .setTimestamp();
  };

  const makeSelectMenu = () => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`sk_select_${battleId}`)
      .setPlaceholder('스킬을 선택하세요')
      .addOptions(skills.map((s, idx) => ({
        label: s.name,
        description: `[${s.is_special ? '스페셜' : `${s.skill_type}스킬`}] ${s.min}~${s.max} / ${parseFloat(s.attack).toFixed(1)}x`,
        value: String(idx)
      })))
  );

  const makeButtons = (canUse = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sk_use_${battleId}`)
      .setLabel('이 스킬 사용')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canUse),
    new ButtonBuilder()
      .setCustomId(`sk_back_${battleId}`)
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary)
  );

  // deferReply 후 editReply로 메시지 전송
  const msg = await interaction.editReply({
    embeds: [makeListEmbed()],
    components: [makeSelectMenu(), makeButtons(false)]
  });

  const collector = msg.createMessageComponentCollector({
    filter: (i) => i.user.id === userId,
    time: 120_000
  });

  const safeUpdate = async (i, data) => {
    try {
      await i.update(data);
    } catch (e) {
      if (e.code !== 10062) throw e;
      await msg.edit(data).catch(() => {});
    }
  };

  collector.on('collect', async (i) => {
    const id = i.customId;

    // 스킬 선택
    if (id === `sk_select_${battleId}`) {
      selectedIndex = parseInt(i.values[0]);
      await safeUpdate(i, {
        embeds: [makeDetailEmbed(skills[selectedIndex])],
        components: [makeSelectMenu(), makeButtons(true)]
      });
      return;
    }

    // 뒤로가기
    if (id === `sk_back_${battleId}`) {
      collector.stop('back');
      await safeUpdate(i, { content: '전투로 돌아갑니다.', embeds: [], components: [] });
      return;
    }

    // 스킬 사용
    if (id === `sk_use_${battleId}`) {
      if (selectedIndex === null) return;
      const skill = skills[selectedIndex];


      // turn_selected 초기화 후 이번 스킬 표시
      await pool.query(
        `UPDATE battle_skills SET turn_selected = 0 WHERE battle_id = ? AND user_id = ? AND is_support = 0`,
        [battleId, userId]
      );
      await pool.query(
        `UPDATE battle_skills SET turn_selected = 1 WHERE id = ?`,
        [skill.bs_id]
      );

      for (const s of skills) s.turn_selected = 0;
      skill.turn_selected = 1;

      // onUse 효과 처리
      const [[battleForUse]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
      const onUseLog = await applyOnUseTraits({
        pool, skillId: skill.skill_id, battleId, userId, battle: battleForUse
      });

      const completeData = {
        embeds: [
          new EmbedBuilder()
            .setTitle('스킬 선택 완료')
            .setDescription(
              `**${skill.name}** 선택됨\n\n` +
              `주사위 범위: ${skill.min} ~ ${skill.max}\n` +
              `배율: ${parseFloat(skill.attack).toFixed(1)}x\n\n` +
              (onUseLog ? `${onUseLog}\n\n` : '') +
              `턴 종료 버튼을 눌러주세요.`
            )
            .setColor(0x00cc66)
        ],
        components: []
      };
      await safeUpdate(i, completeData);

      collector.stop('used');
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'used' || reason === 'back') return;
    await msg.edit({
      content: '스킬 선택 시간이 초과되었습니다.\n이전 전투 콘솔에서 턴 종료를 눌러주세요.',
      embeds: [],
      components: []
    }).catch(() => {});
  });
}

module.exports = { sendSkillSelect };