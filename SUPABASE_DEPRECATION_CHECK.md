# Supabase 사용 중지 전 확인 사항

## 현재 상태

✅ **Railway DATABASE_URL 확인됨**
- Railway Backend 서비스의 `DATABASE_URL`이 Railway Postgres로 설정되어 있음
- `postgresql://postgres:...@postgres.railway.internal:5432/railway`

✅ **데이터 마이그레이션 완료**
- 사용자: 41명
- 인벤토리: 164개
- 장비: 79개
- 메일: 20개
- 퀘스트: 704개
- 미션: 20개
- 게임: 46개
- 길드: 1개

## Supabase 관련 환경 변수

Railway에 여전히 설정되어 있는 Supabase 관련 환경 변수:
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`

## 확인 필요 사항

### 1. Supabase 서비스 사용 여부 확인
- `server/services/supabaseService.ts`의 `broadcast` 함수가 실제로 사용되는지 확인
- 사용되지 않는다면 Supabase 환경 변수는 제거해도 됨

### 2. 기능 테스트
Supabase 사용 중지 전에 다음 기능들을 테스트해야 합니다:
- [ ] 로그인/회원가입
- [ ] 게임 시작
- [ ] 인벤토리 확인
- [ ] 장비 장착
- [ ] 퀘스트 진행
- [ ] 미션 완료
- [ ] 메일 확인
- [ ] 길드 기능

### 3. Supabase 사용 중지 절차

1. **기능 테스트 완료 후**
2. **Railway 환경 변수에서 Supabase 관련 변수 제거**
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_URL`
3. **서비스 재시작**
4. **최종 기능 테스트**
5. **Supabase 프로젝트 삭제 또는 일시 중지**

## 주의사항

⚠️ **Supabase를 완전히 삭제하기 전에:**
- 모든 기능이 정상 작동하는지 최소 1주일간 모니터링
- 데이터 백업 확인 (Railway Postgres 백업 설정 확인)
- 롤백 계획 수립 (필요시 Supabase로 되돌릴 수 있도록)

## 다음 단계

1. 기능 테스트 실행
2. Supabase 서비스 사용 여부 최종 확인
3. Supabase 환경 변수 제거
4. 최종 테스트
5. Supabase 프로젝트 일시 중지 (삭제 전 1주일 대기)

