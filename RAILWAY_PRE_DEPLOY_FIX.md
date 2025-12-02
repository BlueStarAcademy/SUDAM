# Railway Pre-deploy Command 설정 가이드

## 현재 상황
- Custom Start Command는 `railway.json` 파일에 설정되어 있어 UI에서 직접 변경 불가
- 배포 중 Prisma 마이그레이션이 데이터베이스 연결 실패로 컨테이너 중지
- Pre-deploy Command를 설정하여 마이그레이션 실패해도 서버가 시작되도록 해야 함

## 해결 방법

### 방법 1: Pre-deploy Command 추가 (권장)

Railway Dashboard에서:

1. **Sudam1** 서비스 → **Settings** 탭
2. **Deploy** 섹션에서 **"Add pre-deploy step"** 클릭
3. 다음 명령어 입력:
   ```bash
   npm run prisma:migrate:deploy || echo "Migration skipped, server will start anyway"
   ```
4. **Save** 클릭
5. 서비스 재배포

**이렇게 하면:**
- 마이그레이션이 실패해도 서버가 시작됨
- `|| echo` 부분이 실패해도 계속 진행하도록 함

### 방법 2: Pre-deploy Command 완전 제거

1. **Sudam1** 서비스 → **Settings** → **Deploy**
2. Pre-deploy Command가 있다면 **제거** (비워두기)
3. **Save** 클릭
4. 서비스 재배포

**이렇게 하면:**
- 마이그레이션 없이 서버가 시작됨
- 서버 시작 후 Railway Shell에서 수동으로 마이그레이션 실행 가능

### 방법 3: Start Command에 마이그레이션 포함 (비권장)

`railway.json` 파일을 수정하여 Start Command에 마이그레이션 포함:

```json
{
  "deploy": {
    "startCommand": "(npm run prisma:migrate:deploy || echo 'Migration skipped') && npm run start-server"
  }
}
```

**주의:** 이 방법은 마이그레이션이 실패해도 서버가 시작되지만, 매번 시작할 때마다 마이그레이션을 시도하므로 비효율적입니다.

## 현재 railway.json 설정

```json
{
  "deploy": {
    "startCommand": "npm run start-server"
  }
}
```

이 설정은 이미 올바릅니다. 문제는 Pre-deploy Command에 있을 수 있습니다.

## 확인 사항

### 1. Pre-deploy Command 확인
Railway Dashboard → Sudam1 → Settings → Deploy에서:
- Pre-deploy Command가 설정되어 있는지 확인
- 있다면 내용 확인
- `prisma migrate deploy`가 포함되어 있다면 수정 필요

### 2. DATABASE_URL 확인
Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL`이 설정되어 있는지 확인
- `postgres.railway.internal:5432`를 사용하는지 확인

### 3. PostgreSQL 서비스 확인
- PostgreSQL 서비스가 실행 중인지 확인
- PostgreSQL 서비스가 Backend 서비스와 연결되어 있는지 확인

## 권장 해결 순서

1. **Pre-deploy Command 확인 및 수정**
   - Settings → Deploy → Pre-deploy Command 확인
   - 있다면 `|| echo "Migration skipped"` 추가
   - 또는 완전히 제거

2. **서버 재배포**
   - Deployments 탭에서 수동 배포
   - 또는 자동 배포 대기

3. **서버 시작 확인**
   - 로그에서 "[Server] Server listening on port 4000" 메시지 확인
   - `/api/health` 엔드포인트 테스트

4. **마이그레이션 수동 실행** (필요시)
   - 서버가 시작된 후 Railway Shell에서:
   ```bash
   npm run prisma:migrate:deploy
   ```

## 예상 결과

수정 후:
- ✅ 서버가 데이터베이스 연결 실패해도 시작됨
- ✅ 컨테이너가 중지되지 않음
- ✅ 헬스체크가 통과됨
- ✅ 서버 실행 중에 마이그레이션 실행 가능
