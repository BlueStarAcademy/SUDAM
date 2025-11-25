# Supabase → Railway 마이그레이션 빠른 시작 가이드

## 왜 마이그레이션을 해야 하나요?

- **성능 개선**: Railway Postgres는 Railway Backend와 같은 네트워크에 있어 지연 시간이 줄어듭니다
- **비용 효율**: Railway에서 Postgres와 Backend를 함께 관리하면 더 효율적입니다
- **제어력 향상**: Railway에서 데이터베이스 리소스를 직접 관리할 수 있습니다

## 마이그레이션 방법 선택

### 방법 1: 자동 스크립트 사용 (권장) ⭐

가장 간단하고 안전한 방법입니다.

#### 1단계: 환경 변수 설정
```bash
# Supabase 연결 정보
export SUPABASE_DATABASE_URL="postgresql://postgres:비밀번호@db.xxx.supabase.co:5432/postgres"

# Railway Postgres 연결 정보 (Railway Dashboard → Postgres 서비스 → Variables에서 확인)
export RAILWAY_DATABASE_URL="postgresql://postgres:비밀번호@containers-us-west-xxx.railway.app:5432/railway"
```

#### 2단계: Railway Postgres 스키마 준비
```bash
# Railway Postgres에 Prisma 마이그레이션 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy
```

#### 3단계: 데이터 마이그레이션 실행
```bash
npm run migrate:to-railway
```

스크립트가 자동으로:
- Supabase에서 모든 데이터를 읽어옵니다
- Railway Postgres로 데이터를 복사합니다
- 데이터 검증을 수행합니다

#### 4단계: Railway 환경 변수 업데이트
1. Railway Dashboard → Backend 서비스 선택
2. **Variables** 탭 클릭
3. `DATABASE_URL` 찾기
4. Railway Postgres URL로 변경
5. 서비스 재시작

### 방법 2: pg_dump 사용 (대용량 데이터)

데이터가 매우 많거나 더 세밀한 제어가 필요한 경우:

```bash
# 1. Supabase에서 덤프
pg_dump "$SUPABASE_DATABASE_URL" \
  --schema=public \
  --no-owner \
  --no-acl \
  --clean \
  -f supabase_dump.sql

# 2. Railway Postgres에 스키마 적용
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy

# 3. 데이터 복원
psql "$RAILWAY_DATABASE_URL" -f supabase_dump.sql
```

## 마이그레이션 전 체크리스트

- [ ] Supabase 데이터 백업 (안전을 위해)
- [ ] Railway Postgres가 정상 작동하는지 확인
- [ ] Prisma 마이그레이션이 Railway Postgres에 적용되었는지 확인
- [ ] 유지보수 시간대에 진행 (다운타임 가능)

## 마이그레이션 후 확인

1. **데이터 개수 확인**
   ```sql
   SELECT COUNT(*) FROM "User";
   SELECT COUNT(*) FROM "UserInventory";
   ```

2. **기능 테스트**
   - 로그인/회원가입
   - 게임 시작
   - 인벤토리 확인
   - 장비 장착

3. **성능 모니터링**
   - Railway Dashboard에서 Postgres 메트릭 확인
   - 애플리케이션 응답 시간 확인

## 문제 해결

### 오류: "relation does not exist"
→ Railway Postgres에 Prisma 마이그레이션을 먼저 적용하세요:
```bash
DATABASE_URL=$RAILWAY_DATABASE_URL npm run prisma:migrate:deploy
```

### 오류: "connection refused"
→ Railway Postgres 연결 정보를 확인하세요. Railway Dashboard에서 최신 URL을 복사하세요.

### 데이터가 일부만 복사됨
→ 외래 키 제약 조건을 확인하세요. 스크립트는 자동으로 순서를 처리하지만, 수동으로 확인이 필요할 수 있습니다.

## 롤백 방법

문제가 발생하면:
1. Railway Backend의 `DATABASE_URL`을 다시 Supabase URL로 변경
2. 서비스 재시작
3. 문제 해결 후 다시 시도

## 자세한 문서

더 자세한 내용은 `docs/migrate-supabase-to-railway.md`를 참고하세요.

