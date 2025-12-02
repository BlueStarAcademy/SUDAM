# Railway 배포 체크리스트

이 문서는 Railway에 배포하기 전에 확인해야 할 사항들을 정리한 체크리스트입니다.

## 필수 환경 변수

### 데이터베이스 연결

**DATABASE_URL** (필수)
- Railway PostgreSQL 서비스를 사용하는 경우:
  - Railway 대시보드 → Postgres 서비스 → Variables → `DATABASE_URL` 복사
  - 내부 네트워크 사용 권장: `postgresql://postgres:password@postgres.railway.internal:5432/railway`
  - 공개 URL도 사용 가능하지만 성능이 낮을 수 있음: `postgresql://postgres:password@postgres-production-xxx.up.railway.app:5432/railway`
- 외부 데이터베이스 사용 시:
  - 연결 문자열 형식: `postgresql://user:password@host:port/database`
  - SSL이 필요한 경우: `?sslmode=require` 추가

**확인 방법:**
```bash
# Railway CLI로 확인
railway variables

# 또는 Railway 대시보드에서 확인
# 서비스 → Variables 탭
```

### 기본 설정

**NODE_ENV** (필수)
- 값: `production`
- Railway에서 자동으로 설정될 수 있지만, 명시적으로 설정 권장

**PORT** (자동 설정됨)
- Railway가 자동으로 제공하는 환경 변수
- 기본값: `4000` (Railway가 제공하지 않는 경우)
- 수동 설정 불필요 (Railway가 자동 관리)

**FRONTEND_URL** (권장)
- 프론트엔드 도메인 URL
- 이메일 인증 링크 등에 사용
- 예: `https://your-app.railway.app`
- 설정하지 않으면 일부 기능이 제한될 수 있음

## 선택적 환경 변수

### 이메일 서비스

**방법 1: AWS SES 사용 (권장)**
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
EMAIL_FROM=noreply@yourdomain.com
```

**방법 2: SMTP 사용 (개발/대안)**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

**참고:** Gmail 사용 시:
1. Google 계정 → 보안 → 2단계 인증 활성화
2. 앱 비밀번호 생성
3. 생성된 비밀번호를 `SMTP_PASS`에 사용

### 카카오 로그인

```
KAKAO_CLIENT_ID=your-kakao-client-id
KAKAO_CLIENT_SECRET=your-kakao-client-secret
KAKAO_REDIRECT_URI=https://your-app.railway.app/auth/kakao/callback
```

**설정 방법:**
1. [Kakao Developers](https://developers.kakao.com) 접속
2. 애플리케이션 생성
3. 플랫폼 설정 → Web 플랫폼 추가
4. Redirect URI 등록: `https://your-app.railway.app/auth/kakao/callback`
5. 환경 변수 설정

### KataGo 설정 (선택적)

KataGo는 CPU 모드로 실행되며, Railway에서 제한적입니다.

```
KATAGO_PATH=/app/katago/katago
KATAGO_MODEL_PATH=/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
KATAGO_HOME_PATH=/app/katago-home
KATAGO_NUM_ANALYSIS_THREADS=4
KATAGO_NUM_SEARCH_THREADS=8
KATAGO_MAX_VISITS=500
KATAGO_NN_MAX_BATCH_SIZE=8
```

**참고:** KataGo는 Dockerfile에서 자동으로 다운로드되므로 경로만 확인하면 됩니다.

## Railway 대시보드 설정

### 1. 서비스 설정 확인

**Settings 탭:**
- Root Directory: `/` (프로젝트 루트)
- Dockerfile Path: `Dockerfile.backend` (자동 감지됨)
- Start Command: `npm run start-server` (railway.json에서 설정됨)

### 2. 네트워킹 설정

**Settings → Networking:**
- Public Domain 생성 (필요한 경우)
- Custom Domain 연결 (선택적)

### 3. 리소스 설정

**Settings → Resources:**
- CPU: 최대 설정 권장 (32 vCPU)
- Memory: 최대 설정 권장 (32 GB)
- **참고:** 무료 플랜에서는 제한이 있을 수 있음

### 4. 헬스체크 설정

**Settings → Health Check:**
- Path: `/api/health` (railway.json에서 설정됨)
- Timeout: 30초 (railway.json에서 설정됨)
- Interval: 60초 (railway.json에서 설정됨)

### 5. 재시작 정책

**Settings → Restart Policy:**
- `ON_FAILURE` (railway.json에서 설정됨)
- 크래시 시 자동 재시작

## 배포 전 확인 사항

### 코드 레벨 확인

- [ ] `railway.json` 파일이 올바르게 설정되어 있는지 확인
- [ ] `Dockerfile.backend`가 올바른 경로에 있는지 확인
- [ ] `package.json`의 `start-server` 스크립트가 올바른지 확인

### 환경 변수 확인

- [ ] `DATABASE_URL`이 설정되어 있는지 확인
- [ ] `NODE_ENV=production`이 설정되어 있는지 확인
- [ ] `FRONTEND_URL`이 설정되어 있는지 확인 (권장)
- [ ] 필요한 선택적 환경 변수가 설정되어 있는지 확인

### 데이터베이스 확인

- [ ] Railway PostgreSQL 서비스가 실행 중인지 확인
- [ ] `DATABASE_URL`이 Railway 내부 네트워크를 사용하는지 확인 (권장)
- [ ] Prisma 마이그레이션이 적용되었는지 확인

### 빌드 확인

- [ ] Dockerfile이 올바르게 빌드되는지 확인
- [ ] 프론트엔드 빌드(`dist` 디렉토리)가 생성되는지 확인
- [ ] Prisma 클라이언트가 생성되는지 확인

## 배포 후 확인 사항

### 로그 확인

**Railway Dashboard → 서비스 → Logs:**
- [ ] 서버가 정상적으로 시작되었는지 확인
- [ ] `[Server] Server listening on port: X` 메시지 확인
- [ ] `[Server] Railway environment auto-detected` 메시지 확인
- [ ] 데이터베이스 연결 성공 메시지 확인
- [ ] 에러나 경고 메시지가 없는지 확인

### 헬스체크 확인

**Railway Dashboard → 서비스 → Metrics:**
- [ ] 헬스체크가 성공하는지 확인 (200 응답)
- [ ] CPU 사용량이 정상 범위인지 확인
- [ ] 메모리 사용량이 정상 범위인지 확인
- [ ] Request Error Rate가 낮은지 확인

### API 테스트

- [ ] `/api/health` 엔드포인트가 응답하는지 확인
- [ ] `/api/auth/login` 엔드포인트가 작동하는지 확인
- [ ] WebSocket 연결(`/ws`)이 작동하는지 확인

## 문제 해결

### 서버가 시작되지 않는 경우

1. **로그 확인:**
   - Railway Dashboard → 서비스 → Logs
   - 에러 메시지 확인

2. **환경 변수 확인:**
   - `DATABASE_URL`이 올바르게 설정되어 있는지 확인
   - 필수 환경 변수가 모두 설정되어 있는지 확인

3. **빌드 확인:**
   - Dockerfile이 올바르게 빌드되는지 확인
   - 빌드 로그에서 에러 확인

### 데이터베이스 연결 실패

1. **DATABASE_URL 확인:**
   - Railway 대시보드에서 Postgres 서비스의 `DATABASE_URL` 복사
   - Backend 서비스의 Variables에 설정

2. **내부 네트워크 사용:**
   - `postgres.railway.internal:5432` 사용 권장
   - 공개 URL 대신 내부 네트워크 사용 시 성능 향상

3. **연결 풀링 확인:**
   - `server/prismaClient.ts`에서 연결 풀링 설정 확인
   - Railway 환경에서는 `connection_limit=100` 권장

### 메모리 부족

1. **리소스 증가:**
   - Railway Dashboard → Settings → Resources
   - Memory를 최대로 설정

2. **캐시 크기 조정:**
   - `server/gameCache.ts`에서 캐시 크기 확인
   - Railway 환경에서는 더 작은 캐시 크기 사용

### 헬스체크 실패

1. **헬스체크 경로 확인:**
   - `/api/health` 엔드포인트가 올바르게 설정되어 있는지 확인
   - `railway.json`의 `healthcheckPath` 확인

2. **타임아웃 조정:**
   - `railway.json`의 `healthcheckTimeout` 확인
   - 필요시 증가 (기본값: 30초)

## 자동 감지 기능

앱은 다음 환경 변수를 자동으로 감지하여 Railway 환경으로 인식합니다:

- `RAILWAY_ENVIRONMENT_NAME`
- `RAILWAY_SERVICE_NAME`
- `RAILWAY_PROJECT_NAME`
- `DATABASE_URL`에 `railway` 포함

이 중 하나라도 감지되면 `RAILWAY_ENVIRONMENT=true`로 자동 설정됩니다.

## 추가 리소스

- [Railway 공식 문서](https://docs.railway.app)
- [Prisma 배포 가이드](https://www.prisma.io/docs/guides/deployment)
- [Node.js 프로덕션 모범 사례](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
