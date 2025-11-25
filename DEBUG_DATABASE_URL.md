# DATABASE_URL 디버깅 가이드

## 문제
Railway Dashboard에서 `DATABASE_URL`이 설정되어 있는데도 서비스에서 읽지 못함

## 가능한 원인

### 1. Railway 자동 연결과 수동 설정 충돌
Railway는 Postgres 서비스를 다른 서비스에 연결하면 자동으로 `DATABASE_URL`을 설정합니다. 수동으로 설정한 값이 자동 설정을 덮어쓸 수 있습니다.

### 2. Prisma Config 문제
`prisma.config.ts`가 `env("DATABASE_URL")`을 사용하는데, Railway 환경에서 제대로 작동하지 않을 수 있습니다.

### 3. 환경 변수 전달 타이밍
서비스가 시작될 때 환경 변수가 아직 전달되지 않았을 수 있습니다.

## 해결 방법

### 방법 1: Railway 자동 연결 사용

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `DATABASE_URL` **삭제** (Railway가 자동으로 설정하도록)
3. **Postgres 서비스와 연결 확인**
4. Railway가 자동으로 `DATABASE_URL`을 설정하는지 확인

### 방법 2: Railway Variables에서 직접 확인

Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL` 값이 정확한지 확인
- 값에 특수 문자가 있는지 확인 (특히 `@`, `:`, `/` 등)
- 값이 여러 줄로 나뉘어 있지 않은지 확인

### 방법 3: Railway CLI로 확인

```powershell
# Railway 환경 변수 확인
railway variables

# DATABASE_URL만 확인
railway variables | findstr DATABASE_URL
```

### 방법 4: 서비스 재배포

환경 변수를 변경한 후 서비스를 재배포해야 할 수 있습니다:
1. Railway Dashboard → Sudam1 → Deployments
2. **Redeploy** 클릭

## 디버깅 로그 확인

서버 시작 시 다음 로그가 표시됩니다:
```
[Server Startup] DATABASE_URL check: Set (length: ...) or NOT SET
```

이 로그를 통해 환경 변수가 전달되는지 확인할 수 있습니다.

## 다음 단계

1. 서비스 재배포 후 로그 확인
2. `[Server Startup] DATABASE_URL check` 메시지 확인
3. 값이 `NOT SET`이면 Railway Variables 다시 확인

