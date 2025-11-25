# 긴급: DATABASE_URL 설정 문제 해결

## 현재 문제
Railway 서비스가 시작될 때 `DATABASE_URL`이 비어있어서 Prisma가 데이터베이스에 연결할 수 없습니다.

## 즉시 해결 방법

### 방법 1: Railway Dashboard에서 직접 확인 및 설정

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` 찾기
3. 값이 비어있거나 잘못되었는지 확인
4. 다음 값으로 설정:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```
5. **Save** 클릭
6. 서비스가 자동으로 재시작됩니다

### 방법 2: Railway CLI로 확인 및 설정

```powershell
# 현재 DATABASE_URL 확인
railway variables

# DATABASE_URL 설정
railway variables --set "DATABASE_URL=postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway"
```

### 방법 3: Railway 자동 연결 확인

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL`을 설정합니다.

1. **Railway Dashboard** → **Sudam1** 서비스
2. Postgres 서비스와 연결되어 있는지 확인
3. 연결되어 있으면 Railway가 자동으로 `DATABASE_URL`을 설정해야 함
4. Variables에서 자동으로 설정된 값 확인

## 확인 방법

Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL`이 설정되어 있는지 확인
- 값이 `postgresql://...`로 시작하는지 확인
- 값이 비어있지 않은지 확인

## 문제 원인

가능한 원인:
1. `DATABASE_URL`이 삭제되었거나 비어있음
2. Railway가 자동으로 설정한 값이 덮어씌워짐
3. 환경 변수가 제대로 로드되지 않음

## 다음 단계

1. Railway Dashboard에서 `DATABASE_URL` 확인 및 설정
2. 서비스 재시작
3. 로그에서 `[DB] Database initialized successfully` 메시지 확인

