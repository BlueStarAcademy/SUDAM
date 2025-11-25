# Railway 자동 DATABASE_URL 사용

## 문제
`postgres.railway.internal`을 사용하지만 인증 실패

## 해결 방법: Railway 자동 연결 사용

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 올바른 `DATABASE_URL`을 설정합니다.

### 단계

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` 찾기
3. **삭제** (Railway가 자동으로 설정하도록)
4. **Postgres 서비스와 연결 확인**
   - Railway Dashboard → Sudam1 서비스
   - Postgres 서비스와 연결되어 있는지 확인
   - 연결되어 있으면 Railway가 자동으로 `DATABASE_URL`을 설정함
5. 서비스 재배포

### Railway 자동 연결 확인

Railway Dashboard에서:
1. **Sudam1** 서비스 확인
2. Postgres 서비스와 연결되어 있는지 확인 (Architecture 뷰에서 확인)
3. 연결되어 있으면 Railway가 자동으로 `DATABASE_URL`을 설정해야 함

### 대안: Postgres Variables에서 비밀번호 확인

Railway Dashboard → **Postgres** → **Variables**에서:
- `POSTGRES_PASSWORD` 확인
- `POSTGRES_USER` 확인 (보통 `postgres`)
- `PGDATABASE` 확인 (보통 `railway`)

이 값들을 사용하여 `DATABASE_URL`을 구성:
```
postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway
```

## 권장 방법

**Railway 자동 연결 사용:**
1. `DATABASE_URL` 삭제
2. Railway가 자동으로 설정하도록
3. 서비스 재배포

이렇게 하면 Railway가 올바른 인증 정보를 자동으로 설정합니다.

