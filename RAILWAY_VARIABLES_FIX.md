# Railway 환경 변수 설정 방법

## Railway CLI 명령어

Railway CLI의 변수 설정 명령어는 버전에 따라 다를 수 있습니다.

### 방법 1: Railway Dashboard 사용 (가장 확실함)

1. **Railway Dashboard** → **Sudam1** 서비스
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. **편집** 클릭
5. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway
   ```
6. **Save** 클릭

### 방법 2: Railway CLI 올바른 명령어

```powershell
# Railway CLI 버전 확인
railway --version

# 변수 추가/업데이트 (Railway CLI v3+)
railway variables --set DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway"

# 또는
railway variables add DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres-production-f9af.up.railway.app:5432/railway"
```

### 방법 3: Railway 환경 변수 파일 사용

Railway는 `.railway` 폴더나 환경 변수 파일을 지원할 수 있습니다.

## 가장 빠른 방법: Railway Dashboard

Railway Dashboard에서 직접 변경하는 것이 가장 빠르고 확실합니다:

1. https://railway.app/dashboard 접속
2. **capable-harmony** 프로젝트 선택
3. **Sudam1** 서비스 선택
4. **Variables** 탭
5. `DATABASE_URL` 편집
6. Railway Postgres URL로 변경
7. 저장

## 변경 후 마이그레이션 재실행

```powershell
# Railway 환경에서 마이그레이션 실행
railway run npm run prisma:migrate:deploy
```

