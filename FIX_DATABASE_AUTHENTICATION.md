# Railway Postgres 인증 오류 해결

## 현재 상황
- `DATABASE_URL`은 설정되어 있음
- 하지만 인증 실패 오류 발생: `P1000: Authentication failed`

## 해결 방법

### 방법 1: Railway Dashboard에서 Postgres 비밀번호 확인

1. **Railway Dashboard** → 프로젝트 선택
2. **Postgres** 서비스 클릭
3. **Variables** 탭 클릭
4. 다음 변수들 확인:
   - `POSTGRES_PASSWORD` - 실제 비밀번호
   - `POSTGRES_USER` - 보통 `postgres`
   - `PGDATABASE` - 보통 `railway`

5. 확인한 비밀번호로 `DATABASE_URL` 업데이트:
   ```
   postgresql://postgres:실제비밀번호@postgres.railway.internal:5432/railway
   ```

### 방법 2: Railway Dashboard에서 DATABASE_URL 직접 확인

Railway Dashboard → **Postgres** → **Variables**에서:
- Railway가 자동으로 생성한 `DATABASE_URL` 또는 연결 정보 확인
- 이 값이 올바른 인증 정보를 포함하고 있음

### 방법 3: Postgres 공개 URL 사용 (임시)

인증 문제를 우회하기 위해 공개 URL을 사용할 수 있습니다:

1. Railway Dashboard → **Postgres** → **Settings**
2. **Network** 섹션에서 **Public Networking** 활성화
3. 공개 URL 확인 (예: `postgres-production-f9af.up.railway.app`)
4. `DATABASE_URL`을 공개 URL로 변경:
   ```
   postgresql://postgres:비밀번호@postgres-production-f9af.up.railway.app:5432/railway
   ```

**주의**: 공개 URL은 보안상 권장되지 않지만, 인증 문제 해결을 위한 임시 방법입니다.

### 방법 4: Railway CLI로 비밀번호 확인 (대화형 메뉴 사용)

터미널에서:
```bash
# Postgres 서비스 선택
railway service

# Postgres 선택 후
railway variables
```

## 권장 순서

1. **Railway Dashboard** → **Postgres** → **Variables**에서 `POSTGRES_PASSWORD` 확인
2. 확인한 비밀번호로 `DATABASE_URL` 업데이트
3. 서비스 재배포

## 확인 사항

현재 `DATABASE_URL`에 있는 비밀번호: `XfhEACpePdhsJdEGavgULnpMDDhmpK1R`

이 비밀번호가 Postgres Variables의 `POSTGRES_PASSWORD`와 일치하는지 확인하세요.

