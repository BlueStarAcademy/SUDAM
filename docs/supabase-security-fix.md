# Supabase Security Advisor 오류 해결 가이드

## 문제 상황
Supabase Security Advisor에서 **1개의 오류**와 **1개의 위험**이 발견되었습니다:
- **오류**: `_prisma_migrations` 테이블에 RLS가 비활성화되어 있음
- **위험**: `update_updated_at_column` 함수의 search_path가 설정되지 않음

## 원인
1. **RLS (Row Level Security) 미활성화**: `_prisma_migrations` 테이블을 포함한 일부 테이블에 RLS가 활성화되지 않음
2. **함수 search_path 미설정**: PostgreSQL 함수의 search_path가 명시적으로 설정되지 않아 보안 취약점 발생
3. **공개 접근 가능**: Supabase의 PostgREST API를 통한 직접 접근이 가능

## 해결 방법

### 방법 1: RLS 활성화 및 정책 설정 (권장)

1. **Supabase Dashboard 접속**
   - https://supabase.com/dashboard
   - 프로젝트 선택

2. **SQL Editor 열기**
   - 왼쪽 사이드바 → **SQL Editor** 클릭

3. **보안 스크립트 실행**
   - `supabase_security_fix.sql` 파일의 내용을 복사하여 붙여넣기
   - **Run** 버튼 클릭

4. **결과 확인**
   - 스크립트 하단의 확인 쿼리를 실행하여 RLS가 활성화되었는지 확인

### 방법 2: Supabase API 비활성화 (간단한 방법)

만약 Supabase의 PostgREST API를 사용하지 않는다면:

1. **Supabase Dashboard** → **Settings** → **API**
2. **Disable API** 옵션 활성화 (또는 anon 키 비활성화)

이렇게 하면 Supabase의 PostgREST API를 통한 접근이 완전히 차단됩니다.

## 주의사항

### Prisma 사용 시
- 이 프로젝트는 **Prisma**를 사용하여 데이터베이스에 접근합니다.
- Prisma는 **service_role** 키를 사용하므로 RLS 정책의 영향을 받지 않습니다.
- 따라서 RLS를 활성화해도 Prisma를 통한 접근은 정상적으로 작동합니다.

### Supabase PostgREST API 사용 시
- 만약 나중에 Supabase의 PostgREST API를 사용하려면:
  - RLS 정책을 수정하여 적절한 접근 권한을 부여해야 합니다.
  - 예: 사용자는 자신의 데이터만 조회/수정 가능하도록 정책 설정

## 확인 방법

### Security Advisor 재확인
1. Supabase Dashboard → **Security** → **Advisor**
2. 모든 오류와 위험이 해결되었는지 확인

### RLS 활성화 확인
```sql
-- 모든 테이블의 RLS 상태 확인
SELECT 
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

### 정책 확인
```sql
-- 모든 테이블의 RLS 정책 확인
SELECT 
    tablename,
    policyname,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 함수 search_path 확인
```sql
-- 함수의 search_path 설정 확인
SELECT 
    proname as function_name,
    prosecdef as security_definer,
    proconfig as config_settings
FROM pg_proc
WHERE proname = 'update_updated_at_column';
```

## 추가 보안 권장사항

1. **API 키 관리**
   - `service_role` 키는 절대 클라이언트에 노출하지 마세요
   - 환경 변수로 관리하고 `.env` 파일을 `.gitignore`에 추가

2. **네트워크 제한**
   - Supabase Dashboard → **Settings** → **Network Restrictions**
   - 허용된 IP 주소만 접근 가능하도록 설정

3. **정기적인 보안 점검**
   - Security Advisor를 정기적으로 확인
   - 의존성 업데이트 (`npm audit`)

4. **백업 및 복구**
   - 정기적인 데이터베이스 백업 설정
   - 재해 복구 계획 수립

