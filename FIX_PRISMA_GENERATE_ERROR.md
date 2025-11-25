# Prisma Generate 네트워크 오류 해결

## 문제
Pre-deploy Command에서 `prisma:generate` 실행 시 네트워크 오류 발생:
```
Error: request to https://binaries.prisma.sh/.../libquery_engine.so.node.sha256 failed
```

## 원인
1. **중복 실행**: 빌드 단계에서 이미 `prisma:generate`가 실행됨
2. **네트워크 문제**: Railway에서 Prisma 바이너리 다운로드 실패
3. **불필요한 실행**: Pre-deploy에서 다시 실행할 필요 없음

## 해결 방법

### 방법 1: Pre-deploy Command 수정 (권장)

Railway Dashboard → Sudam1 → Settings → Deploy에서:

**현재:**
```
npm run prisma:generate && npm run prisma:migrate:deploy
```

**수정:**
```
npm run prisma:migrate:deploy
```

**이유:**
- 빌드 단계에서 이미 `prisma:generate`가 실행됨
- Pre-deploy에서는 마이그레이션만 실행하면 됨

### 방법 2: Pre-deploy Command 제거

Pre-deploy Command를 완전히 제거하고, Build Command에 포함:

**Build Command (이미 설정됨):**
```
npm run prisma:generate && npm run prisma:migrate:deploy
```

하지만 빌드 단계에서는 `DATABASE_URL`이 없을 수 있으므로, Pre-deploy에서만 마이그레이션 실행하는 것이 좋습니다.

### 방법 3: Prisma 바이너리 캐싱

Prisma 바이너리를 미리 다운로드하여 프로젝트에 포함 (복잡함)

## 권장 해결

**Pre-deploy Command를 다음으로 변경:**
```
npm run prisma:migrate:deploy
```

이렇게 하면:
1. 빌드 단계에서 Prisma 클라이언트 생성 (이미 완료)
2. Pre-deploy에서 마이그레이션만 실행 (DATABASE_URL 필요)

## 확인

변경 후 서비스 재배포:
1. Railway Dashboard → Sudam1 → Deployments
2. **Redeploy** 클릭
3. 로그에서 `prisma:generate` 오류가 사라졌는지 확인

