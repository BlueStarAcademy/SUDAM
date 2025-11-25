# Railway 마이그레이션 문제 해결

## 문제
Railway CLI가 Postgres 서비스에 연결되어 있지만, Railway는 서비스 간 연결을 통해 `DATABASE_URL`을 자동으로 설정합니다. **Sudam1 서비스**에서 실행해야 합니다.

## 해결 방법

### 방법 1: Sudam1 서비스에 연결 (권장)

```powershell
# Sudam1 서비스에 연결
railway link

# 서비스 선택 시 "Sudam1" 선택
# Railway가 자동으로 Postgres와의 연결을 통해 DATABASE_URL을 설정합니다

# Railway 환경에서 마이그레이션 실행
railway run npm run prisma:migrate:deploy
```

### 방법 2: Railway 환경 변수 직접 확인 및 사용

```powershell
# Railway 환경 변수 확인
railway variables

# DATABASE_URL이 자동으로 설정되어 있는지 확인
# Railway는 Postgres 서비스와 연결된 서비스에 자동으로 DATABASE_URL을 설정합니다

# Railway 환경에서 실행 (DATABASE_URL 자동 사용)
railway run npm run prisma:migrate:deploy
```

### 방법 3: Railway Dashboard에서 직접 실행

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Settings** → **Deploy**
3. **Build Command**에 마이그레이션 추가:
   ```
   npm run prisma:generate && npm run prisma:migrate:deploy && npm run start-server
   ```
4. 서비스 재배포

또는 **Deployments** 탭에서 **Redeploy** 클릭

## Railway 서비스 간 연결 확인

Railway Dashboard에서:
1. **Sudam1** 서비스 → **Variables** 탭
2. `DATABASE_URL`이 자동으로 설정되어 있는지 확인
3. 값이 `postgres.railway.internal` 또는 `postgres-production-f9af.up.railway.app`를 포함하는지 확인

## 올바른 실행 순서

```powershell
# 1. Prisma 클라이언트 생성 (로컬)
npm run prisma:generate

# 2. Railway에 로그인
railway login

# 3. Sudam1 서비스에 연결
railway link
# → "Sudam1" 서비스 선택

# 4. Railway 환경에서 마이그레이션 실행
railway run npm run prisma:migrate:deploy

# 5. 데이터 마이그레이션 (Supabase URL 필요)
railway variables set SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"
railway run npm run migrate:to-railway
```

## Railway 환경 변수 확인

```powershell
# Railway 환경 변수 목록 확인
railway variables

# 특정 변수 확인
railway variables get DATABASE_URL
```

## 참고

- Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL` 환경 변수를 설정합니다
- 이 변수는 Railway 내부 네트워크를 통해 접근하므로 외부에서 직접 접근할 수 없습니다
- `railway run`을 사용하면 Railway의 환경 변수가 자동으로 전달됩니다

