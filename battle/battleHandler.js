// battle/battleHandler.js

const pool = require('../db');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendSkillSelect } = require('./skillSelect');

async function handleBattleButton(i, battleId, client, collector) {
  const id = i.customId;
  try {
    if (id === `battle_skill_${battleId}`)     return await sendSkillSelect(i, battleId);
    if (id === `battle_info_${battleId}`)      return await handleInfo(i, battleId);
    if (id === `battle_turnend_${battleId}`)   return await handleTurnEnd(i, battleId, client);
    if (id === `battle_surrender_${battleId}`) return await handleSurrenderAsk(i, battleId, client, collector);
    if (id === `battle_escape_${battleId}`) {
      const { sendEscapeSelect } = require('./battleEscape');
      return await sendEscapeSelect(i, battleId, client);
    }
    if (id === `battle_cover_${battleId}`) {
      const { sendSupportSelect } = require('./supportSelect');
      return await sendSupportSelect(i, battleId);
    }
  } catch (err) {
    console.error('[battleHandler] 오류:', err);
    const msg = { content: '처리 중 오류가 발생했습니다.', ephemeral: true };
    if (i.replied || i.deferred) await i.followUp(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
}

// -------------------------------------------------
// 내 정보
// -------------------------------------------------
async function handleInfo(i, battleId) {
  const userId  = i.user.id;
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const myCardId   = battle.player1_id === userId ? battle.player1_card_id : battle.player2_card_id;
  const oppId      = battle.player1_id === userId ? battle.player2_id      : battle.player1_id;
  const myCost     = battle.player1_id === userId ? battle.battle_cost_p1  : battle.battle_cost_p2;

  const [[card]]  = await pool.query(`SELECT * FROM cards WHERE id = ?`, [myCardId]);
  const [[bc]]    = await pool.query(`SELECT current_hp FROM battle_cards WHERE battle_id = ? AND user_id = ?`, [battleId, userId]);
  const [[oppBc]] = await pool.query(`SELECT current_hp FROM battle_cards WHERE battle_id = ? AND user_id = ?`, [battleId, oppId]);
  const [[opp]]   = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [oppId]);

  const [skills] = await pool.query(`
    SELECT s.name, s.skill, s.is_special, bs.turn_selected
    FROM battle_skills bs
    JOIN skill s ON bs.skill_id = s.id
    WHERE bs.battle_id = ? AND bs.user_id = ?
    ORDER BY s.is_special ASC, s.skill ASC
  `, [battleId, userId]);

  const skillText = skills.length
    ? skills.map(s => {
        const label = s.is_special ? '[스페셜]' : `[${s.skill}스킬]`;
        return `${label} ${s.name}${s.turn_selected ? ' (선택됨)' : ''}`;
      }).join('\n')
    : '없음';

  const myAtkBuff = battle.player1_id === userId ? battle.p1_atk_buff : battle.p2_atk_buff;
  const rageStack = (myCardId === 1 && myAtkBuff > 0) ? Math.floor(myAtkBuff / 20) : 0;

  const fields = [
    { name: '내 카드',              value: `**${card.name}**\nHP ${bc?.current_hp ?? card.hp} / ${card.hp}`, inline: true },
    { name: `${opp.username} 체력`, value: `HP ${oppBc?.current_hp ?? '?'}`, inline: true },
    { name: '현재 턴',              value: `${battle.turn_number}`, inline: true },
    { name: '전투 코스트',           value: `${myCost}`, inline: true },
    { name: '보유 스킬',             value: skillText }
  ];
  if (rageStack > 0) {
    fields.splice(1, 0, { name: '봉구스 분노 스택', value: `${rageStack}중첩 (공격력 +${myAtkBuff}%)`, inline: true });
  }

  return i.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('전투 정보')
        .addFields(...fields)
        .setColor(0xf39c12)
        .setTimestamp()
    ],
    ephemeral: true
  });
}

// -------------------------------------------------
// 턴 종료
// -------------------------------------------------
async function handleTurnEnd(i, battleId, client) {
  const userId = i.user.id;
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);

  if (battle.status !== 'battle') {
    return i.reply({ content: '현재 전투 중이 아닙니다.', ephemeral: true });
  }

  const alreadyEnded = battle.player1_id === userId ? battle.p1_turn_ended : battle.p2_turn_ended;
  if (alreadyEnded) {
    return i.reply({ content: '이미 턴 종료하셨습니다. 상대방을 기다리는 중입니다.', ephemeral: true });
  }

  const col = battle.player1_id === userId ? 'p1_turn_ended' : 'p2_turn_ended';
  await pool.query(`UPDATE battles SET ${col} = 1 WHERE id = ?`, [battleId]);

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('턴 종료 - 상대방 대기 중')
        .setDescription('상대방이 턴을 종료하면 다음 턴이 시작됩니다.')
        .setColor(0x95a5a6)
        .setTimestamp()
    ],
    components: []
  }).catch(() => {});

  const [[updated]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  if (updated.p1_turn_ended && updated.p2_turn_ended) {
    await processTurn(battleId, client);
  }
}

// -------------------------------------------------
// 턴 처리
// -------------------------------------------------
async function cancelBattleOnError(battleId, client, err) {
  console.error('[processTurn] 전투 오류 → 강제 종료:', err);
  try {
    await pool.query(`UPDATE battles SET status = 'cancelled' WHERE id = ? AND status = 'battle'`, [battleId]);
    const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
    if (!battle) return;
    client.emit('battleEnded', String(battleId));
    for (const uid of [battle.player1_id, battle.player2_id]) {
      try {
        const user = await client.users.fetch(uid);
        await user.send({
          embeds: [new EmbedBuilder()
            .setTitle('전투 오류')
            .setDescription('전투 중 오류가 발생하여 전투가 취소되었습니다.\n다시 매칭을 진행하세요.')
            .setColor(0xff0000)
            .setTimestamp()
          ]
        });
      } catch(e) {}
    }
  } catch(e) {
    console.error('[cancelBattleOnError]', e);
  }
}

async function processTurn(battleId, client) {
  const { processBattleCalc } = require('./battleCalc');
  const { sendBattleMessage } = require('./battleStart');
  const { sendBattleShop }    = require('./battleShop');

  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const nextTurn   = battle.turn_number + 1;

  let result;
  try {
    result = await processBattleCalc(battleId);
  } catch (err) {
    await cancelBattleOnError(battleId, client, err);
    return;
  }

  // 0뎀 (둘 다 스킬 없음) — 상점 체크 포함
  if (result.isMutual) {
    const nextTurnM = battle.turn_number + 1;
    await checkAlmangyiSkip(battleId, battle, result);

    if (battle.turn_number % 3 === 0) {
      await pool.query(`
        UPDATE battles
        SET p1_turn_ended = 0, p2_turn_ended = 0,
            p1_shop_closed = 0, p2_shop_closed = 0
        WHERE id = ?
      `, [battleId]);

      for (const uid of [battle.player1_id, battle.player2_id]) {
        try {
          const user = await client.users.fetch(uid);
          const supEmbed = makeSupportResultEmbed(result, uid);
          const embeds = supEmbed
            ? [supEmbed, makeTurnResultEmbed(result, uid)]
            : [makeTurnResultEmbed(result, uid)];
          await user.send({ embeds });
        } catch (e) {}
      }

      for (const uid of [battle.player1_id, battle.player2_id]) {
        await sendBattleShop(client, battleId, uid, battle.turn_number, result);
      }
    } else {
      await pool.query(`
        UPDATE battles
        SET turn_number = ?, p1_turn_ended = 0, p2_turn_ended = 0,
            p1_shop_closed = 0, p2_shop_closed = 0
        WHERE id = ?
      `, [nextTurnM, battleId]);

      await processNextTurnEffects(battleId, client).catch(e => console.error('[processNextTurnEffects]', e));
      await notifySpectatorsNewTurn(client, battleId, nextTurnM);

      for (const uid of [battle.player1_id, battle.player2_id]) {
        await sendBattleMessage(client, battleId, uid, nextTurnM, result);
      }
    }
    return;
  }

  // 사망 -> 전투 종료
  if (result.isDead) {
    await pool.query(
      `UPDATE battles SET status = 'ended', winner_id = ? WHERE id = ?`,
      [result.winnerId, battleId]
    );
    await pool.query(
      `UPDATE users SET cost = cost + 500 WHERE user_id = ?`,
      [result.winnerId]
    );

    client.emit('battleEnded', String(battleId));

    // 종료 요약 정보 조회
    const [[p1bc]]   = await pool.query(`SELECT bc.current_hp, c.name AS card_name FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`, [battleId, battle.player1_id]);
    const [[p2bc]]   = await pool.query(`SELECT bc.current_hp, c.name AS card_name FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`, [battleId, battle.player2_id]);
    const [[p1user]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player1_id]);
    const [[p2user]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player2_id]);

    const winnerName = result.winnerId === battle.player1_id ? p1user.username : p2user.username;
    const loserName  = result.winnerId === battle.player1_id ? p2user.username : p1user.username;
    const winnerHp   = result.winnerId === battle.player1_id ? p1bc?.current_hp : p2bc?.current_hp;
    const winnerCard = result.winnerId === battle.player1_id ? p1bc?.card_name  : p2bc?.card_name;
    const loserCard  = result.winnerId === battle.player1_id ? p2bc?.card_name  : p1bc?.card_name;

    const summaryEmbed = new EmbedBuilder()
      .setTitle('전투 요약')
      .setDescription(
        `🏆 **${winnerName}** 승리  |  💀 **${loserName}** 패배\n\n` +
        `총 **${battle.turn_number}턴** 만에 종료\n\n` +
        `**${winnerName}** (${winnerCard}) 남은 체력: **${winnerHp ?? '?'}**\n` +
        `**${loserName}** (${loserCard}) 남은 체력: **0**`
      )
      .setColor(0x5865F2)
      .setTimestamp();

    for (const uid of [battle.player1_id, battle.player2_id]) {
      try {
        const user     = await client.users.fetch(uid);
        const isWinner = uid === result.winnerId;
        const supEmbed = makeSupportResultEmbed(result, uid);
        const embeds   = supEmbed
          ? [supEmbed, makeTurnResultEmbed(result, uid, true, isWinner), summaryEmbed]
          : [makeTurnResultEmbed(result, uid, true, isWinner), summaryEmbed];
        await user.send({ embeds });
      } catch (e) { console.error('[processTurn] 종료 DM 실패:', e); }
    }
    await notifySpectators(client, battleId, battle, result, true);
    return;
  }

  // 탈주 처리 — 사망 없을 때 카드 변경
  const { processEscape } = require('./battleEscape');
  await checkAlmangyiSkip(battleId, battle, result);
  let escaped = [];
  try {
    escaped = await processEscape(battleId, client);
  } catch (err) {
    await cancelBattleOnError(battleId, client, err);
    return;
  }

  if (escaped.length > 0) {
    // 탈주한 유저에게 카드 변경 알림
    for (const { uid, newCard } of escaped) {
      try {
        const user = await client.users.fetch(uid);
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('탈주 성공!')
              .setDescription(
                `**${newCard.name}**으로 카드가 변경되었습니다.\n` +
                `ATK: ${newCard.attack}  HP: ${newCard.hp}\n\n` +
                `모든 디버프가 해제되었습니다.`
              )
              .setColor(0xe67e22)
              .setTimestamp()
          ]
        });
      } catch (e) {}
    }
  }

  // 3의 배수 턴 -> 결과 DM + 상점
  if (battle.turn_number % 3 === 0) {
    await pool.query(`
      UPDATE battles
      SET p1_turn_ended = 0, p2_turn_ended = 0,
          p1_shop_closed = 0, p2_shop_closed = 0
      WHERE id = ?
    `, [battleId]);

    for (const uid of [battle.player1_id, battle.player2_id]) {
      try {
        const user = await client.users.fetch(uid);
        const embeds = [makeTurnResultEmbed(result, uid)];
        const supEmbed = makeSupportResultEmbed(result, uid);
        if (supEmbed) embeds.push(supEmbed);
        await user.send({ embeds });
      } catch (e) {}
    }

    await notifySpectators(client, battleId, battle, result, false, escaped);

    for (const uid of [battle.player1_id, battle.player2_id]) {
      await sendBattleShop(client, battleId, uid, battle.turn_number, result);
    }

  } else {
    await pool.query(`
      UPDATE battles
      SET turn_number = ?, p1_turn_ended = 0, p2_turn_ended = 0,
          p1_shop_closed = 0, p2_shop_closed = 0
      WHERE id = ?
    `, [nextTurn, battleId]);

    await notifySpectators(client, battleId, battle, result, false, escaped);
    await processNextTurnEffects(battleId, client).catch(e => console.error('[processNextTurnEffects]', e));
    await notifySpectatorsNewTurn(client, battleId, nextTurn);

    for (const uid of [battle.player1_id, battle.player2_id]) {
      await sendBattleMessage(client, battleId, uid, nextTurn, result);
    }
  }
}

// -------------------------------------------------
// 턴 결과 임베드
// -------------------------------------------------
function makeTurnResultEmbed(result, viewerId, isEnd = false, isWinner = false) {
  if (result.isMutual) {
    return new EmbedBuilder()
      .setTitle('턴 결과 - 스킬 없음')
      .setDescription('양쪽 모두 스킬을 사용하지 않아 이번 턴은 0 데미지로 넘어갑니다.')
      .setColor(0x95a5a6)
      .setTimestamp();
  }

  const isAttacker = result.winnerId === viewerId;
  const myRoll     = isAttacker ? result.winnerRoll : result.loserRoll;
  const oppRoll    = isAttacker ? result.loserRoll  : result.winnerRoll;

  const traitText = result.traitLogs?.length
    ? '\n\n특성 발동\n' + result.traitLogs.join('\n')
    : '';

  const title = isEnd
    ? (isWinner ? '전투 종료 - 승리! (+500 포인트)' : '전투 종료 - 패배')
    : '턴 결과';

  let hapLine = '';
  if (result.isOneWay) {
    const mySkillName  = isAttacker ? result.oneWaySkillName : '(없음)';
    const oppSkillName = isAttacker ? '(없음)' : result.oneWaySkillName;
    hapLine =
      `내 스킬: **${mySkillName}**  상대 스킬: **${oppSkillName}**\n` +
      (isAttacker ? '일방 공격! 상대가 스킬을 사용하지 않았습니다.' : '일방 공격 당함! 스킬을 사용하지 않았습니다.');
  } else {
    const isViewerP1   = result.p1PlayerId === viewerId;
    const mySkillName  = (isViewerP1 ? result.p1Skill : result.p2Skill)?.name ?? '(없음)';
    const oppSkillName = (isViewerP1 ? result.p2Skill : result.p1Skill)?.name ?? '(없음)';

    hapLine =
      `내 스킬: **${mySkillName}**  상대 스킬: **${oppSkillName}**\n` +
      `내 주사위: **${myRoll}**  상대 주사위: **${oppRoll}**`;
  }

  const resultLine = isAttacker
    ? `합 승리! **${result.damage}** 데미지\n상대 남은 체력: **${result.targetHp}**`
    : `합 패배. **${result.damage}** 데미지 받음\n내 남은 체력: **${result.targetHp}**`;

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(hapLine + '\n\n' + resultLine + traitText)
    .setColor(isEnd ? (isWinner ? 0xf1c40f : 0x7f8c8d) : (isAttacker ? 0x2ecc71 : 0xe74c3c))
    .setTimestamp();
}

// -------------------------------------------------
// 상점 닫힘 처리
// -------------------------------------------------
async function onShopClosed(battleId, userId, shopTurn, lastResult, client) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const col = battle.player1_id === userId ? 'p1_shop_closed' : 'p2_shop_closed';
  await pool.query(`UPDATE battles SET ${col} = 1 WHERE id = ?`, [battleId]);

  const [[updated]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  if (updated.p1_shop_closed && updated.p2_shop_closed) {
    const nextTurn = shopTurn + 1;
    await pool.query(
      `UPDATE battles SET turn_number = ?, p1_support_used = 0, p2_support_used = 0 WHERE id = ?`,
      [nextTurn, battleId]
    );

    await processNextTurnEffects(battleId, client).catch(e => console.error('[processNextTurnEffects]', e));
    await notifySpectatorsNewTurn(client, battleId, nextTurn);

    const { sendBattleMessage } = require('./battleStart');
    for (const uid of [battle.player1_id, battle.player2_id]) {
      await sendBattleMessage(client, battleId, uid, nextTurn, null);
    }
  }
}

// -------------------------------------------------
// 항복 요청
// -------------------------------------------------
async function handleSurrenderAsk(i, battleId, client, collector) {
  const userId = i.user.id;

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('항복 확인 중...')
        .setDescription('아래 메시지에서 항복 여부를 선택해주세요.')
        .setColor(0xe74c3c)
        .setTimestamp()
    ],
    components: []
  }).catch(() => {});

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`surrender_yes_${battleId}`)
      .setLabel('항복 확인')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`surrender_no_${battleId}`)
      .setLabel('취소')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await i.channel.send({
    content: '정말 항복하시겠습니까?',
    components: [confirmRow]
  });

  const confirmCollector = confirmMsg.createMessageComponentCollector({
    filter: (btn) => btn.user.id === userId,
    time: 30_000,
    max: 1
  });

  confirmCollector.on('collect', async (btn) => {
    if (btn.customId === `surrender_yes_${battleId}`) {
      await handleSurrenderConfirm(btn, battleId, client, collector);
    } else {
      await btn.update({ content: '항복이 취소되었습니다.', components: [] }).catch(() => {});
      const { sendBattleMessage } = require('./battleStart');
      const [[b]] = await pool.query(`SELECT turn_number FROM battles WHERE id = ?`, [battleId]);
      await sendBattleMessage(client, battleId, userId, b.turn_number, null);
    }
  });

  confirmCollector.on('end', async (collected) => {
    if (collected.size > 0) return;
    await confirmMsg.edit({ content: '항복이 취소되었습니다. (시간 초과)', components: [] }).catch(() => {});
    const { sendBattleMessage } = require('./battleStart');
    const [[b]] = await pool.query(`SELECT turn_number FROM battles WHERE id = ?`, [battleId]);
    await sendBattleMessage(client, battleId, userId, b.turn_number, null);
  });
}

// -------------------------------------------------
// 항복 확정
// -------------------------------------------------
async function handleSurrenderConfirm(i, battleId, client, collector) {
  const loserId    = i.user.id;
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const winnerId   = battle.player1_id === loserId ? battle.player2_id : battle.player1_id;

  await pool.query(`UPDATE battles SET status = 'ended', winner_id = ? WHERE id = ?`, [winnerId, battleId]);
  await pool.query(`UPDATE users SET cost = cost + 500 WHERE user_id = ?`, [winnerId]);

  await i.update({ content: '항복 처리되었습니다.', components: [] }).catch(() => {});
  collector.stop('battleEnd');
  client.emit('battleEnded', String(battleId));

  const [[winnerBc]] = await pool.query(`SELECT bc.current_hp, c.name AS card_name FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`, [battleId, winnerId]);
  const [[winnerUser]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [winnerId]);
  const [[loserUser]]  = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [loserId]);

  const surrenderSummary = new EmbedBuilder()
    .setTitle('전투 요약')
    .setDescription(
      `🏆 **${winnerUser.username}** 승리  |  💀 **${loserUser.username}** 항복\n\n` +
      `총 **${battle.turn_number}턴** 만에 종료\n\n` +
      `**${winnerUser.username}** (${winnerBc?.card_name ?? '?'}) 남은 체력: **${winnerBc?.current_hp ?? '?'}**`
    )
    .setColor(0x5865F2)
    .setTimestamp();

  try {
    const winner = await client.users.fetch(winnerId);
    await winner.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('전투 종료 - 승리! (+500 포인트)')
          .setDescription('상대방이 항복했습니다. 승리하셨습니다!\n포인트 500이 지급되었습니다.')
          .setColor(0xf1c40f)
          .setTimestamp(),
        surrenderSummary
      ]
    });
  } catch (err) {
    console.error('[surrender] 승자 DM 실패:', err);
  }

  try {
    const loser = await client.users.fetch(loserId);
    await loser.send({ embeds: [surrenderSummary] });
  } catch (err) {}
}

// -------------------------------------------------
// 알맹이 3턴 스킬 미사용 카운트
// -------------------------------------------------
async function checkAlmangyiSkip(battleId, battle, result) {
  const players = [
    { cardId: battle.player1_card_id, skill: result.p1Skill, skipCol: 'p1_almangyi_skip', evolveCol: 'p1_evolve_next', skipVal: battle.p1_almangyi_skip ?? 0 },
    { cardId: battle.player2_card_id, skill: result.p2Skill, skipCol: 'p2_almangyi_skip', evolveCol: 'p2_evolve_next', skipVal: battle.p2_almangyi_skip ?? 0 }
  ];

  for (const { cardId, skill, skipCol, evolveCol, skipVal } of players) {
    if (cardId !== 6) {
      if (skipVal > 0) await pool.query(`UPDATE battles SET ${skipCol} = 0 WHERE id = ?`, [battleId]);
      continue;
    }
    if (!skill) {
      const newSkip = skipVal + 1;
      if (newSkip >= 3) {
        await pool.query(`UPDATE battles SET ${skipCol} = 0, ${evolveCol} = 1 WHERE id = ?`, [battleId]);
      } else {
        await pool.query(`UPDATE battles SET ${skipCol} = ? WHERE id = ?`, [newSkip, battleId]);
      }
    } else {
      if (skipVal > 0) await pool.query(`UPDATE battles SET ${skipCol} = 0 WHERE id = ?`, [battleId]);
    }
  }
}

// -------------------------------------------------
// 초절맹이 진화 처리
// -------------------------------------------------
async function processEvolution(battleId, userId, client, battle) {
  const [[choCard]] = await pool.query(`SELECT id FROM cards WHERE name = '초절맹이' LIMIT 1`);
  const [[sk1]]     = await pool.query(`SELECT id FROM skill WHERE name = '삼연격' LIMIT 1`);
  const [[sk2]]     = await pool.query(`SELECT id FROM skill WHERE name = '초절맹이살격난참' LIMIT 1`);
  if (!choCard || !sk1 || !sk2) { console.error('[processEvolution] 초절맹이 카드/스킬 없음'); return; }

  const CHO_CARD_ID = choCard.id;
  const CHO_SKILLS  = [{ id: sk1.id, slot: 2 }, { id: sk1.id, slot: 2 }, { id: sk2.id, slot: 3 }];

  const isP1      = battle.player1_id === userId;
  const cardCol   = isP1 ? 'player1_card_id' : 'player2_card_id';
  const evolveCol = isP1 ? 'p1_evolve_next'  : 'p2_evolve_next';
  const debuffCols = isP1
    ? 'p1_stunned = 0, p1_max_roll_debuff = 0, p1_self_stun_next = 0, p1_dmg_reduce = 0'
    : 'p2_stunned = 0, p2_max_roll_debuff = 0, p2_self_stun_next = 0, p2_dmg_reduce = 0';

  await pool.query(`UPDATE battles SET ${cardCol} = ?, ${evolveCol} = 0 WHERE id = ?`, [CHO_CARD_ID, battleId]);
  await pool.query(`UPDATE battle_cards SET card_id = ?, current_hp = 2500 WHERE battle_id = ? AND user_id = ?`, [CHO_CARD_ID, battleId, userId]);
  await pool.query(`DELETE FROM battle_skills WHERE battle_id = ? AND user_id = ? AND is_support = 0 AND is_special = 0`, [battleId, userId]);
  for (const { id, slot } of CHO_SKILLS) {
    await pool.query(`INSERT INTO battle_skills (battle_id, user_id, skill_id, skill_slot, is_special, is_support) VALUES (?, ?, ?, ?, 0, 0)`, [battleId, userId, id, slot]);
  }
  await pool.query(`UPDATE battles SET ${debuffCols} WHERE id = ?`, [battleId]);

  const oppId = isP1 ? battle.player2_id : battle.player1_id;
  const [[myUser]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [userId]);

  const myEmbed = new EmbedBuilder()
    .setTitle('⚡ 초절맹이로 진화!')
    .setDescription('알맹이가 3턴 연속 스킬을 사용하지 않아 **초절맹이**로 진화했습니다!\n\nATK: 1250  HP: 2500\n\n스킬이 초절맹이 전용 스킬로 교체되었습니다.\n모든 디버프가 해제되었습니다.')
    .setColor(0xf1c40f).setTimestamp();

  const oppEmbed = new EmbedBuilder()
    .setTitle('상대방 카드 변경!')
    .setDescription(`**${myUser.username}**의 카드가 **초절맹이**로 변경되었습니다.\n\nATK: 1250  HP: 2500`)
    .setColor(0xe74c3c).setTimestamp();

  try { const u = await client.users.fetch(userId); await u.send({ embeds: [myEmbed] }); } catch(e) {}
  try { const u = await client.users.fetch(oppId);  await u.send({ embeds: [oppEmbed] }); } catch(e) {}

  const { battleSpectators } = require('./spectatorStore');
  const specs = battleSpectators.get(String(battleId));
  if (specs?.size > 0) {
    for (const uid of specs) {
      try { const u = await client.users.fetch(uid); await u.send({ embeds: [oppEmbed] }); } catch(e) {}
    }
  }
}

// -------------------------------------------------
// 수박빨리믂기 다음 턴 효과 적용
// -------------------------------------------------
async function processNextTurnEffects(battleId, client) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);

  // 진화 먼저 처리
  for (const userId of [battle.player1_id, battle.player2_id]) {
    const isP1 = battle.player1_id === userId;
    const evolveNext = isP1 ? battle.p1_evolve_next : battle.p2_evolve_next;
    if (evolveNext) await processEvolution(battleId, userId, client, battle);
  }

  const effects = [];

  for (const userId of [battle.player1_id, battle.player2_id]) {
    const isP1     = battle.player1_id === userId;
    const healNext = isP1 ? battle.p1_heal_next    : battle.p2_heal_next;
    const ccNext   = isP1 ? battle.p1_cc_clear_next : battle.p2_cc_clear_next;

    if (!healNext && !ccNext) continue;

    const myCardId  = isP1 ? battle.player1_card_id : battle.player2_card_id;
    const isGon     = myCardId === 4;
    const titleLine = isGon ? '**김 곤 불굴 효과 발동!**' : '**수박빨리믂기 효과 발동!**';
    const lines     = [titleLine];

    if (ccNext) {
      const clearCols = isP1
        ? 'p1_stunned = 0, p1_max_roll_debuff = 0, p1_self_stun_next = 0'
        : 'p2_stunned = 0, p2_max_roll_debuff = 0, p2_self_stun_next = 0';
      await pool.query(`UPDATE battles SET ${clearCols} WHERE id = ?`, [battleId]);
      lines.push('✅ 모든 CC 해제');
    }

    if (healNext) {
      const [[bc]] = await pool.query(
        `SELECT bc.current_hp, c.hp AS max_hp FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`,
        [battleId, userId]
      );
      const hpLost  = bc.max_hp - bc.current_hp;
      const healAmt = Math.floor(hpLost * 0.5);
      if (healAmt > 0) {
        await pool.query(
          `UPDATE battle_cards SET current_hp = LEAST(current_hp + ?, ?) WHERE battle_id = ? AND user_id = ?`,
          [healAmt, bc.max_hp, battleId, userId]
        );
        lines.push(`💚 체력 **${healAmt}** 회복 (현재: ${bc.current_hp + healAmt} / ${bc.max_hp})`);
      } else {
        lines.push('💚 체력이 꽉 찬 상태라 회복 없음');
      }
    }

    const resetCols = isP1
      ? 'p1_heal_next = 0, p1_cc_clear_next = 0'
      : 'p2_heal_next = 0, p2_cc_clear_next = 0';
    await pool.query(`UPDATE battles SET ${resetCols} WHERE id = ?`, [battleId]);

    effects.push({ userId, lines });
  }

  for (const { userId, lines } of effects) {
    const oppId = battle.player1_id === userId ? battle.player2_id : battle.player1_id;
    const [[userRow]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [userId]);

    // 본인 알림
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [new EmbedBuilder().setTitle('수박빨리믂기').setDescription(lines.join('\n')).setColor(0x2ecc71).setTimestamp()]
      });
    } catch (e) {}

    // 상대 알림
    const oppLines = [`**${userRow.username}**의 수박빨리믂기 효과 발동!`, ...lines.slice(1)];
    try {
      const opp = await client.users.fetch(oppId);
      await opp.send({
        embeds: [new EmbedBuilder().setTitle('수박빨리믂기').setDescription(oppLines.join('\n')).setColor(0xe74c3c).setTimestamp()]
      });
    } catch (e) {}

    // 관전자 알림
    const { battleSpectators } = require('./spectatorStore');
    const specs = battleSpectators.get(String(battleId));
    if (specs?.size > 0) {
      const specEmbed = new EmbedBuilder()
        .setTitle('수박빨리믂기')
        .setDescription(oppLines.join('\n'))
        .setColor(0x2ecc71)
        .setTimestamp();
      for (const uid of specs) {
        try {
          const u = await client.users.fetch(uid);
          await u.send({ embeds: [specEmbed] });
        } catch (e) {}
      }
    }
  }
}

// -------------------------------------------------
// 관전자 다음 턴 시작 알림
// -------------------------------------------------
async function notifySpectatorsNewTurn(client, battleId, turnNumber) {
  const { battleSpectators } = require('./spectatorStore');
  const specs = battleSpectators.get(String(battleId));
  if (!specs || specs.size === 0) return;

  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const [[p1bc]]   = await pool.query(`SELECT bc.current_hp, c.name AS card_name FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`, [battleId, battle.player1_id]);
  const [[p2bc]]   = await pool.query(`SELECT bc.current_hp, c.name AS card_name FROM battle_cards bc JOIN cards c ON bc.card_id = c.id WHERE bc.battle_id = ? AND bc.user_id = ?`, [battleId, battle.player2_id]);
  const [[p1user]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player1_id]);
  const [[p2user]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player2_id]);

  const embed = new EmbedBuilder()
    .setTitle(`턴 ${turnNumber} 시작`)
    .setDescription(
      `${p1user.username} (${p1bc?.card_name ?? '?'}): HP **${p1bc?.current_hp ?? '?'}**\n` +
      `${p2user.username} (${p2bc?.card_name ?? '?'}): HP **${p2bc?.current_hp ?? '?'}**`
    )
    .setColor(0x3498db)
    .setTimestamp();

  for (const uid of specs) {
    try {
      const user = await client.users.fetch(uid);
      await user.send({ embeds: [embed] });
    } catch (e) {}
  }
}

// -------------------------------------------------
// 관전자 DM 전송
// -------------------------------------------------
async function notifySpectators(client, battleId, battle, result, isEnd = false, escaped = []) {
  const { battleSpectators } = require('./spectatorStore');
  const specs = battleSpectators.get(String(battleId));
  if (!specs || specs.size === 0) return;

  const [[p1User]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player1_id]);
  const [[p2User]] = await pool.query(`SELECT username FROM users WHERE user_id = ?`, [battle.player2_id]);

  // 탈주 후 카드가 바뀔 수 있으니 battle_cards 기준으로 조회
  const [[p1bcRow]] = await pool.query(`
    SELECT bc.current_hp, c.name AS card_name, c.hp AS card_max_hp
    FROM battle_cards bc JOIN cards c ON bc.card_id = c.id
    WHERE bc.battle_id = ? AND bc.user_id = ?
  `, [battleId, battle.player1_id]);
  const [[p2bcRow]] = await pool.query(`
    SELECT bc.current_hp, c.name AS card_name, c.hp AS card_max_hp
    FROM battle_cards bc JOIN cards c ON bc.card_id = c.id
    WHERE bc.battle_id = ? AND bc.user_id = ?
  `, [battleId, battle.player2_id]);

  const p1Name = p1User.username;
  const p2Name = p2User.username;
  const lines  = [];

  // 카드 정보
  lines.push(`**${p1Name}** (${p1bcRow?.card_name ?? '?'}) vs **${p2Name}** (${p2bcRow?.card_name ?? '?'})`);
  lines.push('');

  // 합 결과
  if (result.isMutual) {
    lines.push('양쪽 모두 스킬 없음 — 0 데미지');
  } else if (result.isOneWay) {
    const atkName = result.winnerId === battle.player1_id ? p1Name : p2Name;
    const defName = result.winnerId === battle.player1_id ? p2Name : p1Name;
    lines.push(`⚔️ **${atkName}** 일방 공격`);
    lines.push(`스킬: **${result.oneWaySkillName}**`);
    lines.push(`데미지: **${result.damage}** → ${defName} 남은 체력: **${result.targetHp}**`);
  } else {
    const winName    = result.winnerId === battle.player1_id ? p1Name : p2Name;
    const losName    = result.loserId  === battle.player1_id ? p1Name : p2Name;
    const p1SkillName = result.p1Skill?.name ?? '(없음)';
    const p2SkillName = result.p2Skill?.name ?? '(없음)';
    lines.push(`🎲 **합 결과**`);
    lines.push(`${p1Name}: **${p1SkillName}** — 주사위 ${result.p1Roll ?? '?'}`);
    lines.push(`${p2Name}: **${p2SkillName}** — 주사위 ${result.p2Roll ?? '?'}`);
    lines.push(`⚔️ **${winName}** 합 승리 → **${result.damage}** 데미지 (${losName} 남은 체력: **${result.targetHp}**)`);
  }

  // 특성 발동
  if (result.traitLogs?.length) {
    lines.push('');
    lines.push('**특성 발동**');
    result.traitLogs.forEach(log => lines.push(log));
  }

  // 원호공격
  if (result.supportLogs?.length) {
    lines.push('');
    lines.push('**원호공격**');
    for (const log of result.supportLogs) {
      const atkName = log.attackerId === battle.player1_id ? p1Name : p2Name;
      let entry = `${atkName}: **${log.skillName}** → **${log.damage}** 데미지`;
      if (log.extraLog) entry += `\n└ ${log.extraLog}`;
      lines.push(entry);
    }
  }

  // 탈주
  if (escaped.length > 0) {
    lines.push('');
    lines.push('**탈주**');
    for (const { uid, newCard } of escaped) {
      const name = uid === battle.player1_id ? p1Name : p2Name;
      lines.push(`${name} → **${newCard.name}**으로 카드 변경`);
    }
  }

  // 현재 체력
  lines.push('');
  lines.push('**현재 체력**');
  lines.push(`${p1Name} (${p1bcRow?.card_name ?? '?'}): **${p1bcRow?.current_hp ?? '?'}** / ${p1bcRow?.card_max_hp ?? '?'}`);
  lines.push(`${p2Name} (${p2bcRow?.card_name ?? '?'}): **${p2bcRow?.current_hp ?? '?'}** / ${p2bcRow?.card_max_hp ?? '?'}`);

  // 전투 종료
  let title = `턴 ${battle.turn_number} 결과`;
  let color = 0x9b59b6;
  if (isEnd) {
    const winnerName = result.winnerId === battle.player1_id ? p1Name : p2Name;
    const loserName  = result.winnerId === battle.player1_id ? p2Name : p1Name;
    const winnerCard = result.winnerId === battle.player1_id ? p1bcRow?.card_name : p2bcRow?.card_name;
    const loserCard  = result.winnerId === battle.player1_id ? p2bcRow?.card_name : p1bcRow?.card_name;
    const winnerHp   = result.winnerId === battle.player1_id ? p1bcRow?.current_hp : p2bcRow?.current_hp;
    lines.push('');
    lines.push(`🏆 **${winnerName}** (${winnerCard}) 승리!`);
    lines.push(`💀 **${loserName}** (${loserCard}) 패배`);
    lines.push(`총 **${battle.turn_number}턴** 만에 종료`);
    lines.push(`${winnerName} 남은 체력: **${winnerHp ?? '?'}**`);
    title = '전투 종료';
    color = 0xf1c40f;
    battleSpectators.delete(String(battleId));
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(color)
    .setTimestamp();

  for (const uid of specs) {
    try {
      const user = await client.users.fetch(uid);
      await user.send({ embeds: [embed] });
    } catch (e) {}
  }
}

// -------------------------------------------------
// 원호공격 결과 임베드
// -------------------------------------------------
function makeSupportResultEmbed(result, viewerId) {
  if (!result.supportLogs || result.supportLogs.length === 0) return null;

  const lines = result.supportLogs.map(log => {
    const isMyAttack = log.attackerId === viewerId;
    const base = isMyAttack
      ? `원호공격! **${log.skillName}** → **${log.damage}** 데미지`
      : `상대 원호공격! **${log.skillName}** → **${log.damage}** 데미지`;
    return log.extraLog ? `${base}\n${log.extraLog}` : base;
  });

  return new EmbedBuilder()
    .setTitle('원호공격 결과')
    .setDescription(lines.join('\n\n'))
    .setColor(0xe67e22)
    .setTimestamp();
}

module.exports = { handleBattleButton, processTurn, makeTurnResultEmbed, makeSupportResultEmbed, onShopClosed };