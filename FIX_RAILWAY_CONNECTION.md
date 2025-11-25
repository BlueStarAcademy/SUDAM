# Railway Postgres 연결 문제 해결

## 문제
```
Error: P1001: Can't reach database server at `postgres-production-f9af.up.railway.app:5432`
```

## 해결 방법

### 방법 1: DATABASE_PUBLIC_URL 사용 (권장)

Railway의 `DATABASE_PUBLIC_URL`은 외부 접근을 위해 설계되었습니다:

```powershell
# DATABASE_PUBLIC_URL 사용 (Railway Dashboard에서 확인)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway"

# SSL 파라미터 추가
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"

# 스키마 적용
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy
```

### 방법 2: SSL 파라미터 추가

직접 연결 URL에 SSL 파라미터를 추가:

```powershell
# SSL 파라미터 추가
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway?sslmode=require"

# 스키마 적용
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy
```

### 방법 3: Railway CLI 사용 (가장 안전)

Railway 환경 내에서 직접 실행:

```powershell
# Railway CLI 설치 (아직 없다면)
npm install -g @railway/cli

# Railway에 로그인
railway login

# 프로젝트 연결
railway link

# Railway 환경에서 마이그레이션 실행
railway run --service postgres npm run prisma:migrate:deploy
```

### 방법 4: Railway에서 직접 실행

Railway Dashboard를 통해 실행:

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Deployments** 탭
3. **New Deployment** 또는 **Redeploy**
4. 배포 시 환경 변수에 `DATABASE_URL` 설정
5. 배포 후 Railway 환경에서 마이그레이션 실행

또는:

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Settings** → **Deploy**
3. **Build Command**에 마이그레이션 추가:
   ```
   npm run prisma:migrate:deploy && npm run start-server
   ```

## 확인 사항

### Railway Postgres 상태 확인
1. Railway Dashboard → Postgres 서비스
2. 서비스가 **Running** 상태인지 확인
3. **Metrics** 탭에서 연결 상태 확인

### 네트워크 제한 확인
Railway Postgres는 기본적으로 외부 접근을 제한할 수 있습니다. `DATABASE_PUBLIC_URL`을 사용하거나 Railway 내부 네트워크를 통해 접근해야 합니다.

## 권장 순서

1. **먼저 시도**: `DATABASE_PUBLIC_URL` 사용 (방법 1)
2. **안 되면**: SSL 파라미터 추가 (방법 2)
3. **여전히 안 되면**: Railway CLI 사용 (방법 3)

