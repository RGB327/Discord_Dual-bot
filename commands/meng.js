const { EmbedBuilder } = require('discord.js');

function random(min, max)
{
	return Math.floor(Math.random() * (max - min + 1) + min);
}

const mlist1 = [
    "알맹이는" , "알맹이가" , "알맹이도"
]

const mlist2 = [
    "세상에서" , "알맹이고" , "알맹이 같지만" , "머저리 같이" 
]

const mlist3 = [
    "버러지다." , "알맹이다." , "~~자살하자.~~" , "알맹스럽다."
]

module.exports = {
  data: {
    name: '알맹이',
    description: '알맹이에 관한 정보를 호출'
  },

  async execute(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('알맹이')
        .setDescription(mlist1[random(0 , mlist1.length-1)]+" "+mlist2[random(0,mlist2.length-1)]+" "+mlist3[random(0,mlist3.length-1)])
        .setColor(0x00ff00)
        .setFooter({ text: '알맹아..' });

    await interaction.reply({ embeds: [embed] });
  }
};