# Railway 배포 실패 문제 해결: 데이터베이스 연결

## 문제 증상

배포 시 다음 에러가 발생:
```
Error: P1001: Can't reach database server at `postgres-production-f9af.up.railway.app:5432`
```

## 원인

Railway pre-deploy 단계에서 `prisma:migrate:deploy` 실행 시, `DATABASE_URL`이 공개 URL(`postgres-production-f9af.up.railway.app`)을 사용하고 있습니다. Railway 서비스 내부에서는 **내부 네트워크**를 사용해야 합니다.

## 해결 방법

### 방법 1: Railway Dashboard에서 DATABASE_URL 수정 (권장)

1. **Railway Dashboard** 접속: https://railway.app/dashboard
2. 프로젝트 선택
3. **Sudam1** 서비스 클릭
4. **Variables** 탭 클릭
5. `DATABASE_URL` 변수 찾기
6. **편집** 클릭
7. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```
   > **중요**: 비밀번호(`XfhEACpePdhsJdEGavgULnpMDDhmpK1R`)는 Railway Dashboard → Postgres 서비스 → Variables에서 확인한 실제 비밀번호로 변경해야 합니다.
8. **Save** 클릭
9. 서비스 재배포

### 방법 2: Railway 자동 연결 사용 (가장 권장)

Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 올바른 `DATABASE_URL`을 설정합니다.

1. **Railway Dashboard** → **Sudam1** → **Settings** 탭
2. **Connected Services** 섹션 확인
3. Postgres 서비스가 연결되어 있는지 확인
   - 연결되어 있지 않으면 **+ Connect Service** 클릭 → **Postgres** 선택
4. **Variables** 탭에서 `DATABASE_URL` 확인
   - Railway가 자동으로 설정한 값이 `postgres.railway.internal`을 사용하는지 확인
   - 수동으로 설정한 `DATABASE_URL`이 있다면 **삭제**하여 Railway가 자동으로 설정하도록 함
5. 서비스 재배포

### 방법 3: Railway CLI 사용

```powershell
# 현재 DATABASE_URL 확인
railway variables | findstr DATABASE_URL

# Postgres 서비스의 비밀번호 확인
railway variables --service Postgres | findstr PGPASSWORD

# DATABASE_URL을 내부 네트워크로 설정
# (비밀번호는 위에서 확인한 값으로 변경)
railway variables --set "DATABASE_URL=postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway"
```

## Postgres 비밀번호 확인 방법

1. **Railway Dashboard** → **Postgres** 서비스 → **Variables** 탭
2. `PGPASSWORD` 또는 `POSTGRES_PASSWORD` 변수 확인
3. 또는 `DATABASE_URL` 변수에서 비밀번호 추출

## 차이점

- `postgres-production-f9af.up.railway.app:5432`: **공개 URL** (외부 접근용, Railway 서비스 내부에서는 사용 불가)
- `postgres.railway.internal:5432`: **내부 네트워크** (Railway 서비스 간 통신용, 배포 시 필수)

## 확인 방법

배포 후 로그에서 다음을 확인:
- `Prisma schema loaded from prisma/schema.prisma`
- `Datasource "db": PostgreSQL database "railway", schema "public" at "postgres.railway.internal:5432"`
- 마이그레이션 성공 메시지

## 추가 문제 해결

### Railway 서비스 연결 확인

1. **Railway Dashboard** → 프로젝트 → **Architecture** 탭
2. **Sudam1**과 **Postgres** 서비스 사이에 **연결선**이 있는지 확인
3. 연결선이 없으면:
   - **Sudam1** → **Settings** → **Connected Services** → **+ Connect Service** → **Postgres** 선택

### Pre-deploy Command 확인

Railway Dashboard → Sudam1 → Settings → **Deploy** 섹션에서:
- **Pre-deploy Command**가 `npm run prisma:migrate:deploy`로 설정되어 있는지 확인
- 이 명령은 Railway 환경 변수(`DATABASE_URL`)를 자동으로 사용합니다

## 참고

- Railway 내부 네트워크는 서비스 간 통신에만 사용 가능
- 공개 URL은 외부 클라이언트(로컬 개발 환경 등)에서만 사용
- Railway가 자동으로 설정한 `DATABASE_URL`을 사용하는 것이 가장 안전하고 권장됨

