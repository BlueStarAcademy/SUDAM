# Railway 배포를 통한 마이그레이션

## 문제
`railway run`은 로컬에서 실행되므로 Railway 내부 네트워크에 접근할 수 없습니다.

## 해결 방법: Railway 배포 시 마이그레이션 실행

Railway 서비스가 배포될 때 자동으로 마이그레이션을 실행하도록 설정합니다.

### 방법 1: Build Command에 마이그레이션 추가

Railway Dashboard에서:
1. **Sudam1** 서비스 → **Settings** → **Deploy**
2. **Build Command** 수정:
   ```
   npm run prisma:generate && npm run prisma:migrate:deploy
   ```
3. **Start Command** 확인:
   ```
   npm run start-server
   ```
4. 서비스 재배포

### 방법 2: Railway 환경 변수 확인 후 재배포

Railway Dashboard에서:
1. **Sudam1** → **Variables**
2. `DATABASE_URL`이 `postgres.railway.internal`을 사용하는지 확인
3. 필요하면 수정
4. 서비스 재배포 (배포 시 마이그레이션 자동 실행)

### 방법 3: Railway 서비스 내에서 직접 실행

Railway 서비스가 실행 중일 때, Railway Dashboard의 **Shell** 기능을 사용:

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Deployments** → 최신 배포 선택
3. **Shell** 탭 (또는 **Logs** 옆)
4. 다음 명령어 실행:
   ```bash
   npm run prisma:migrate:deploy
   ```

## 현재 DATABASE_URL 확인

Railway CLI로 확인한 결과:
- `DATABASE_URL`이 Railway Postgres를 가리키고 있음
- 하지만 `railway run`은 로컬에서 실행되어 내부 네트워크 접근 불가

## 권장 방법

**Railway Dashboard에서 Build Command에 마이그레이션 추가**하는 것이 가장 확실합니다:

1. Railway Dashboard → Sudam1 → Settings → Deploy
2. Build Command: `npm run prisma:generate && npm run prisma:migrate:deploy`
3. 재배포

이렇게 하면 Railway 서비스 내부에서 마이그레이션이 실행되어 Railway 내부 네트워크에 접근할 수 있습니다.

