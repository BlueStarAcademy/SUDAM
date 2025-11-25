# Railway 서비스 연결 확인 (대안 방법)

## 방법 1: Architecture 뷰 확인 (가장 확실)

1. **Railway Dashboard** → 프로젝트 선택
2. 상단 메뉴에서 **"Architecture"** 또는 **"Services"** 탭 클릭
3. 서비스 목록에서:
   - **Sudam1** 서비스와 **Postgres** 서비스가 같은 프로젝트에 있는지 확인
   - 같은 프로젝트에 있으면 Railway가 자동으로 연결 가능

## 방법 2: Variables에서 DATABASE_URL 확인

1. **Railway Dashboard** → **Sudam1** 서비스 클릭
2. **Variables** 탭 클릭
3. `DATABASE_URL` 변수 확인:
   - **변수가 존재**하고 값이 `postgresql://...`로 시작하면 연결됨
   - 변수가 없거나 비어있으면 연결 안 됨

## 방법 3: Railway CLI로 확인

```bash
# Railway CLI로 로그인
railway login

# 프로젝트 연결
railway link

# Variables 확인
railway variables
```

이 명령으로 `DATABASE_URL`이 자동으로 설정되어 있는지 확인할 수 있습니다.

## 방법 4: Postgres 서비스 Variables 확인

1. **Railway Dashboard** → **Postgres** 서비스 클릭
2. **Variables** 탭 클릭
3. 다음 변수들 확인:
   - `POSTGRES_USER` (보통 `postgres`)
   - `POSTGRES_PASSWORD` (비밀번호)
   - `PGDATABASE` (보통 `railway`)

이 값들을 사용하여 `DATABASE_URL`을 수동으로 구성할 수 있습니다.

## 방법 5: 서비스 생성 시 연결 확인

Railway에서 Postgres 서비스를 생성할 때:
- 같은 프로젝트에 있으면 자동으로 연결 가능
- 다른 프로젝트에 있으면 수동으로 연결 필요

## 연결이 안 되어 있다면

### 수동으로 DATABASE_URL 설정

1. **Railway Dashboard** → **Postgres** → **Variables**에서:
   - `POSTGRES_PASSWORD` 확인
   - `POSTGRES_USER` 확인 (보통 `postgres`)
   - `PGDATABASE` 확인 (보통 `railway`)

2. **Railway Dashboard** → **Sudam1** → **Variables**에서:
   - `DATABASE_URL` 변수 추가/수정
   - 값: `postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway`
   - 또는 공개 URL 사용: `postgresql://postgres:비밀번호@postgres-production-xxxx.up.railway.app:5432/railway`

### Railway CLI로 설정

```bash
# Postgres Variables 확인
railway variables --service postgres

# Sudam1에 DATABASE_URL 설정
railway variables --service sudam1 --set "DATABASE_URL=postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway"
```

## 확인 방법 요약

**가장 쉬운 방법:**
1. Sudam1 → Variables에서 `DATABASE_URL` 확인
2. 값이 있으면 연결됨
3. 값이 없으면 Postgres Variables에서 정보를 가져와서 수동 설정

