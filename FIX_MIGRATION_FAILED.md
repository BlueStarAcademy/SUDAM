# Prisma 마이그레이션 실패 해결 방법

## 문제
Railway 배포 시 `0001_init_schema` 마이그레이션이 실패 상태로 표시되어 새로운 마이그레이션을 적용할 수 없습니다.

**현재 상황**: 배포가 "Pre-deploy command" 단계에서 실패하고 있습니다. 이 단계에서 `prisma migrate deploy`가 실행되며, 실패한 마이그레이션 때문에 중단됩니다.

## ⚡ 가장 빠른 해결 방법 (권장)

**Railway Settings에서 Pre-deploy Command 수정:**

1. Railway 대시보드 → **"Sudam1" 서비스** 선택
2. **"Settings"** 탭 클릭  
3. **"Deploy"** 섹션에서 **"Pre Deploy Command"** 또는 **"Pre-deploy Command"** 필드 찾기
4. 현재 값을 다음으로 변경:
   ```bash
   npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma || true && npx prisma migrate deploy --schema prisma/schema.prisma
   ```
5. 저장 후 배포 재시도

이 방법이 가장 빠르고 확실합니다!

## 해결 방법

### 방법 1: Railway Shell을 사용하여 SQL 실행 (가장 확실한 방법)

Railway의 Database 탭에는 직접 SQL을 실행할 수 있는 기능이 없습니다. Railway Shell을 사용해야 합니다.

1. Railway 대시보드에서 **배포된 서비스**(예: "Sudam1") 선택
   - 왼쪽 사이드바에서 "Sudam1" 서비스 클릭
   - 또는 PostgreSQL 서비스가 아니라 **애플리케이션 서비스**를 선택

2. **"Deployments"** 탭 클릭

3. 최신 배포 선택 (또는 실행 중인 배포)

4. **"Shell"** 탭 클릭 (또는 "Terminal" 탭)

5. Shell이 열리면 다음 명령 실행:
   ```bash
   # PostgreSQL에 연결 (DATABASE_URL 환경 변수 사용)
   psql $DATABASE_URL
   ```

6. PostgreSQL 프롬프트(`railway=#`)가 나타나면 다음 SQL 실행:
   ```sql
   -- 실패한 마이그레이션 상태 확인
   SELECT * FROM "_prisma_migrations" WHERE migration_name = '0001_init_schema';
   
   -- 실패한 마이그레이션을 해결
   UPDATE "_prisma_migrations" 
   SET finished_at = NOW(), 
       applied_steps_count = 1
   WHERE migration_name = '0001_init_schema' 
     AND finished_at IS NULL;
   
   -- 확인
   SELECT * FROM "_prisma_migrations" WHERE migration_name = '0001_init_schema';
   
   -- 종료
   \q
   ```

7. Shell에서 나온 후 배포를 다시 시도하면 마이그레이션이 정상적으로 진행됩니다.

### 방법 2: Connect 버튼을 사용하여 외부 클라이언트로 연결

1. Railway 대시보드 → PostgreSQL 서비스 → "Database" 탭
2. 우측 상단의 **"Connect"** 버튼 클릭
3. 연결 정보 복사 (예: `postgresql://postgres:password@postgres-production-f9af.up.railway.app:5432/railway`)
4. 로컬에서 PostgreSQL 클라이언트 사용:
   - **psql** (명령줄):
     ```bash
     psql "postgresql://postgres:password@postgres-production-f9af.up.railway.app:5432/railway"
     ```
   - 또는 **pgAdmin**, **DBeaver** 등 GUI 클라이언트 사용
5. 연결 후 SQL 실행:
   ```sql
   UPDATE "_prisma_migrations" 
   SET finished_at = NOW(), 
       applied_steps_count = 1
   WHERE migration_name = '0001_init_schema' 
     AND finished_at IS NULL;
   ```

### 방법 3: Railway CLI를 사용하여 마이그레이션 해결 (Railway 컨테이너 내부에서 실행)

**주의**: `railway run`은 로컬에서 실행되지만 Railway의 내부 네트워크 주소(`postgres.railway.internal`)는 Railway 컨테이너 내부에서만 접근 가능합니다. 따라서 이 방법은 Railway의 배포된 서비스 내부에서 실행해야 합니다.

1. Railway 대시보드에서 배포된 서비스 선택
2. "Settings" → "Deploy" 섹션에서 "Start Command"를 임시로 변경:
   ```
   npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma && npx prisma migrate deploy --schema prisma/schema.prisma && npm run start-server
   ```
3. 배포 후 다시 원래 start command로 변경

또는 Railway의 Shell 기능을 사용:
1. Railway 대시보드에서 서비스 선택
2. "Deployments" → 최신 배포 선택 → "Shell" 탭
3. 다음 명령 실행:
   ```bash
   npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma
   npx prisma migrate deploy --schema prisma/schema.prisma
   ```

### 방법 4: 마이그레이션 상태 초기화 (주의: 프로덕션에서는 신중하게)

만약 데이터베이스가 비어있거나 초기화해도 되는 경우:

1. Railway PostgreSQL에 연결
2. 다음 SQL 실행:
   ```sql
   -- 마이그레이션 테이블 초기화 (주의!)
   TRUNCATE TABLE "_prisma_migrations";
   ```
3. 다시 배포:
   ```bash
   railway run npx prisma migrate deploy --schema prisma/schema.prisma
   ```

### 방법 5: 로컬에서 공개 DATABASE_URL 사용 (임시)

만약 Railway PostgreSQL의 공개 연결 정보를 알고 있다면:

1. Railway 대시보드 → PostgreSQL 서비스 → "Variables" 탭에서 `DATABASE_URL` 확인
2. 공개 URL이 있다면 (예: `postgres-production-xxx.up.railway.app:5432`), 로컬에서 임시로 사용:
   ```bash
   # Windows PowerShell
   $env:DATABASE_URL="postgresql://user:password@postgres-production-xxx.up.railway.app:5432/railway"
   npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma
   ```

**주의**: 공개 URL은 보안상 권장하지 않으며, 사용 후 즉시 비활성화해야 합니다.

## 확인 사항

1. 데이터베이스 연결 확인:
   - Railway에서 `DATABASE_URL`이 올바르게 설정되어 있는지 확인
   - 내부 네트워크 주소 사용: `postgres.railway.internal:5432`

2. 마이그레이션 파일 확인:
   - `prisma/migrations/0001_init_schema/migration.sql` 파일이 올바른지 확인
   - 마이그레이션 SQL에 오류가 없는지 확인

3. 데이터베이스 상태 확인:
   - 테이블이 이미 생성되어 있는지 확인
   - `_prisma_migrations` 테이블의 상태 확인

## 권장 순서

1. **가장 확실한 방법**: 방법 1 (Railway Shell 사용) - **이 방법을 먼저 시도하세요!**
2. 방법 2 (Connect 버튼으로 외부 클라이언트 연결)
3. 그래도 안 되면 방법 4 (초기화) - 데이터 손실 주의!

## 현재 상황 해결

현재 로컬에서 `railway run`을 실행했지만 `postgres.railway.internal`에 접근할 수 없는 것은 정상입니다. 이 주소는 Railway 컨테이너 내부에서만 작동합니다.

**즉시 해결 방법**: 
1. Railway 대시보드 → **"Sudam1" 서비스** 선택
2. "Deployments" → 최신 배포 → **"Shell"** 탭
3. `psql $DATABASE_URL` 실행 후 위의 SQL 실행

