# Supabase에서 Railway Postgres로 데이터 마이그레이션 가이드

## 개요
Supabase의 PostgreSQL 데이터베이스에서 Railway의 PostgreSQL로 데이터를 마이그레이션하는 방법입니다.

## 사전 준비

### 1. Railway Postgres 연결 정보 확인
1. Railway Dashboard → 프로젝트 선택
2. Postgres 서비스 선택
3. **Variables** 탭에서 `DATABASE_URL` 또는 `POSTGRES_URL` 확인
   - 예: `postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway`

### 2. Supabase 연결 정보 확인
1. Supabase Dashboard → **Settings** → **Database**
2. **Connection string** (Direct Connection) 복사
   - 예: `postgresql://postgres:password@db.xxx.supabase.co:5432/postgres`

## 마이그레이션 방법

### 방법 1: pg_dump + psql 사용 (권장)

#### 1단계: Supabase에서 데이터 덤프
```bash
# 로컬에서 실행
pg_dump "postgresql://postgres:YOUR_SUPABASE_PASSWORD@db.xxx.supabase.co:5432/postgres" \
  --schema=public \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  -f supabase_dump.sql
```

#### 2단계: Railway Postgres에 스키마 적용
```bash
# Prisma 마이그레이션으로 스키마 생성 (이미 되어있다면 스킵)
npx prisma migrate deploy --schema=prisma/schema.prisma
```

또는 Railway Postgres의 DATABASE_URL로 직접:
```bash
# Railway Postgres에 연결하여 마이그레이션 실행
DATABASE_URL="postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway" \
  npx prisma migrate deploy
```

#### 3단계: 데이터 덤프 파일 수정 (선택사항)
덤프 파일에서 Supabase 특정 설정을 제거할 수 있습니다:
- RLS 정책 관련 SQL 제거 (Railway에서는 필요 없을 수 있음)
- Supabase 특정 함수 제거

#### 4단계: Railway Postgres에 데이터 복원
```bash
# Railway Postgres에 데이터 복원
psql "postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway" \
  -f supabase_dump.sql
```

### 방법 2: Prisma + 직접 데이터 복사 (더 안전)

#### 1단계: Railway Postgres 스키마 준비
```bash
# Railway Postgres의 DATABASE_URL 설정
export RAILWAY_DB_URL="postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway"

# 마이그레이션 적용
DATABASE_URL=$RAILWAY_DB_URL npx prisma migrate deploy
```

#### 2단계: 데이터 마이그레이션 스크립트 작성
`scripts/migrate-to-railway.ts` 파일 생성 (아래 참고)

#### 3단계: 스크립트 실행
```bash
# Supabase에서 Railway로 데이터 복사
npm run migrate:to-railway
```

### 방법 3: pgAdmin 또는 DBeaver 사용 (GUI)

1. **pgAdmin/DBeaver에서 Supabase 연결**
   - Supabase Connection String 사용

2. **데이터베이스 백업**
   - pgAdmin: 우클릭 → **Backup**
   - DBeaver: 우클릭 → **Tools** → **Export Data**

3. **Railway Postgres 연결**
   - Railway Connection String 사용

4. **데이터베이스 복원**
   - pgAdmin: 우클릭 → **Restore**
   - DBeaver: 우클릭 → **Tools** → **Import Data**

## 주의사항

### 1. 다운타임 계획
- 마이그레이션 중에는 서비스 중단이 필요할 수 있습니다
- 가능하면 유지보수 시간대에 진행

### 2. 데이터 검증
마이그레이션 후 다음을 확인하세요:
```sql
-- 테이블 개수 확인
SELECT COUNT(*) FROM "User";
SELECT COUNT(*) FROM "UserInventory";
SELECT COUNT(*) FROM "LiveGame";
-- 등등...
```

### 3. 외래 키 및 제약 조건
- Prisma 마이그레이션으로 스키마를 먼저 생성하면 제약 조건이 자동으로 설정됩니다
- 데이터 복원 시 외래 키 순서를 고려해야 합니다

### 4. 인덱스
- Prisma 마이그레이션으로 인덱스가 자동 생성됩니다
- 데이터 복원 후 인덱스 재생성이 필요할 수 있습니다

### 5. 시퀀스 (Sequence)
- UUID를 사용하는 경우 시퀀스 문제는 없지만
- Auto-increment ID를 사용한다면 시퀀스를 업데이트해야 합니다:
```sql
SELECT setval('"User_id_seq"', (SELECT MAX(id::int) FROM "User"));
```

## 마이그레이션 후 작업

### 1. Railway 환경 변수 업데이트
Railway Dashboard → Backend 서비스 → **Variables**:
- `DATABASE_URL`을 Railway Postgres URL로 변경

### 2. 애플리케이션 재시작
Railway에서 서비스를 재시작하여 새로운 데이터베이스 연결 확인

### 3. 기능 테스트
- 로그인/회원가입
- 게임 시작/종료
- 인벤토리/장비
- 길드 기능
- 등등...

### 4. Supabase 백업 유지 (선택사항)
마이그레이션 후 일정 기간 Supabase 데이터를 백업으로 유지할 수 있습니다.

## 롤백 계획

문제가 발생하면:
1. Railway의 `DATABASE_URL`을 다시 Supabase로 변경
2. 서비스 재시작
3. 문제 해결 후 다시 마이그레이션 시도

## 성능 비교

Railway Postgres 사용 시 예상 개선사항:
- **지연 시간 감소**: Railway와 Backend가 같은 네트워크에 있으면 더 빠름
- **연결 풀링**: Railway Postgres는 더 나은 연결 관리 제공
- **리소스 제어**: Railway에서 Postgres 리소스를 직접 관리 가능

## 추가 리소스

- [Prisma Migrate Guide](https://www.prisma.io/docs/guides/migrate)
- [PostgreSQL pg_dump Documentation](https://www.postgresql.org/docs/current/app-pgdump.html)
- [Railway Postgres Documentation](https://docs.railway.app/databases/postgresql)

