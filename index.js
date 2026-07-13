require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { DISCORD_TOKEN: token } = process.env;
const pool = require('./db');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// 명령어 저장소
client.commands = new Collection();

// commands 폴더 자동 로딩
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

// 봇 준비
client.once('ready', async () => {
  console.log(`✅ 로그인됨: ${client.user.tag}`);

  // 재시작 시 중단된 배틀 자동 취소
  try {
    const [stuck] = await pool.query(
      `SELECT * FROM battles WHERE status IN ('battle', 'selecting')`
    );
    if (stuck.length > 0) {
      console.log(`[재시작] 중단된 배틀 ${stuck.length}개 취소 처리`);
      for (const b of stuck) {
        await pool.query(`UPDATE battles SET status = 'cancelled' WHERE id = ?`, [b.id]);
        for (const uid of [b.player1_id, b.player2_id]) {
          if (!uid) continue;
          try {
            const user = await client.users.fetch(uid);
            await user.send({
              embeds: [new EmbedBuilder()
                .setTitle('전투 중단')
                .setDescription('봇이 재시작되어 진행 중이던 전투가 취소되었습니다.\n다시 매칭을 진행해주세요.')
                .setColor(0xff9900)
                .setTimestamp()
              ]
            });
          } catch (e) {}
        }
      }
      // 매칭 대기열도 정리
      await pool.query(`DELETE FROM match_queue`);
    }
  } catch (e) {
    console.error('[재시작 정리 오류]', e);
  }
});

// 슬래시 명령어 실행
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ 실행 중 오류 발생', ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ 실행 중 오류 발생', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(token);

process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
});