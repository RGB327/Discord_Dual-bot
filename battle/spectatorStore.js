// battle/spectatorStore.js

// 매칭 대기 중 관전자: hostId → Set<userId>
const pendingSpectators = new Map();

// 전투 중 관전자: battleId → Set<userId>
const battleSpectators = new Map();

module.exports = { pendingSpectators, battleSpectators };
