# Railway 내부 네트워크 사용

## 문제
Railway Postgres는 외부에서 직접 접근할 수 없고, Railway 내부 네트워크를 통해서만 접근 가능합니다.

## 해결 방법

### 방법 1: Railway 내부 호스트 사용

Railway Dashboard에서 확인한 `PGHOST` 값(`postgres.railway.internal`)을 사용:

```powershell
railway variables --set "DATABASE_URL=postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway"
```

### 방법 2: Railway 자동 연결 사용

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL`을 설정합니다. 

Railway Dashboard에서:
1. **Sudam1** 서비스 → **Variables**
2. `DATABASE_URL`이 자동으로 설정되어 있는지 확인
3. 값이 `postgres.railway.internal` 또는 Railway Postgres를 가리키는지 확인

### 방법 3: Railway Dashboard에서 직접 확인

Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL`이 자동으로 설정되어 있을 수 있음
- Railway가 Postgres 서비스와 연결을 감지하면 자동으로 설정됨
- 값이 `postgresql://postgres:...@postgres.railway.internal:5432/railway` 형식일 수 있음

## 확인 방법

```powershell
# Railway 환경 변수 확인
railway variables

# DATABASE_URL 값 확인
railway variables | findstr DATABASE_URL
```

## 대안: Railway Dashboard에서 직접 설정

Railway Dashboard에서 직접 확인하고 설정하는 것이 가장 확실합니다:

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` 확인
3. 값이 Railway Postgres를 가리키는지 확인
4. 필요하면 편집하여 Railway Postgres URL로 설정

