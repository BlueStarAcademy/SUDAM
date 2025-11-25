-- ============================================
-- Supabase Security Advisor 오류 및 위험 해결
-- ============================================
-- 이 스크립트는 Supabase Security Advisor에서 발견된 보안 문제를 해결합니다.
-- 
-- 실행 방법:
-- 1. Supabase Dashboard → SQL Editor 열기
-- 2. 아래 SQL 전체를 복사하여 붙여넣기
-- 3. "Run" 버튼 클릭
-- ============================================

-- ============================================
-- 1. RLS (Row Level Security) 활성화
-- ============================================
-- 모든 테이블에 RLS를 활성화합니다.
-- 주의: Prisma를 사용하는 경우 service_role 키로 접근하므로
-- RLS가 적용되지 않습니다. 하지만 Supabase Security Advisor 경고를 해결하기 위해 활성화합니다.

-- User 테이블
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

-- UserInventory 테이블
ALTER TABLE "UserInventory" ENABLE ROW LEVEL SECURITY;

-- UserEquipment 테이블
ALTER TABLE "UserEquipment" ENABLE ROW LEVEL SECURITY;

-- UserMail 테이블
ALTER TABLE "UserMail" ENABLE ROW LEVEL SECURITY;

-- UserQuest 테이블
ALTER TABLE "UserQuest" ENABLE ROW LEVEL SECURITY;

-- UserMission 테이블
ALTER TABLE "UserMission" ENABLE ROW LEVEL SECURITY;

-- InventoryHistory 테이블
ALTER TABLE "InventoryHistory" ENABLE ROW LEVEL SECURITY;

-- UserCredential 테이블 (민감한 정보 포함)
ALTER TABLE "UserCredential" ENABLE ROW LEVEL SECURITY;

-- EmailVerificationToken 테이블
ALTER TABLE "EmailVerificationToken" ENABLE ROW LEVEL SECURITY;

-- LiveGame 테이블
ALTER TABLE "LiveGame" ENABLE ROW LEVEL SECURITY;

-- KeyValue 테이블
ALTER TABLE "KeyValue" ENABLE ROW LEVEL SECURITY;

-- HomeBoardPost 테이블
ALTER TABLE "HomeBoardPost" ENABLE ROW LEVEL SECURITY;

-- Guild 테이블
ALTER TABLE "Guild" ENABLE ROW LEVEL SECURITY;

-- GuildMember 테이블
ALTER TABLE "GuildMember" ENABLE ROW LEVEL SECURITY;

-- GuildMessage 테이블
ALTER TABLE "GuildMessage" ENABLE ROW LEVEL SECURITY;

-- GuildMission 테이블
ALTER TABLE "GuildMission" ENABLE ROW LEVEL SECURITY;

-- GuildShop 테이블
ALTER TABLE "GuildShop" ENABLE ROW LEVEL SECURITY;

-- GuildDonation 테이블
ALTER TABLE "GuildDonation" ENABLE ROW LEVEL SECURITY;

-- GuildWar 테이블
ALTER TABLE "GuildWar" ENABLE ROW LEVEL SECURITY;

-- GuildWarMatch 테이블
ALTER TABLE "GuildWarMatch" ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations 테이블 (Prisma 마이그레이션 테이블)
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. RLS 정책 설정 (서비스 역할만 접근 허용)
-- ============================================
-- Prisma는 service_role 키를 사용하므로, 모든 접근을 차단하는 정책을 설정합니다.
-- 이렇게 하면 Supabase의 PostgREST API를 통한 직접 접근은 차단되지만,
-- Prisma를 통한 접근(service_role)은 정상적으로 작동합니다.

-- User 테이블 정책: 서비스 역할만 접근 허용
DROP POLICY IF EXISTS "Service role only" ON "User";
CREATE POLICY "Service role only" ON "User"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserInventory 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "UserInventory";
CREATE POLICY "Service role only" ON "UserInventory"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserEquipment 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "UserEquipment";
CREATE POLICY "Service role only" ON "UserEquipment"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserMail 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "UserMail";
CREATE POLICY "Service role only" ON "UserMail"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserQuest 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "UserQuest";
CREATE POLICY "Service role only" ON "UserQuest"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserMission 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "UserMission";
CREATE POLICY "Service role only" ON "UserMission"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- InventoryHistory 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "InventoryHistory";
CREATE POLICY "Service role only" ON "InventoryHistory"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- UserCredential 테이블 정책 (민감한 정보)
DROP POLICY IF EXISTS "Service role only" ON "UserCredential";
CREATE POLICY "Service role only" ON "UserCredential"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- EmailVerificationToken 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "EmailVerificationToken";
CREATE POLICY "Service role only" ON "EmailVerificationToken"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- LiveGame 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "LiveGame";
CREATE POLICY "Service role only" ON "LiveGame"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- KeyValue 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "KeyValue";
CREATE POLICY "Service role only" ON "KeyValue"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- HomeBoardPost 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "HomeBoardPost";
CREATE POLICY "Service role only" ON "HomeBoardPost"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- Guild 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "Guild";
CREATE POLICY "Service role only" ON "Guild"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildMember 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildMember";
CREATE POLICY "Service role only" ON "GuildMember"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildMessage 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildMessage";
CREATE POLICY "Service role only" ON "GuildMessage"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildMission 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildMission";
CREATE POLICY "Service role only" ON "GuildMission"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildShop 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildShop";
CREATE POLICY "Service role only" ON "GuildShop"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildDonation 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildDonation";
CREATE POLICY "Service role only" ON "GuildDonation"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildWar 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildWar";
CREATE POLICY "Service role only" ON "GuildWar"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- GuildWarMatch 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "GuildWarMatch";
CREATE POLICY "Service role only" ON "GuildWarMatch"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- _prisma_migrations 테이블 정책
DROP POLICY IF EXISTS "Service role only" ON "_prisma_migrations";
CREATE POLICY "Service role only" ON "_prisma_migrations"
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- ============================================
-- 3. 함수 search_path 설정 (보안 강화)
-- ============================================
-- update_updated_at_column 함수의 search_path를 명시적으로 설정하여
-- search_path 조작 공격을 방지합니다.
-- 주의: 함수가 정상 작동하려면 'public' 스키마가 필요합니다.

ALTER FUNCTION update_updated_at_column() SET search_path = 'public';

-- ============================================
-- 4. 확인 쿼리
-- ============================================
-- 아래 쿼리를 실행하여 RLS가 활성화되었는지 확인하세요:

-- RLS 활성화 상태 확인
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- RLS 정책 확인
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================
-- 참고사항
-- ============================================
-- 1. 이 정책은 Supabase의 PostgREST API (anon 키)를 통한 접근을 차단합니다.
-- 2. Prisma는 service_role 키를 사용하므로 정상적으로 작동합니다.
-- 3. Supabase Security Advisor 경고가 해결됩니다.
-- 4. 만약 나중에 Supabase의 PostgREST API를 사용하려면 정책을 수정해야 합니다.

