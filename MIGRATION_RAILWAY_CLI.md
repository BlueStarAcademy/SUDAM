# Railway CLI를 사용한 마이그레이션 (권장)

Railway Postgres는 외부 접근이 제한되어 있어, Railway CLI를 사용하여 Railway 환경 내에서 마이그레이션을 실행하는 것이 가장 안전합니다.

## 1단계: Railway CLI 설치 및 로그인

```powershell
# Railway CLI 설치
npm install -g @railway/cli

# Railway에 로그인
railway login

# 프로젝트 연결 (capable-harmony 프로젝트)
railway link
```

## 2단계: Prisma 클라이언트 생성

```powershell
# 로컬에서 Prisma 클라이언트 생성
npm run prisma:generate
```

## 3단계: Railway 환경에서 마이그레이션 실행

### 방법 A: Railway 환경에서 직접 실행

```powershell
# Railway 환경에서 Prisma 마이그레이션 실행
railway run npm run prisma:migrate:deploy
```

### 방법 B: 환경 변수 설정 후 실행

```powershell
# Supabase URL 설정 (Railway 환경 변수로 추가)
railway variables set SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# Railway 환경에서 마이그레이션 스크립트 실행
railway run npm run migrate:to-railway
```

## 4단계: Railway Backend 환경 변수 업데이트

Railway Dashboard에서:
1. **Sudam1** 서비스 → **Variables**
2. `DATABASE_URL` 찾기
3. Railway Postgres URL로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
   ```
   또는 Railway 내부 네트워크 사용:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```

## 대안: Railway Dashboard에서 직접 실행

Railway Dashboard를 통해 마이그레이션을 실행할 수도 있습니다:

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Settings** → **Deploy**
3. **Build Command** 수정:
   ```
   npm run prisma:generate && npm run prisma:migrate:deploy && npm run start-server
   ```
4. 서비스 재배포

## 문제 해결

### "Authentication failed" 오류
→ Railway Postgres는 외부 접근이 제한되어 있습니다. Railway CLI를 사용하거나 Railway 내부 네트워크를 통해 접근해야 합니다.

### "Cannot find module" 오류
→ Prisma 클라이언트를 먼저 생성:
```powershell
npm run prisma:generate
```

### Railway CLI 연결 오류
→ Railway에 로그인되어 있는지 확인:
```powershell
railway whoami
```

