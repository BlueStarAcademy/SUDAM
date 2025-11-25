# Railway Postgres 인증 오류 해결

## 문제
Railway Postgres 인증 실패 - `DATABASE_URL` 설정 문제

## 해결 방법

### 방법 1: Railway 자동 연결 사용 (권장)

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL`을 설정합니다.

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` 찾기
3. **삭제** 또는 **편집**
4. Railway가 자동으로 설정한 값을 사용하거나, Railway Postgres Variables에서 올바른 값을 확인

### 방법 2: Railway Postgres Variables 확인

Railway Dashboard → **Postgres** 서비스 → **Variables**에서:
- `POSTGRES_PASSWORD` 확인
- `POSTGRES_USER` 확인 (보통 `postgres`)
- `PGDATABASE` 확인 (보통 `railway`)

### 방법 3: Railway 내부 네트워크 사용

Railway 서비스 내부에서는 `postgres.railway.internal`을 사용해야 합니다:

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` 편집
3. 다음 형식으로 설정:
   ```
   postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway
   ```
   (비밀번호는 Postgres 서비스의 Variables에서 확인)

### 방법 4: Railway 서비스 연결 확인

Railway Dashboard에서:
1. **Sudam1** 서비스 확인
2. Postgres 서비스와 연결되어 있는지 확인
3. 연결되어 있으면 Railway가 자동으로 `DATABASE_URL`을 설정해야 함

## 빠른 해결

Railway Dashboard에서:
1. **Sudam1** → **Variables**
2. `DATABASE_URL` **삭제** (Railway가 자동으로 설정하도록)
3. 또는 Railway Postgres Variables의 `POSTGRES_PASSWORD`를 사용하여 올바른 URL 설정

## 확인

Railway Dashboard → Postgres → Variables에서:
- `POSTGRES_PASSWORD`: `XfhEACpePdhsJdEGavgULnpMDDhmpK1R` (이전에 확인한 값)
- `POSTGRES_USER`: `postgres`
- `PGDATABASE`: `railway`

이 값들을 사용하여 `DATABASE_URL`을 설정하거나, Railway가 자동으로 설정하도록 해야 합니다.

