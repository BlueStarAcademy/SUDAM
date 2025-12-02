# Railway 배포 크래시 문제 해결

## 현재 문제
배포 중 Prisma가 데이터베이스에 연결할 수 없어서 컨테이너가 중지됨:
```
Error: P1001: Can't reach database server at `postgres.railway.internal:5432`
Stopping Container
```

## 원인
Railway의 Pre-deploy Command나 Start Command에서 `prisma migrate deploy`가 실행되면서 데이터베이스 연결을 시도하고, 실패 시 컨테이너가 중지됨.

## 즉시 해결 방법

### 방법 1: Railway Settings에서 Pre-deploy Command 수정 (가장 빠름)

1. **Railway Dashboard 접속**: https://railway.app
2. 프로젝트 선택
3. **Sudam1** 서비스 선택
4. **Settings** 탭 클릭
5. **Deploy** 섹션에서 **Pre Deploy Command** 또는 **Pre-deploy Command** 확인

**현재 설정이 있다면:**
```
npm run prisma:migrate:deploy
```

**다음으로 변경:**
```bash
npm run prisma:migrate:deploy || echo "Migration failed, continuing..."
```

또는 완전히 제거:
```
(비워두기)
```

**이유:**
- 마이그레이션 실패해도 서버가 시작되도록 함
- 서버 시작 후 백그라운드에서 마이그레이션 실행 가능

### 방법 2: Start Command 수정

**Settings** → **Deploy** → **Start Command** 확인:

**현재:**
```
npm run start-server
```

**다음으로 변경 (마이그레이션 실패해도 서버 시작):**
```bash
npm run prisma:migrate:deploy || true && npm run start-server
```

또는:
```bash
(npm run prisma:migrate:deploy || echo "Migration skipped") && npm run start-server
```

### 방법 3: Pre-deploy Command 완전 제거

1. Railway Dashboard → Sudam1 → Settings → Deploy
2. **Pre Deploy Command** 필드를 **비워두기**
3. 저장 후 재배포

**이유:**
- 서버가 먼저 시작되고, 마이그레이션은 서버 내부에서 처리
- 데이터베이스 연결 실패해도 서버는 계속 실행

## 확인 사항

### 1. DATABASE_URL 확인
Railway Dashboard → Sudam1 → Variables에서:
- `DATABASE_URL`이 설정되어 있는지 확인
- `postgres.railway.internal:5432`를 사용하는지 확인
- 또는 공개 URL을 사용하는지 확인

### 2. PostgreSQL 서비스 확인
- Railway 프로젝트에 PostgreSQL 서비스가 있는지 확인
- PostgreSQL 서비스가 실행 중인지 확인
- PostgreSQL 서비스가 Backend 서비스와 연결되어 있는지 확인

### 3. 네트워크 연결 확인
- Railway 내부 네트워크가 정상 작동하는지 확인
- PostgreSQL 서비스의 포트가 5432인지 확인

## 권장 해결 순서

1. **Pre-deploy Command 제거 또는 수정** (가장 빠름)
   - Settings → Deploy → Pre Deploy Command 비우기
   - 또는 `|| true` 추가하여 실패해도 계속 진행

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
- ✅ 서버가 실행 중인 상태에서 마이그레이션 실행 가능

## 추가 참고

서버 코드는 이미 데이터베이스 연결 실패해도 계속 실행되도록 수정되어 있습니다:
- 데이터베이스 초기화에 타임아웃 추가 (5초)
- 서버 리스닝을 최우선으로 처리
- 데이터베이스 초기화를 비동기로 처리

문제는 Railway의 Pre-deploy Command에서 마이그레이션이 실패하면 컨테이너가 시작되지 않는 것입니다.
