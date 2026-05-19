const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { token, clientId, guildId } = require('./config.json');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath);

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  commands.push(command.data);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('명령어 등록 중...');

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId), // 테스트용
      { body: commands }
    );

    console.log('등록 완료');
  } catch (error) {
    console.error(error);
  }
})();