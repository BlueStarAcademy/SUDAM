# Railway Postgres 마이그레이션 실행 단계

## 현재 상황
- Railway Backend가 여전히 Supabase를 사용하려고 시도 중
- `Can't reach database server at aws-1-ap-northeast-2.pooler.supabase.com:6543` 오류 발생

## 해결 방법: Railway Postgres로 전환

### 1단계: Railway Postgres 연결 정보 확인

1. **Railway Dashboard 접속**
   - https://railway.app/dashboard
   - 프로젝트 선택

2. **Postgres 서비스 찾기**
   - Postgres 서비스 클릭
   - **Variables** 탭 클릭
   - `DATABASE_URL` 또는 `POSTGRES_URL` 복사
   - 예: `postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway`

### 2단계: Supabase 연결 정보 확인

1. **Supabase Dashboard 접속**
   - https://supabase.com/dashboard
   - 프로젝트 선택

2. **Database 연결 정보 확인**
   - **Settings** → **Database**
   - **Connection string** (Direct Connection) 복사
   - 예: `postgresql://postgres:password@db.xxx.supabase.co:5432/postgres`

### 3단계: 로컬에서 마이그레이션 실행

#### 옵션 A: 자동 스크립트 사용 (권장)

```bash
# 1. 환경 변수 설정
export SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"
export RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@containers-us-west-xxx.railway.app:5432/railway"

# 2. Railway Postgres에 스키마 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy

# 3. 데이터 마이그레이션 실행
npm run migrate:to-railway
```

#### 옵션 B: pg_dump 사용 (대용량 데이터)

```bash
# 1. Supabase에서 덤프
pg_dump "$SUPABASE_DATABASE_URL" \
  --schema=public \
  --no-owner \
  --no-acl \
  --clean \
  -f supabase_dump.sql

# 2. Railway Postgres에 스키마 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy

# 3. 데이터 복원
psql "$RAILWAY_DATABASE_URL" -f supabase_dump.sql
```

### 4단계: Railway Backend 환경 변수 업데이트

1. **Railway Dashboard** → Backend 서비스 선택
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. **편집** 클릭
5. Railway Postgres URL로 변경:
   ```
   postgresql://postgres:비밀번호@containers-us-west-xxx.railway.app:5432/railway
   ```
6. **Save** 클릭
7. 서비스가 자동으로 재시작됩니다

### 5단계: 데이터 검증

Railway Dashboard → Backend 서비스 → **Logs**에서 다음을 확인:

✅ 성공적인 연결:
```
[DB] Database initialized successfully
```

❌ 오류가 있다면:
```
Can't reach database server at ...
```

### 6단계: 기능 테스트

1. 로그인/회원가입 테스트
2. 게임 시작 테스트
3. 인벤토리 확인
4. 장비 장착 확인

## 문제 해결

### 오류: "relation does not exist"
→ Railway Postgres에 마이그레이션을 먼저 적용하세요:
```bash
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy
```

### 오류: "connection refused"
→ Railway Postgres 연결 정보를 확인하세요. Railway Dashboard에서 최신 URL을 복사하세요.

### 마이그레이션 스크립트 실행 오류
→ Prisma 클라이언트가 생성되었는지 확인:
```bash
npm run prisma:generate
```

## 롤백 방법

문제가 발생하면:
1. Railway Backend의 `DATABASE_URL`을 다시 Supabase URL로 변경
2. 서비스 재시작
3. 문제 해결 후 다시 시도

## 다음 단계

마이그레이션이 완료되면:
- Supabase는 백업으로 유지 (선택사항)
- Railway Postgres 메트릭 모니터링
- 성능 개선 확인

