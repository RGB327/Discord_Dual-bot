# Discord Card Battle Bot

카드 수집 + 턴제 대결 시스템을 갖춘 디스코드 봇. 유저가 카드를 모으고, 매칭을 통해 다른 유저와 스킬 기반 턴제 전투를 벌입니다.

## 명령어

| 명령어 | 설명 |
|---|---|
| `/등록` | 유저 등록 및 기본 코스트 지급 |
| `/매칭` | 대결 매칭 방 생성 |
| `/매칭취소` | 대기 중인 매칭 취소 |
| `/내카드` | 보유 카드 조회 |
| `/내스킬` | 전투 중 보유 스킬 조회 |
| `/상점` | 카드 상점 조회/구매 |
| `/관전` | 진행 중인 전투 관전 |
| `/관전취소` | 관전 취소 |

전투가 시작되면 이후 진행(스킬 선택, 턴 종료, 항복 등)은 슬래시 명령어가 아니라 DM으로 전송되는 버튼/셀렉트 메뉴로 이루어집니다.

## 프로젝트 구조

```
commands/    슬래시 명령어
battle/      전투 로직 (매칭 성사 후 DM 기반 진행)
db.js        mysql2 커넥션 풀
index.js     봇 진입점 (이벤트 리스너 등록, 로그인)
command.js   슬래시 명령어를 디스코드에 등록하는 스크립트
schema.sql   DB 스키마
```

## 로컬 실행

### 요구 사항
- Node.js 20+
- MySQL (또는 호환 DB)

### 설정
`.env.example`을 `.env`로 복사하고 값을 채웁니다.

```
DISCORD_TOKEN=   # 디스코드 봇 토큰
CLIENT_ID=       # 애플리케이션 ID
GUILD_ID=        # 테스트용 길드 ID

DB_HOST=127.0.0.1
DB_PORT=3300
DB_USER=root
DB_PASSWORD=
DB_NAME=Cards
```

### 실행

```bash
npm install
node command.js   # 슬래시 명령어를 길드에 등록 (최초 1회, 명령어 변경 시마다)
node index.js      # 봇 실행
```

### Docker

```bash
docker compose up -d --build
```

`docker-compose.yml`은 같은 디렉토리의 `.env` 파일 값을 그대로 컨테이너 환경변수로 주입합니다. 외부 네트워크 `discord_bot`이 미리 생성되어 있어야 합니다 (`docker network create discord_bot`), DB 컨테이너도 같은 네트워크에 있어야 합니다.

## 테스트

```bash
npm test
```

`test/smoke.js`가 `commands/`, `battle/`의 모든 모듈을 실제로 require해서 문법 오류나 로드 오류가 없는지 검증합니다. 실제 디스코드 연결이나 DB 연결은 필요 없습니다.

## CI/CD

`.github/workflows/CICD.yml` 참고. `main`에 push/PR 시 테스트가 돌고, `main` push가 테스트를 통과하면 SSH로 배포 서버에 접속해 `git pull` 후 `docker compose up -d --build`로 재배포합니다.

### GitHub Secrets 설정

저장소 → **Settings → Secrets and variables → Actions → New repository secret** 에서 아래 4개를 등록합니다.

| 이름 | 값 |
|---|---|
| `SSH_HOST` | 배포 서버 IP 또는 도메인 |
| `SSH_USERNAME` | 서버 SSH 계정명 |
| `SSH_PASSWORD` | 해당 계정의 SSH 로그인 비밀번호 |
| `DEPLOY_PATH` | 서버에 이 저장소가 clone된 절대 경로 (예: `/home/유저명/discord_bot`) |

4개를 모두 등록하면 다음 `main` push부터 CI 통과 시 자동 배포됩니다. Actions 탭에서 실행 로그를 확인할 수 있습니다.

> 참고: 비밀번호 인증은 SSH 키 인증보다 무차별 대입 공격에 약합니다. 서버에서 `fail2ban` 등으로 로그인 시도를 제한하거나, 여유가 될 때 키 인증으로 전환하는 걸 권장합니다.
