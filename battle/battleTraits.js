// battle/battleTraits.js

const CARD_TRAITS = {

  // 봉구스 (id: 1) — 피격 시 공격력 20% 증가 (공격할 때까지 중첩)
  1: {
    description: '피격 시 자신의 공격력 20% 증가, 중첩 무제한',
    onReceive: async ({ pool, battleId, userId, battle, damage }) => {
      const col      = battle.player1_id === userId ? 'p1_atk_buff' : 'p2_atk_buff';
      const prevBuff = battle.player1_id === userId ? (battle.p1_atk_buff ?? 0) : (battle.p2_atk_buff ?? 0);
      const newBuff  = prevBuff + 20;
      const stack    = Math.floor(newBuff / 20);
      await pool.query(`UPDATE battles SET ${col} = ${col} + 20 WHERE id = ?`, [battleId]);
      return { damage, log: `봉구스 분노! 공격력 +${newBuff}% (${stack}중첩)` };
    }
  },

  // 망구스 (id: 2) — 조건부 탈주 버튼 (battleStart.js에서 처리)
  2: {
    description: '게임당 한번 탈주를 사용해, 모든 디버프를 해제하고 다른 카드로 변한다.',
  },

  5: {
    description: '전투상점이 등장하기 전마다 한번씩 사용 가능한 원호공격 보유'
  },

  // 김 곤 (id: 4) — 치명타 1회 생존 + 다음 턴 디버프 해제
  4: {
    description: '치명타를 한 번 1의 체력으로 버텨냅니다. 이후 다음 턴 모든 디버프가 해제됩니다.',
  },

  // 알맹이 (id: 6) — 기절 시 받는 피해 50% 감소
  6: {
    description: '기절 상태일 때 받는 피해 50% 감소',
  },

  // 동탁 (id: 7) — 알맹이 공격 시 데미지 2.5배
  7: {
    description: '알맹이를 공격할 때 데미지 2.5배',
    onHit: ({ defenderCardId, damage }) => {
      if (defenderCardId === 6) {
        return { damage: damage * 2.5, log: '알맹이 전담일진! 데미지 2.5배' };
      }
      return { damage };
    }
  },

};

const SKILL_TRAITS = {

  // 괜찮아 안죽어 (id: 1)
  // 사용 시: 20% → 받는 데미지 50% 감소 / 80% → 받는 데미지 30% 증가
  1: {
    description: '합 패배 시 20% 확률로 받는 데미지 50% 감소, 80% 확률로 받는 데미지 30% 증가',
    onReceive: ({ damage }) => {
      const roll = Math.random() * 100;
      if (roll < 20) {
        const reduced = Math.floor(damage * 0.5);
        return { damage: reduced, log: `괜찮아 안죽어! (20% 발동) 데미지 50% 감소 → ${reduced}` };
      } else {
        const increased = Math.floor(damage * 1.3);
        return { damage: increased, log: `괜찮아 안죽어! (80% 발동) 데미지 30% 증가 → ${increased}` };
      }
    }
  },

  // 알맹이 내르지 마세요! (id: 2)
  // 사용 시(합 결과 무관) 받는 데미지 30% 감소 → DB에 버프 저장
  2: {
    description: '사용 시 이번 턴 받는 데미지 30% 감소',
    onUse: async ({ pool, battleId, userId, battle }) => {
      const col = battle.player1_id === userId ? 'p1_dmg_reduce' : 'p2_dmg_reduce';
      await pool.query(`UPDATE battles SET ${col} = 30 WHERE id = ?`, [battleId]);
      return { log: '알맹이 내르지 마세요! 이번 턴 받는 데미지 30% 감소' };
    }
  },

  // 인권 유린 (id: 3)
  3: {
    description: '알맹이 적중 시 1.5배 피해 / 알맹이에게 패배 시 받는 피해 1.5배',
    onHit: ({ defenderCardId, damage }) => {
      if (defenderCardId === 6) {
        return { damage: Math.floor(damage * 1.5), log: '인권 유린! 알맹이에게 1.5배 피해' };
      }
      return { damage };
    },
    onReceive: ({ attackerCardId, damage }) => {
      if (attackerCardId === 6) {
        return { damage: Math.floor(damage * 1.5), log: '인권 유린 역풍! 알맹이에게 1.5배 피해를 받음' };
      }
      return { damage };
    }
  },

  // 아봉 (id: 14) — 적중 시 다음 턴 상대 스턴
  14: {
    description: '적중 시 다음 턴 상대가 행동 불가 (스턴)',
    onHit: ({ damage }) => ({ damage }),
    afterHit: async ({ pool, battleId, defenderId, battle }) => {
      const col = battle.player1_id === defenderId ? 'p1_stunned' : 'p2_stunned';
      await pool.query(`UPDATE battles SET ${col} = 1 WHERE id = ?`, [battleId]);
      return { log: '아봉! 상대가 다음 턴 행동 불가 상태가 됩니다.' };
    }
  },

  // 안 아프게 처맞기 (id: 16) — 합 패배 시 데미지 0
  16: {
    description: '합에서 져도 데미지를 받지 않습니다.',
    onReceive: ({ damage }) => {
      return { damage: 0, log: '안 아프게 처맞기! 데미지를 완전히 무효화했습니다.' };
    }
  },

  // 엿먹어라 (id: 11) — 적중 시 다음 턴 상대 주사위 최댓값 -3
  11: {
    description: '적중 시 다음 턴 상대의 주사위 최댓값 -3 (최솟값보다 낮아지지 않음)',
    onHit: ({ damage }) => ({ damage }),
    afterHit: async ({ pool, battleId, defenderId, battle }) => {
      const col = battle.player1_id === defenderId ? 'p1_max_roll_debuff' : 'p2_max_roll_debuff';
      await pool.query(`UPDATE battles SET ${col} = ${col} + 3 WHERE id = ?`, [battleId]);
      return { log: '엿먹어라! 상대의 다음 턴 주사위 최댓값이 -3 됩니다.' };
    }
  },

  // 아무것도 듣고싶지 않아요.. (id: 12)
// onUse가 아닌 afterUse 개념 — 턴 계산 후 스턴 적용
12: {
  description: '사용 시 다음 턴 자신이 행동 불가 상태가 됩니다.',
  onUse: async ({ pool, battleId, userId, battle }) => {
    // 즉시 스턴 X → p_self_stun_next 플래그로 저장
    const col = battle.player1_id === userId ? 'p1_self_stun_next' : 'p2_self_stun_next';
    await pool.query(`UPDATE battles SET ${col} = 1 WHERE id = ?`, [battleId]);
    return { log: '아무것도 듣고싶지 않아요.. 다음 턴 행동 불가 상태가 됩니다.' };
  }
},

  // 수박빨리믂기 (id: 30) — 다음 턴 CC 해제 + 잃은 체력 50% 회복
  30: {
    description: '다음 턴 모든 CC 해제 + 현재까지 잃은 체력의 50% 회복',
    onUse: async ({ pool, battleId, userId, battle }) => {
      const ccCol   = battle.player1_id === userId ? 'p1_cc_clear_next' : 'p2_cc_clear_next';
      const healCol = battle.player1_id === userId ? 'p1_heal_next'     : 'p2_heal_next';
      await pool.query(`UPDATE battles SET ${ccCol} = 1, ${healCol} = 1 WHERE id = ?`, [battleId]);
      return { log: '수박빨리믂기! 다음 턴에 CC 해제 + 잃은 체력 50% 회복이 발동합니다.' };
    }
  },

  // 전원, 처형이다! (id: 23 — special_skill 이전 후 id, 확인 필요)
  23: {
    description: '적중 시 다음 턴 상대가 행동 불가 (스턴)',
    onHit: ({ damage }) => ({ damage }),
    afterHit: async ({ pool, battleId, defenderId, battle }) => {
      const col = battle.player1_id === defenderId ? 'p1_stunned' : 'p2_stunned';
      await pool.query(`UPDATE battles SET ${col} = 1 WHERE id = ?`, [battleId]);
      return { log: '전원, 처형이다! 상대가 다음 턴 행동 불가 상태가 됩니다.' };
    }
  },

};

// -------------------------------------------------
// 공격 측 특성 적용
// -------------------------------------------------
function applyAttackTraits({ attackerCardId, defenderCardId, skillId, damage }) {
  const logs = [];

  const cardTrait = CARD_TRAITS[attackerCardId];
  if (cardTrait?.onHit) {
    const r = cardTrait.onHit({ attackerCardId, defenderCardId, damage });
    damage = r.damage;
    if (r.log) logs.push(r.log);
  }

  const skillTrait = SKILL_TRAITS[skillId];
  if (skillTrait?.onHit) {
    const r = skillTrait.onHit({ attackerCardId, defenderCardId, damage });
    damage = r.damage;
    if (r.log) logs.push(r.log);
  }

  return { damage, logs };
}

// -------------------------------------------------
// 수비 측 특성 적용 + 데미지 감소 버프 적용
// -------------------------------------------------
function applyDefenseTraits({ attackerCardId, defenderCardId, defenderSkillId, damage, defenderDmgReduce = 0 }) {
  const logs = [];

  // 스킬 특성 onReceive
  const skillTrait = SKILL_TRAITS[defenderSkillId];
  if (skillTrait?.onReceive) {
    const r = skillTrait.onReceive({ attackerCardId, defenderCardId, damage });
    damage = r.damage;
    if (r.log) logs.push(r.log);
  }

  // 데미지 감소 버프 (알맹이 내르지 마세요 등)
  if (defenderDmgReduce > 0) {
    const reduced = Math.floor(damage * (1 - defenderDmgReduce / 100));
    logs.push(`데미지 ${defenderDmgReduce}% 감소 적용 → ${reduced}`);
    damage = reduced;
  }

  return { damage, logs };
}

// -------------------------------------------------
// 적중 후 효과 (스턴, 디버프 등)
// -------------------------------------------------
async function applyAfterHitTraits({ pool, skillId, battleId, defenderId, battle, traitLogs }) {
  const skillTrait = SKILL_TRAITS[skillId];
  if (skillTrait?.afterHit) {
    const r = await skillTrait.afterHit({ pool, battleId, defenderId, battle });
    if (r?.log) traitLogs.push(r.log);
  }
}

// -------------------------------------------------
// 스킬 사용 시 효과 (onUse) — 합 결과 무관
// skillSelect.js에서 스킬 확정 시 호출
// -------------------------------------------------
async function applyOnUseTraits({ pool, skillId, battleId, userId, battle }) {
  const skillTrait = SKILL_TRAITS[skillId];
  if (skillTrait?.onUse) {
    const r = await skillTrait.onUse({ pool, battleId, userId, battle });
    return r?.log ?? null;
  }
  return null;
}

module.exports = {
  applyAttackTraits,
  applyDefenseTraits,
  applyAfterHitTraits,
  applyOnUseTraits,
  CARD_TRAITS,
  SKILL_TRAITS
};