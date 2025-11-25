# Railway DATABASE_URL 설정

## 문제
`DATABASE_URL`이 비어있어서 Prisma가 데이터베이스에 연결할 수 없습니다.

## 해결 방법

### Railway Dashboard에서 설정

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. **"+ New Variable"** 클릭 또는 기존 `DATABASE_URL` 편집
3. 다음 값 입력:

**옵션 1: Railway 내부 네트워크 (권장)**
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
```

**옵션 2: Railway 외부 호스트**
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
```

4. **Save** 클릭
5. 서비스가 자동으로 재시작됩니다

## Railway Postgres Variables 확인

Railway Dashboard → **Postgres** → **Variables**에서:
- `POSTGRES_PASSWORD`: `XfhEACpePdhsJdEGavgULnpMDDhmpK1R`
- `POSTGRES_USER`: `postgres`
- `PGDATABASE`: `railway`

이 값들을 사용하여 `DATABASE_URL`을 구성합니다.

## 형식

```
postgresql://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
```

예시:
```
postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
```

## 확인

설정 후:
1. Railway Dashboard → Sudam1 → Logs 확인
2. `[DB] Database initialized successfully` 메시지 확인
3. 서비스가 정상적으로 시작되는지 확인

