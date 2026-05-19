// commands/spectate.js

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const pool = require('../db');
const { battleSpectators, pendingSpectators } = require('../battle/spectatorStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('관전')
    .setDescription('진행 중인 전투를 관전합니다'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // 진행 중 전투 확인
    const [ongoing] = await pool.query(`
      SELECT id FROM battles
      WHERE (player1_id = ? OR player2_id = ?) AND status NOT IN ('ended', 'cancelled')
    `, [userId, userId]);
    if (ongoing.length > 0) {
      return interaction.reply({ content: '진행 중인 전투가 있어 관전할 수 없습니다.', ephemeral: true });
    }

    // 매칭 대기 확인
    const [[inQueue]] = await pool.query(`SELECT user_id FROM match_queue WHERE user_id = ?`, [userId]);
    if (inQueue) {
      return interaction.reply({ content: '매칭 대기 중에는 관전할 수 없습니다.', ephemeral: true });
    }

    // 이미 관전 중 확인 (대기 포함)
    const alreadySpectating =
      [...battleSpectators.values()].some(s => s.has(userId)) ||
      [...pendingSpectators.values()].some(s => s.has(userId));
    if (alreadySpectating) {
      return interaction.reply({ content: '이미 관전 중이거나 관전 대기 중입니다. /관전취소 후 다시 시도하세요.', ephemeral: true });
    }

    // 진행 중인 전투 목록
    const [battles] = await pool.query(`
      SELECT b.id, u1.username AS p1_name, u2.username AS p2_name, b.turn_number
      FROM battles b
      JOIN users u1 ON b.player1_id = u1.user_id
      JOIN users u2 ON b.player2_id = u2.user_id
      WHERE b.status = 'battle'
    `);

    if (battles.length === 0) {
      return interaction.reply({ content: '현재 진행 중인 전투가 없습니다.', ephemeral: true });
    }

    const addSpectator = (battleId) => {
      const key = String(battleId);
      if (!battleSpectators.has(key)) battleSpectators.set(key, new Set());
      battleSpectators.get(key).add(userId);
    };

    // 전투가 1개면 바로 등록
    if (battles.length === 1) {
      const b = battles[0];
      addSpectator(b.id);
      return interaction.reply({
        content: `**${b.p1_name}** vs **${b.p2_name}** (턴 ${b.turn_number}) 관전 시작!\n턴 결과가 DM으로 전송됩니다.`,
        ephemeral: true
      });
    }

    // 여러 전투면 선택 메뉴
    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('spectate_select')
        .setPlaceholder('관전할 전투를 선택하세요')
        .addOptions(battles.map(b => ({
          label: `${b.p1_name} vs ${b.p2_name}`,
          description: `전투 #${b.id} · 턴 ${b.turn_number}`,
          value: String(b.id)
        })))
    );

    const msg = await interaction.reply({
      content: '관전할 전투를 선택하세요.',
      components: [select],
      ephemeral: true,
      fetchReply: true
    });

    const collector = msg.createMessageComponentCollector({ time: 30_000, max: 1 });

    collector.on('collect', async (i) => {
      const battleId = i.values[0];
      addSpectator(battleId);
      const b = battles.find(b => String(b.id) === battleId);
      await i.update({
        content: `**${b.p1_name}** vs **${b.p2_name}** (턴 ${b.turn_number}) 관전 시작!\n턴 결과가 DM으로 전송됩니다.`,
        components: []
      });
    });

    collector.on('end', async (collected) => {
      if (collected.size > 0) return;
      await interaction.editReply({ content: '시간이 초과되었습니다.', components: [] }).catch(() => {});
    });
  }
};
