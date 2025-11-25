# Railway Pre-deploy 마이그레이션 실패 해결

## 현재 상황
- 마이그레이션이 "marked as applied"로 표시되었지만 **실제 테이블이 생성되지 않음**
- `prisma migrate resolve --applied`는 마이그레이션 상태만 변경하고 실제 SQL을 실행하지 않음
- 서버 시작 시 `The table 'public.User' does not exist` 오류 발생

## 해결 방법

### 방법 1: prisma db push 사용 (가장 빠르고 확실한 방법) ⭐ 권장

마이그레이션 히스토리 문제를 우회하고 스키마를 직접 적용합니다.

1. Railway 대시보드 → **"Sudam1" 서비스** 선택
2. **"Settings"** 탭 클릭
3. **"Deploy"** 섹션에서 **"Pre Deploy Command"** 또는 **"Pre-deploy Command"** 필드 찾기
4. 다음으로 변경:
   ```bash
   npx prisma db push --schema prisma/schema.prisma --accept-data-loss && npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma || true
   ```
   - `prisma db push`는 스키마를 직접 적용하여 테이블을 생성합니다
   - 그 다음 마이그레이션 상태를 "applied"로 업데이트합니다
5. 저장 후 배포 재시도

**이 방법이 가장 확실합니다!**

### 방법 2: 마이그레이션 상태 리셋 후 재실행

마이그레이션을 다시 실행하려면:

1. Railway Settings → Pre-deploy Command를 다음으로 변경:
   ```bash
   npx prisma migrate resolve --rolled-back 0001_init_schema --schema prisma/schema.prisma || true && npx prisma migrate deploy --schema prisma/schema.prisma
   ```
2. 저장 후 배포 재시도
3. **주의**: 이 방법은 마이그레이션이 실제로 실행되어야 합니다

### 방법 3: 마이그레이션 SQL 직접 실행 (스크립트 사용)

로컬에서 스크립트를 사용하여 마이그레이션 SQL을 직접 실행:

1. Railway의 PostgreSQL 공개 연결 정보 확인 (Settings → Variables → DATABASE_URL)
2. 로컬에서 임시로 DATABASE_URL 설정:
   ```bash
   # Windows PowerShell
   $env:DATABASE_URL="postgresql://user:password@postgres-production-xxx.up.railway.app:5432/railway"
   npm run prisma:migrate:apply-sql 0001_init_schema
   ```
3. 또는 Railway Shell에서 실행 (배포된 서비스의 Shell 사용)

### 방법 4: Railway Settings에서 Pre-deploy Command 수정 (db push 사용)

1. Railway Settings → Pre-deploy Command를 다음으로 변경:
   ```bash
   npx prisma db push --schema prisma/schema.prisma --accept-data-loss && npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma || true
   ```
2. 이렇게 하면 스키마를 직접 적용하고 마이그레이션 상태도 업데이트합니다

### 방법 2: Pre-deploy Command를 스크립트로 변경

1. `package.json`에 스크립트 추가:
   ```json
   "prisma:migrate:deploy:safe": "npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma || true && npx prisma migrate deploy --schema prisma/schema.prisma"
   ```

2. Railway Settings → Pre-deploy Command를 다음으로 변경:
   ```bash
   npm run prisma:migrate:deploy:safe
   ```

### 방법 3: Pre-deploy Command 제거 후 Start Command에 포함 (임시)

1. Railway Settings → Pre-deploy Command를 **비우거나 제거**
2. Start Command를 다음으로 변경:
   ```bash
   npx prisma migrate resolve --applied 0001_init_schema --schema prisma/schema.prisma || true && npx prisma migrate deploy --schema prisma/schema.prisma && npm run start-server
   ```
3. 배포 성공 후 다시 원래대로 복구

## 확인 방법

Railway 대시보드에서:
1. "Sudam1" 서비스 → "Settings" 탭
2. "Deploy" 섹션에서 "Pre Deploy Command" 또는 "Pre-deploy Command" 필드 확인
3. 현재 설정된 명령어 확인

## 주의사항

- `|| true`를 사용하면 실패한 마이그레이션이 이미 해결된 경우에도 계속 진행됩니다
- 한 번 해결되면 다음 배포부터는 원래 명령어로 되돌려도 됩니다

