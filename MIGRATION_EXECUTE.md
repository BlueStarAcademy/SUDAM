# 마이그레이션 실행 가이드

## 빠른 실행 (로컬에서)

### Windows (PowerShell)

```powershell
# 1. 환경 변수 설정
$env:SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"
$env:RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@containers-us-west-xxx.railway.app:5432/railway"

# 2. Railway Postgres에 스키마 적용
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL; npm run prisma:migrate:deploy

# 3. 데이터 마이그레이션 실행
npm run migrate:to-railway
```

### Linux/Mac

```bash
# 1. 환경 변수 설정
export SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"
export RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@containers-us-west-xxx.railway.app:5432/railway"

# 2. Railway Postgres에 스키마 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy

# 3. 데이터 마이그레이션 실행
npm run migrate:to-railway
```

## Railway에서 직접 실행 (대안)

Railway CLI를 사용하여 Railway 환경에서 직접 실행할 수 있습니다:

```bash
# Railway CLI 설치 (아직 없다면)
npm i -g @railway/cli

# Railway에 로그인
railway login

# 프로젝트 선택
railway link

# 환경 변수 설정 및 마이그레이션 실행
railway run --service backend bash -c "
  export SUPABASE_DATABASE_URL='postgresql://...'
  export RAILWAY_DATABASE_URL='postgresql://...'
  DATABASE_URL=\$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy
  npm run migrate:to-railway
"
```

## 연결 정보 확인 방법

### Railway Postgres URL 확인
1. Railway Dashboard → 프로젝트 선택
2. Postgres 서비스 클릭
3. **Variables** 탭
4. `DATABASE_URL` 또는 `POSTGRES_URL` 복사

### Supabase URL 확인
1. Supabase Dashboard → 프로젝트 선택
2. **Settings** → **Database**
3. **Connection string** (Direct Connection) 복사

## 마이그레이션 후 작업

### 1. Railway Backend 환경 변수 업데이트

1. Railway Dashboard → Backend 서비스
2. **Variables** 탭
3. `DATABASE_URL` 찾기
4. Railway Postgres URL로 변경
5. 저장 (서비스 자동 재시작)

### 2. 연결 확인

Railway Dashboard → Backend → **Logs**에서 확인:
```
[DB] Database initialized successfully
```

오류가 있다면:
```
Can't reach database server at ...
```

## 예상 소요 시간

- 데이터가 적은 경우 (44명): 약 5-10분
- 네트워크 속도에 따라 달라질 수 있음

## 문제 해결

### "relation does not exist" 오류
→ Railway Postgres에 마이그레이션을 먼저 적용:
```bash
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy
```

### "connection refused" 오류
→ Railway Postgres 연결 정보 확인 (Railway Dashboard에서 최신 URL 복사)

### Prisma 클라이언트 오류
→ Prisma 클라이언트 생성:
```bash
npm run prisma:generate
```

## 추가 참고사항

### 배포 로그의 다른 문제들

1. **KataGo 모델 다운로드 실패 (HTTP 403)**
   - 별도 문제로, 데이터베이스 마이그레이션과는 무관
   - KataGo HTTP API를 사용하거나 모델을 수동으로 배포해야 함

2. **인벤토리 초기화 경고**
   - `[DB] CRITICAL: updateUser would clear inventory`
   - 데이터베이스 연결 문제로 인한 것일 수 있음
   - 마이그레이션 후 해결될 가능성이 높음

## 롤백

문제 발생 시:
1. Railway Backend의 `DATABASE_URL`을 Supabase URL로 되돌리기
2. 서비스 재시작
3. 문제 해결 후 다시 시도

