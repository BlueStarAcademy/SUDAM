# Railway CLI를 사용한 데이터베이스 마이그레이션

## Railway CLI 설치 및 설정

### 1. Railway CLI 설치
```powershell
npm install -g @railway/cli
```

### 2. Railway에 로그인
```powershell
railway login
```

### 3. 프로젝트 연결
```powershell
railway link
```
프롬프트가 나타나면 프로젝트를 선택하세요.

## 마이그레이션 실행

### 방법 1: Railway CLI로 스키마 적용 및 데이터 마이그레이션

```powershell
# 1. Railway 환경에서 스키마 적용
railway run npm run prisma:migrate:deploy

# 2. Supabase Connection String 설정 (로컬 환경 변수)
$env:SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# 3. Railway 환경 변수에서 DATABASE_URL 가져와서 설정
# Railway CLI는 자동으로 Railway 환경 변수를 사용하므로, 
# RAILWAY_DATABASE_URL은 Railway의 DATABASE_URL을 자동으로 사용합니다.

# 4. 데이터 마이그레이션 실행 (Railway 환경에서)
railway run --service Postgres npm run migrate:to-railway
```

### 방법 2: Railway Dashboard에서 연결 정보 확인 후 수동 실행

1. **Railway Dashboard** → **Postgres** 서비스 선택
2. **Variables** 탭에서 `DATABASE_URL` 확인
3. **Connect** 탭에서 **Postgres Connection URL** 복사

그 다음 PowerShell에서:
```powershell
# Railway Database URL 설정 (Dashboard에서 복사한 URL 사용)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@호스트:포트/railway"

# Supabase Connection String 설정
$env:SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# 스키마 적용
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL
npm run prisma:migrate:deploy

# 데이터 마이그레이션
npm run migrate:to-railway
```

## Railway Dashboard에서 연결 정보 확인 방법

1. Railway Dashboard 접속
2. 프로젝트 선택
3. **Postgres** 서비스 클릭
4. **Variables** 탭:
   - `DATABASE_URL` 또는 `POSTGRES_URL` 확인
5. **Connect** 탭:
   - **Postgres Connection URL** 복사 (공개 연결용)
   - 또는 **Internal Connection URL** 확인 (Railway 내부 네트워크용)

## 주의사항

- Railway의 `DATABASE_URL`은 내부 네트워크 주소(`postgres.railway.internal`)를 사용할 수 있습니다
- 외부에서 접근하려면 공개 연결 URL(`turntable.proxy.rlwy.net`)을 사용해야 합니다
- 비밀번호가 변경되었을 수 있으므로 Dashboard에서 최신 정보를 확인하세요

