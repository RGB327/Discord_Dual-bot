// test/smoke.js
// 모든 command/battle 모듈이 문법 오류/require 오류 없이 로드되는지 검증하는 스모크 테스트.
// 실제 디스코드 연결이나 DB 연결 없이 CI에서 빠르게 돌리기 위한 최소한의 안전망.

const fs = require('fs');
const path = require('path');

let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${label}`);
    console.error(err.stack || err);
  }
}

console.log('commands/');
const commandsDir = path.join(__dirname, '..', 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  check(file, () => {
    const command = require(path.join(commandsDir, file));
    if (!command.data || typeof command.data.name !== 'string') {
      throw new Error('data.name 이 없습니다');
    }
    if (typeof command.execute !== 'function') {
      throw new Error('execute() 가 없습니다');
    }
  });
}

console.log('battle/');
const battleDir = path.join(__dirname, '..', 'battle');
for (const file of fs.readdirSync(battleDir).filter(f => f.endsWith('.js'))) {
  check(file, () => {
    require(path.join(battleDir, file));
  });
}

if (failed > 0) {
  console.error(`\n${failed}개 모듈 로드 실패`);
  process.exit(1);
}
console.log('\n모든 모듈 로드 성공');
