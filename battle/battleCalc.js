// battle/battleCalc.js

const pool = require('../db');
const { applyAttackTraits, applyDefenseTraits, applyAfterHitTraits } = require('./battleTraits');

// -------------------------------------------------
// 합 판정 — 디버프 파라미터 포함
// -------------------------------------------------
function rollOne(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollHap(p1Skill, p2Skill, p1Id, p2Id, p1Debuff = 0, p2Debuff = 0) {
  const p1Max = Math.max(p1Skill.min, p1Skill.max - p1Debuff);
  const p2Max = Math.max(p2Skill.min, p2Skill.max - p2Debuff);
  const roll1 = rollOne(p1Skill.min, p1Max);
  const roll2 = rollOne(p2Skill.min, p2Max);

  if (roll1 === roll2) return rollHap(p1Skill, p2Skill, p1Id, p2Id, p1Debuff, p2Debuff);

  return {
    winnerId:   roll1 > roll2 ? p1Id  : p2Id,
    loserId:    roll1 > roll2 ? p2Id  : p1Id,
    winnerRoll: roll1 > roll2 ? roll1 : roll2,
    loserRoll:  roll1 > roll2 ? roll2 : roll1,
    p1Roll: roll1,
    p2Roll: roll2
  };
}

// -------------------------------------------------
// 기본 데미지
// -------------------------------------------------
function calcDamage(attack, skillAtk) {
  return Math.floor(attack * parseFloat(skillAtk));
}

// -------------------------------------------------
// DB 체력 차감
// -------------------------------------------------
async function applyDamage(battleId, targetId, damage) {
  await pool.query(`
    UPDATE battle_cards
    SET current_hp = GREATEST(current_hp - ?, 0)
    WHERE battle_id = ? AND user_id = ?
  `, [damage, battleId, targetId]);

  const [[bc]] = await pool.query(
    `SELECT current_hp FROM battle_cards WHERE battle_id = ? AND user_id = ?`,
    [battleId, targetId]
  );

  return { newHp: bc.current_hp, isDead: bc.current_hp <= 0 };
}

// -------------------------------------------------
// 스턴 체크
// -------------------------------------------------
async function checkAndClearStun(battleId, userId, battle) {
  const isP1      = battle.player1_id === userId;
  const isStunned = isP1 ? battle.p1_stunned : battle.p2_stunned;

  if (isStunned) {
    const col = isP1 ? 'p1_stunned' : 'p2_stunned';
    await pool.query(`UPDATE battles SET ${col} = 0 WHERE id = ?`, [battleId]);
    return true;
  }
  return false;
}

// -------------------------------------------------
// 이번 턴 선택된 스킬 조회 — skill 테이블 단일 JOIN
// -------------------------------------------------
async function getTurnSkill(battleId, userId) {
  const [rows] = await pool.query(`
    SELECT bs.id AS bs_id, bs.skill_id,
           s.name, s.attack, s.min, s.max,
           s.skill AS skill_type, s.is_special,
           CASE WHEN s.is_special = 1 THEN 'special' ELSE 'normal' END AS kind
    FROM battle_skills bs
    JOIN skill s ON bs.skill_id = s.id
    WHERE bs.battle_id = ? AND bs.user_id = ? AND bs.turn_selected = 1 AND bs.is_support = 0
    LIMIT 1
  `, [battleId, userId]);

  return rows[0] ?? null;
}

// -------------------------------------------------
// 원호공격 스킬 조회
// -------------------------------------------------
async function getSupportTurnSkill(battleId, userId) {
  const [rows] = await pool.query(`
    SELECT bs.id AS bs_id, s.name, s.attack AS coefficient,
           c.attack AS card_attack, c.name AS card_name
    FROM battle_skills bs
    JOIN skill s ON bs.skill_id = s.id
    JOIN cards c ON c.id = bs.skill_slot
    WHERE bs.battle_id = ? AND bs.user_id = ?
      AND bs.is_support = 1 AND bs.turn_selected = 1
    LIMIT 1
  `, [battleId, userId]);
  return rows[0] ?? null;
}

// -------------------------------------------------
// 원호공격 데미지 적용 (양측)
// -------------------------------------------------
async function applyAllSupportDamage(battleId, p1Id, p2Id, battle) {
  let isDead = false;
  let supportWinnerId = null;
  const logs = [];
  const p1Sup = await getSupportTurnSkill(battleId, p1Id);
  const p2Sup = await getSupportTurnSkill(battleId, p2Id);

  if (p1Sup) {
    const dmg = Math.floor(p1Sup.card_attack * parseFloat(p1Sup.coefficient));
    const { newHp, isDead: dead } = await applyDamage(battleId, p2Id, dmg);
    const log = { attackerId: p1Id, skillName: p1Sup.name, damage: dmg, targetHp: newHp };
    if (p1Sup.name === '크류의 뜻대로 - 봉') {
      const stunCol = battle.player1_id === p2Id ? 'p1_stunned' : 'p2_stunned';
      await pool.query(`UPDATE battles SET ${stunCol} = 1 WHERE id = ?`, [battleId]);
      log.extraLog = '봉구스 참전! 상대가 다음 턴 행동 불가 상태가 됩니다.';
    }
    logs.push(log);
    if (dead && !isDead) supportWinnerId = p1Id;
    if (dead) isDead = true;
    await pool.query(`DELETE FROM battle_skills WHERE id = ?`, [p1Sup.bs_id]);
  }
  if (p2Sup) {
    const dmg = Math.floor(p2Sup.card_attack * parseFloat(p2Sup.coefficient));
    const { newHp, isDead: dead } = await applyDamage(battleId, p1Id, dmg);
    const log = { attackerId: p2Id, skillName: p2Sup.name, damage: dmg, targetHp: newHp };
    if (p2Sup.name === '크류의 뜻대로 - 봉') {
      const stunCol = battle.player1_id === p1Id ? 'p1_stunned' : 'p2_stunned';
      await pool.query(`UPDATE battles SET ${stunCol} = 1 WHERE id = ?`, [battleId]);
      log.extraLog = '봉구스 참전! 상대가 다음 턴 행동 불가 상태가 됩니다.';
    }
    logs.push(log);
    if (dead && !isDead) supportWinnerId = p2Id;
    if (dead) isDead = true;
    await pool.query(`DELETE FROM battle_skills WHERE id = ?`, [p2Sup.bs_id]);
  }
  return { isDead, logs, supportWinnerId };
}

// -------------------------------------------------
// 김 곤 불굴 생존 체크
// -------------------------------------------------
async function checkGonSurvival(battleId, userId, cardId, currentHp, battle, traitLogs) {
  if (currentHp > 0 || cardId !== 4) return { newHp: currentHp, isDead: currentHp <= 0 };

  const isP1       = battle.player1_id === userId;
  const gonSurvived = isP1 ? battle.p1_gon_survived : battle.p2_gon_survived;
  if (gonSurvived) return { newHp: 0, isDead: true };

  await pool.query(`UPDATE battle_cards SET current_hp = 1 WHERE battle_id = ? AND user_id = ?`, [battleId, userId]);

  const gonCol    = isP1 ? 'p1_gon_survived'   : 'p2_gon_survived';
  const debuffCol = isP1 ? 'p1_cc_clear_next'  : 'p2_cc_clear_next';
  await pool.query(`UPDATE battles SET ${gonCol} = 1, ${debuffCol} = 1 WHERE id = ?`, [battleId]);

  traitLogs.push('김 곤 불굴! 치명타를 1의 체력으로 버텨냈습니다. 다음 턴 디버프가 해제됩니다.');
  return { newHp: 1, isDead: false };
}

// -------------------------------------------------
// 수박빨리믂기 heal 저장
// -------------------------------------------------
async function checkAndStoreHeal(battleId, userId, damage, battle) {
  const [[row]] = await pool.query(`
    SELECT id FROM battle_skills
    WHERE battle_id = ? AND user_id = ? AND skill_id = 30 AND turn_selected = 1
  `, [battleId, userId]);
  if (!row) return;
  const healAmount = Math.floor(damage * 0.5);
  const healCol = battle.player1_id === userId ? 'p1_heal_next' : 'p2_heal_next';
  await pool.query(`UPDATE battles SET ${healCol} = ${healCol} + ? WHERE id = ?`, [healAmount, battleId]);
}

// -------------------------------------------------
// 코스트 지급
// -------------------------------------------------
async function grantCost(battleId, winnerId, battle) {
  const p1Wins = battle.player1_id === winnerId;
  await pool.query(`
    UPDATE battles
    SET battle_cost_p1 = battle_cost_p1 + ?,
        battle_cost_p2 = battle_cost_p2 + ?
    WHERE id = ?
  `, [p1Wins ? 200 : 100, p1Wins ? 100 : 200, battleId]);
}

// -------------------------------------------------
// 자기 스턴 플래그 → 실제 스턴으로 전환 (턴 계산 완료 후)
// -------------------------------------------------
async function convertSelfStun(pool, battleId, battle) {
  const updates = [];
  if (battle.p1_self_stun_next) updates.push('p1_stunned = 1, p1_self_stun_next = 0');
  if (battle.p2_self_stun_next) updates.push('p2_stunned = 1, p2_self_stun_next = 0');
  if (updates.length > 0) {
    await pool.query(`UPDATE battles SET ${updates.join(', ')} WHERE id = ?`, [battleId]);
  }
}

// -------------------------------------------------
// 메인 턴 계산
// -------------------------------------------------
async function processBattleCalc(battleId) {
  const [[battle]] = await pool.query(`SELECT * FROM battles WHERE id = ?`, [battleId]);
  const p1Id = battle.player1_id;
  const p2Id = battle.player2_id;

  const [[p1bc]] = await pool.query(`
    SELECT bc.current_hp, c.attack, c.id AS card_id
    FROM battle_cards bc JOIN cards c ON bc.card_id = c.id
    WHERE bc.battle_id = ? AND bc.user_id = ?
  `, [battleId, p1Id]);

  const [[p2bc]] = await pool.query(`
    SELECT bc.current_hp, c.attack, c.id AS card_id
    FROM battle_cards bc JOIN cards c ON bc.card_id = c.id
    WHERE bc.battle_id = ? AND bc.user_id = ?
  `, [battleId, p2Id]);

  // 스턴 체크
  const p1Stunned = await checkAndClearStun(battleId, p1Id, battle);
  const p2Stunned = await checkAndClearStun(battleId, p2Id, battle);

  const p1Skill = p1Stunned ? null : await getTurnSkill(battleId, p1Id);
  const p2Skill = p2Stunned ? null : await getTurnSkill(battleId, p2Id);

  if (p1Stunned) await pool.query(`UPDATE battle_skills SET turn_selected = 0 WHERE battle_id = ? AND user_id = ? AND is_support = 0`, [battleId, p1Id]);
  if (p2Stunned) await pool.query(`UPDATE battle_skills SET turn_selected = 0 WHERE battle_id = ? AND user_id = ? AND is_support = 0`, [battleId, p2Id]);

  // 일방 공격 (스턴 여부 전달)
  if (p1Skill && !p2Skill) return await resolveOneWay(battleId, p1Id, p2Id, p1bc, p2bc, p1Skill, battle, p2Stunned);
  if (!p1Skill && p2Skill) return await resolveOneWay(battleId, p2Id, p1Id, p2bc, p1bc, p2Skill, battle, p1Stunned);

  // 둘 다 없음 — 0뎀 (원호공격은 적용)
  if (!p1Skill && !p2Skill) {
    const { isDead: mutualSupportDead, logs: supportLogs, supportWinnerId } = await applyAllSupportDamage(battleId, p1Id, p2Id, battle);
    await convertSelfStun(pool, battleId, battle);
    return {
      winnerId: supportWinnerId ?? null,
      loserId:  supportWinnerId ? (supportWinnerId === p1Id ? p2Id : p1Id) : null,
      winnerRoll: null, loserRoll: null, p1Roll: null, p2Roll: null,
      damage: 0, targetHp: null, isDead: mutualSupportDead,
      traitLogs: [], supportLogs, p1Skill: null, p2Skill: null,
      isOneWay: false, isMutual: true, p1PlayerId: p1Id
    };
  }

  // 주사위 디버프 조회
  const p1Debuff = battle.p1_max_roll_debuff ?? 0;
  const p2Debuff = battle.p2_max_roll_debuff ?? 0;

  if (p1Debuff > 0 || p2Debuff > 0) {
    await pool.query(`UPDATE battles SET p1_max_roll_debuff = 0, p2_max_roll_debuff = 0 WHERE id = ?`, [battleId]);
  }

  // 합 판정
  const hap        = rollHap(p1Skill, p2Skill, p1Id, p2Id, p1Debuff, p2Debuff);
  const isP1Winner = hap.winnerId === p1Id;
  const attackerBc = isP1Winner ? p1bc    : p2bc;
  const defenderBc = isP1Winner ? p2bc    : p1bc;
  const atkSkill   = isP1Winner ? p1Skill : p2Skill;
  const defSkill   = isP1Winner ? p2Skill : p1Skill;

  // 봉구스 공격력 버프 적용
  const atkBuff      = isP1Winner ? (battle.p1_atk_buff ?? 0) : (battle.p2_atk_buff ?? 0);
  const buffedAttack = Math.floor(attackerBc.attack * (1 + atkBuff / 100));

  let damage = calcDamage(buffedAttack, atkSkill.attack);
  const traitLogs = [];
  if (atkBuff > 0) traitLogs.push(`봉구스 분노! 공격력 +${atkBuff}% 적용 (${Math.floor(atkBuff / 20)}중첩)`);

  const atkResult = applyAttackTraits({
    attackerCardId: attackerBc.card_id,
    defenderCardId: defenderBc.card_id,
    skillId:        atkSkill.skill_id ?? null,
    damage
  });
  damage = atkResult.damage;
  traitLogs.push(...atkResult.logs);

  // 수비자 데미지 감소 버프
  const defenderDmgReduce = hap.loserId === p1Id
    ? (battle.p1_dmg_reduce ?? 0)
    : (battle.p2_dmg_reduce ?? 0);

  const defResult = applyDefenseTraits({
    attackerCardId:   attackerBc.card_id,
    defenderCardId:   defenderBc.card_id,
    defenderSkillId:  defSkill.skill_id ?? null,
    damage,
    defenderDmgReduce
  });

  if (defenderDmgReduce > 0) {
    const dmgReduceCol = hap.loserId === p1Id ? 'p1_dmg_reduce' : 'p2_dmg_reduce';
    await pool.query(`UPDATE battles SET ${dmgReduceCol} = 0 WHERE id = ?`, [battleId]);
  }
  damage = defResult.damage;
  traitLogs.push(...defResult.logs);

  const { newHp: rawHp, isDead: rawDead } = await applyDamage(battleId, hap.loserId, damage);
  const { newHp, isDead } = await checkGonSurvival(battleId, hap.loserId, defenderBc.card_id, rawHp, battle, traitLogs);

  // 봉구스 피격 버프
  await applyCardReceiveTrait({
    pool, battleId, userId: hap.loserId, battle,
    cardId: defenderBc.card_id, damage, traitLogs
  });

  // 적중 후 효과 (스턴 등)
  await applyAfterHitTraits({
    pool,
    skillId:    atkSkill.skill_id ?? null,
    battleId,
    defenderId: hap.loserId,
    battle,
    traitLogs
  });

  const toDelete = [p1Skill?.bs_id, p2Skill?.bs_id].filter(Boolean);
  if (toDelete.length > 0) {
    await pool.query(`DELETE FROM battle_skills WHERE id IN (?)`, [toDelete]);
  }

  await grantCost(battleId, hap.winnerId, battle);
  await convertSelfStun(pool, battleId, battle);

  const { isDead: supportDead, logs: supportLogs, supportWinnerId } = await applyAllSupportDamage(battleId, p1Id, p2Id, battle);

  // 원호공격으로 사망했고 일반 합에선 사망 없을 때 → 실제 처치자로 winnerId 갱신
  const finalWinnerId = (supportDead && !isDead && supportWinnerId) ? supportWinnerId : hap.winnerId;
  const finalLoserId  = (supportDead && !isDead && supportWinnerId)
    ? (supportWinnerId === p1Id ? p2Id : p1Id)
    : hap.loserId;

  return {
    winnerId:   finalWinnerId,
    loserId:    finalLoserId,
    winnerRoll: hap.winnerRoll,
    loserRoll:  hap.loserRoll,
    p1Roll:     hap.p1Roll,
    p2Roll:     hap.p2Roll,
    damage, targetHp: newHp, isDead: isDead || supportDead, traitLogs, supportLogs,
    p1Skill, p2Skill, isOneWay: false, p1PlayerId: p1Id
  };
}

// -------------------------------------------------
// 일방 공격
// -------------------------------------------------
async function resolveOneWay(battleId, attackerId, defenderId, atkBc, defBc, atkSkill, battle, isDefenderStunned = false) {
  const isP1Attacker = battle.player1_id === attackerId;
  const atkBuff      = isP1Attacker ? (battle.p1_atk_buff ?? 0) : (battle.p2_atk_buff ?? 0);
  const buffedAttack = Math.floor(atkBc.attack * (1 + atkBuff / 100));
  let damage = calcDamage(buffedAttack, atkSkill.attack);
  const traitLogs = [];
  if (atkBuff > 0) traitLogs.push(`봉구스 분노! 공격력 +${atkBuff}% 적용 (${Math.floor(atkBuff / 20)}중첩)`);

  const atkResult = applyAttackTraits({
    attackerCardId: atkBc.card_id,
    defenderCardId: defBc.card_id,
    skillId:        atkSkill.skill_id ?? null,
    damage
  });
  damage = atkResult.damage;
  traitLogs.push(...atkResult.logs);

  // 알맹이 기절 방어
  if (defBc.card_id === 6 && isDefenderStunned) {
    damage = Math.floor(damage * 0.5);
    traitLogs.push(`알맹이 기절 방어! 받는 피해 50% 감소 → ${damage}`);
  }

  // 수비자 데미지 감소 버프
  const defReduceCol = battle.player1_id === defenderId ? 'p1_dmg_reduce' : 'p2_dmg_reduce';
  const [[defReduceRow]] = await pool.query(`SELECT ${defReduceCol} AS val FROM battles WHERE id = ?`, [battleId]);
  const defReduce = defReduceRow?.val ?? 0;
  if (defReduce > 0) {
    damage = Math.floor(damage * (1 - defReduce / 100));
    traitLogs.push(`데미지 ${defReduce}% 감소 적용 -> ${damage}`);
    await pool.query(`UPDATE battles SET ${defReduceCol} = 0 WHERE id = ?`, [battleId]);
  }

  const { newHp: rawHp2, isDead: rawDead2 } = await applyDamage(battleId, defenderId, damage);
  await checkAndStoreHeal(battleId, defenderId, damage, battle);
  const { newHp, isDead } = await checkGonSurvival(battleId, defenderId, defBc.card_id, rawHp2, battle, traitLogs);

  // 봉구스 피격 버프
  await applyCardReceiveTrait({
    pool, battleId, userId: defenderId, battle,
    cardId: defBc.card_id, damage, traitLogs
  });

  await applyAfterHitTraits({
    pool, skillId: atkSkill.skill_id ?? null,
    battleId, defenderId, battle, traitLogs
  });

  if (atkSkill.bs_id) {
    await pool.query(`DELETE FROM battle_skills WHERE id = ?`, [atkSkill.bs_id]);
  }

  await grantCost(battleId, attackerId, battle);
  await convertSelfStun(pool, battleId, battle);

  const p1Id = battle.player1_id;
  const p2Id = battle.player2_id;
  const { isDead: supportDead, logs: supportLogs, supportWinnerId } = await applyAllSupportDamage(battleId, p1Id, p2Id, battle);

  const finalWinnerId = (supportDead && !isDead && supportWinnerId) ? supportWinnerId : attackerId;
  const finalLoserId  = (supportDead && !isDead && supportWinnerId)
    ? (supportWinnerId === attackerId ? defenderId : attackerId)
    : defenderId;

  return {
    winnerId: finalWinnerId, loserId: finalLoserId,
    winnerRoll: null, loserRoll: null, p1Roll: null, p2Roll: null,
    damage, targetHp: newHp, isDead: isDead || supportDead, traitLogs, supportLogs,
    p1Skill: isP1Attacker ? atkSkill : null,
    p2Skill: isP1Attacker ? null     : atkSkill,
    isOneWay: true, p1PlayerId: p1Id,
    oneWayAttackerId: attackerId,
    oneWaySkillName:  atkSkill.name
  };
}

// -------------------------------------------------
// 카드 피격 특성 (봉구스 버프 등)
// -------------------------------------------------
async function applyCardReceiveTrait({ pool, battleId, userId, battle, cardId, damage, traitLogs }) {
  const { CARD_TRAITS } = require('./battleTraits');
  const trait = CARD_TRAITS[cardId];
  if (trait?.onReceive) {
    const r = await trait.onReceive({ pool, battleId, userId, battle, damage });
    if (r?.log) traitLogs.push(r.log);
  }
}

module.exports = { processBattleCalc, calcDamage, applyDamage };