# 지금 바로 마이그레이션 실행하기

## 확인된 연결 정보

✅ **Railway Postgres URL (직접 연결):**
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
```

✅ **Railway Postgres URL (공개 연결 - 외부 접근용):**
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway
```

✅ **Supabase URL:**
```
postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres
```

## 실행 명령어 (PowerShell)

```powershell
# 1. 환경 변수 설정
$env:SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# Railway Postgres URL (공개 연결 사용 - 외부 접근 가능)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"

# 2. Railway Postgres에 스키마 적용
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy

# 3. 데이터 마이그레이션 실행
npm run migrate:to-railway
```

**참고**: 직접 연결이 안 되면 `DATABASE_PUBLIC_URL` (turntable.proxy.rlwy.net)을 사용하세요.

## 실행 명령어 (Bash/Linux/Mac)

```bash
# 1. 환경 변수 설정
export SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"
export RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway"

# 2. Railway Postgres에 스키마 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy

# 3. 데이터 마이그레이션 실행
npm run migrate:to-railway
```

## 마이그레이션 후 필수 작업

### Railway Backend 환경 변수 업데이트

1. **Railway Dashboard** → **Sudam1** 서비스 선택
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. **편집** 클릭
5. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
   ```
6. **Save** 클릭
7. 서비스가 자동으로 재시작됩니다

## 예상 소요 시간

- 스키마 적용: 1-2분
- 데이터 마이그레이션: 5-10분 (44명의 사용자 기준)
- 총 소요 시간: 약 10-15분

## 진행 상황 확인

마이그레이션 스크립트가 실행되면:
- 각 단계별 진행 상황이 표시됩니다
- 데이터 개수가 표시됩니다
- 완료 시 검증 결과가 표시됩니다

## 문제 해결

### "Can't reach database server" 오류
→ Railway Postgres는 외부 접근이 제한될 수 있습니다. 다음을 시도하세요:

**방법 1: DATABASE_PUBLIC_URL 사용 (권장)**
```powershell
# 공개 연결 URL 사용 (SSL 파라미터 포함)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy
```

**방법 2: Railway CLI 사용**
```powershell
# Railway CLI 설치
npm install -g @railway/cli

# Railway에 로그인 및 프로젝트 연결
railway login
railway link

# Railway 환경에서 실행
railway run npm run prisma:migrate:deploy
```

### "relation does not exist" 오류
→ 2단계(스키마 적용)가 완료되지 않았을 수 있습니다. 다시 실행:
```powershell
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy
```

### "connection refused" 오류
→ Railway Postgres가 실행 중인지 확인하세요. Railway Dashboard에서 Postgres 서비스 상태를 확인하세요.

### Prisma 클라이언트 오류
→ Prisma 클라이언트를 먼저 생성:
```bash
npm run prisma:generate
```

## 마이그레이션 완료 후 확인

1. **Railway Dashboard** → **Sudam1** → **Logs** 확인
   - `[DB] Database initialized successfully` 메시지 확인
   - Supabase 연결 오류가 사라졌는지 확인

2. **기능 테스트**
   - 로그인/회원가입
   - 게임 시작
   - 인벤토리 확인

## 롤백 방법

문제 발생 시:
1. Railway Dashboard → Sudam1 → Variables
2. `DATABASE_URL`을 Supabase URL로 되돌리기:
   ```
   postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres
   ```
3. 서비스 재시작

