# Pre-deploy 단계 DATABASE_URL 문제 해결

## 문제
Pre-deploy Command에서 `prisma:migrate:deploy` 실행 시:
```
Can't reach database server at `postgres-production-f9af.up.railway.app:5432`
```

## 원인
Pre-deploy 단계에서 `DATABASE_URL`이 외부 호스트를 가리키고 있음. Railway 서비스 내부에서는 내부 네트워크를 사용해야 함.

## 해결 방법

### 방법 1: Railway Variables에서 내부 네트워크 사용 (권장)

Railway Dashboard → Sudam1 → Variables에서:

1. `DATABASE_URL` 찾기
2. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```
3. Save 클릭
4. 서비스 재배포

### 방법 2: Railway 자동 연결 사용

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL`을 설정합니다.

1. Railway Dashboard → Sudam1 → Variables
2. `DATABASE_URL` 삭제 (Railway가 자동으로 설정하도록)
3. Postgres 서비스와 연결 확인
4. 서비스 재배포

### 방법 3: Pre-deploy Command에서 환경 변수 오버라이드

Pre-deploy Command를 다음과 같이 수정:

```
DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway" npm run prisma:migrate:deploy
```

하지만 이 방법은 비밀번호가 노출될 수 있으므로 권장하지 않습니다.

## 확인

Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL`이 `postgres.railway.internal`을 사용하는지 확인
- 또는 Railway가 자동으로 설정한 값 확인

## 차이점

- `postgres-production-f9af.up.railway.app`: 외부 호스트 (외부 접근용)
- `postgres.railway.internal`: 내부 네트워크 (Railway 서비스 간 통신용)

Railway 서비스 내부에서는 `postgres.railway.internal`을 사용해야 합니다.

