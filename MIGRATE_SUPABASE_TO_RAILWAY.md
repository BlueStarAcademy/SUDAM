# Supabase → Railway 데이터 마이그레이션 가이드

## 개요
Supabase에 있는 모든 데이터를 Railway PostgreSQL로 마이그레이션합니다.

## 사전 준비

### 1. Supabase Connection String 확인
1. Supabase 대시보드 → **Settings** → **Database**
2. **Connection string** → **URI** 복사
   - 예: `postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres`

### 2. Railway Database URL 확인
1. Railway 대시보드 → **Postgres** 서비스 선택
2. **Variables** 탭에서 `DATABASE_URL` 확인
   - 또는 **Connect** → **Postgres Connection URL** 복사
   - 예: `postgresql://postgres:password@postgres.railway.internal:5432/railway`

## 마이그레이션 실행

### Windows PowerShell

```powershell
# 1. Supabase Connection String 설정
$env:SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"

# 2. Railway Database URL 설정
$env:RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway"

# 3. 마이그레이션 실행
npm run migrate:to-railway
```

### Linux/Mac

```bash
# 1. Supabase Connection String 설정
export SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"

# 2. Railway Database URL 설정
export RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@postgres.railway.internal:5432/railway"

# 3. 마이그레이션 실행
npm run migrate:to-railway
```

## 마이그레이션되는 데이터

다음 데이터가 모두 마이그레이션됩니다:

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

## 주의사항

1. **기존 데이터 확인**: Railway에 이미 데이터가 있으면 덮어쓸지 물어봅니다.
2. **백업 권장**: 마이그레이션 전에 Railway 데이터를 백업하세요.
3. **네트워크 연결**: Supabase와 Railway 모두 접근 가능한 네트워크에서 실행해야 합니다.
4. **시간 소요**: 데이터 양에 따라 수분~수십 분이 걸릴 수 있습니다.

## 마이그레이션 후 확인

1. Railway 대시보드에서 데이터 개수 확인
2. 애플리케이션에서 로그인 테스트
3. 인벤토리, 장비 등 핵심 기능 테스트

## 문제 해결

### 연결 오류
- Supabase/Railway Connection String이 올바른지 확인
- 방화벽 설정 확인 (특히 Railway internal URL 사용 시)

### 데이터 불일치
- 마이그레이션 로그 확인
- 수동으로 데이터 개수 비교
- 필요시 특정 사용자만 복구: `server/restoreUserFromSupabaseBackup.ts` 사용

