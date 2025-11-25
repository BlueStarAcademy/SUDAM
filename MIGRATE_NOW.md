# 지금 바로 데이터베이스 마이그레이션 실행

## 단계별 실행 순서

### 1단계: Railway에 스키마 적용 확인 및 적용

Railway에 스키마가 이미 적용되어 있는지 확인하고, 없으면 적용합니다.

**PowerShell:**
```powershell
# Railway Database URL 설정 (공개 연결 사용)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"

# DATABASE_URL 설정
$env:DATABASE_URL=$env:RAILWAY_DATABASE_URL

# Prisma 클라이언트 생성
npm run prisma:generate

# 스키마 적용
npm run prisma:migrate:deploy
```

### 2단계: 데이터 마이그레이션 실행

Supabase에서 Railway로 모든 데이터를 마이그레이션합니다.

**PowerShell:**
```powershell
# Supabase Connection String 설정
$env:SUPABASE_DATABASE_URL="postgresql://postgres.xqepeecuuquoamcvomsv:gudans10dkfk@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres"

# Railway Database URL 설정 (공개 연결 사용)
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"

# 마이그레이션 실행
npm run migrate:to-railway
```

**주의사항:**
- 마이그레이션 스크립트가 실행되면 확인 메시지가 나타납니다
- Railway에 이미 데이터가 있으면 덮어쓸지 물어봅니다
- `yes`를 입력하면 마이그레이션이 시작됩니다

### 3단계: Railway Backend 환경 변수 업데이트

마이그레이션 완료 후 Railway Backend 서비스의 `DATABASE_URL`을 Railway Postgres로 변경합니다.

1. **Railway Dashboard** → **Sudam1** 서비스 선택
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. **편집** 클릭
5. 다음 값으로 변경:
   ```
   postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@postgres.railway.internal:5432/railway
   ```
   (또는 공개 연결 URL 사용 시: `postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require`)
6. **Save** 클릭
7. 서비스가 자동으로 재시작됩니다

## 예상 소요 시간

- 스키마 적용: 1-2분
- 데이터 마이그레이션: 5-10분 (데이터 양에 따라 다름)
- 총 소요 시간: 약 10-15분

## 마이그레이션되는 데이터

- ✅ 사용자 (User)
- ✅ 인벤토리 (UserInventory)
- ✅ 장비 (UserEquipment)
- ✅ 메일 (UserMail)
- ✅ 퀘스트 (UserQuest)
- ✅ 미션 (UserMission)
- ✅ 인증 정보 (UserCredential)
- ✅ 게임 (LiveGame)
- ✅ 길드 (Guild)
- ✅ 길드 멤버 (GuildMember)
- ✅ 기타 관련 데이터

## 문제 해결

### 연결 오류 발생 시

**방법 1: Railway 공개 연결 URL 사용 (권장)**
```powershell
$env:RAILWAY_DATABASE_URL="postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpK1R@turntable.proxy.rlwy.net:17109/railway?sslmode=require"
```

**방법 2: Railway CLI 사용**
```powershell
railway run npm run prisma:migrate:deploy
railway run npm run migrate:to-railway
```

### Prisma 클라이언트 오류
```powershell
npm run prisma:generate
```

## 마이그레이션 완료 후 확인

1. Railway Dashboard → Sudam1 → Logs 확인
   - `[DB] Database initialized successfully` 메시지 확인
   - 데이터베이스 연결 오류가 없는지 확인

2. 기능 테스트
   - 로그인/회원가입
   - 게임 시작
   - 인벤토리 확인

