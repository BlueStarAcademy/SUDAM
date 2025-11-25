# 긴급: Railway DATABASE_URL 변경 필요

## 현재 상황
- Railway CLI가 Supabase를 가리키고 있음
- Railway Postgres로 변경 필요

## 즉시 해결 방법

### Railway Dashboard에서 직접 변경 (가장 빠름)

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. **편집** 클릭
5. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
   ```
   또는 Railway 내부 네트워크 사용:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```
6. **Save** 클릭

### Railway CLI로 변경

```powershell
# 현재 실행 중인 프로세스 취소 (Ctrl+C)

# Railway DATABASE_URL을 Railway Postgres로 변경
railway variables set DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway"

# 다시 마이그레이션 실행
railway run npm run prisma:migrate:deploy
```

## 현재 실행 중인 프로세스

현재 Supabase에 마이그레이션을 적용하고 있습니다. 이것도 문제는 아니지만, 목표는 Railway Postgres입니다.

**선택지:**
1. **현재 프로세스 완료 대기** → Supabase에 마이그레이션 적용됨 (문제 없음)
2. **Ctrl+C로 취소** → Railway Postgres로 변경 후 다시 실행

## 권장 순서

1. **현재 프로세스 취소** (Ctrl+C)
2. **Railway Dashboard에서 DATABASE_URL 변경**
3. **다시 마이그레이션 실행**

```powershell
# 1. Railway DATABASE_URL 변경
railway variables set DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway"

# 2. Railway 환경에서 마이그레이션 실행
railway run npm run prisma:migrate:deploy
```

