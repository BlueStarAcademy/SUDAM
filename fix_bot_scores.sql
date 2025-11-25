-- 봇 점수 복구를 위한 SQL 스크립트
-- PostgreSQL에서 실행하세요

-- ============================================
-- 모든 봇 점수를 7~350 사이 랜덤 값으로 설정
-- ============================================

DO $$
DECLARE
    user_record RECORD;
    competitor_record RECORD;
    bot_id TEXT;
    random_score INTEGER;
    yesterday_score INTEGER;
    bot_scores JSONB;
    current_status JSONB;
    current_league_metadata JSONB;
    now_timestamp BIGINT;
    updated_count INTEGER := 0;
    total_bots INTEGER := 0;
    skipped_no_competitors INTEGER := 0;
    skipped_no_bots INTEGER := 0;
BEGIN
    -- 현재 타임스탬프 (밀리초)
    now_timestamp := EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
    
    -- 모든 유저 순회 (status가 NULL이거나 leagueMetadata가 없는 경우도 포함)
    FOR user_record IN 
        SELECT id, nickname, status
        FROM "User"
    LOOP
        -- status가 없으면 빈 객체로 초기화
        current_status := COALESCE(user_record.status, '{}'::jsonb);
        
        -- leagueMetadata가 없으면 생성
        IF current_status->'leagueMetadata' IS NULL THEN
            current_status := jsonb_set(current_status, '{leagueMetadata}', '{}'::jsonb, true);
        END IF;
        
        current_league_metadata := current_status->'leagueMetadata';
        
        -- weeklyCompetitors가 없거나 배열이 아니면 건너뛰기
        IF current_league_metadata->'weeklyCompetitors' IS NULL 
           OR jsonb_typeof(current_league_metadata->'weeklyCompetitors') != 'array' THEN
            skipped_no_competitors := skipped_no_competitors + 1;
            CONTINUE;
        END IF;
        
        -- 각 유저의 봇 점수 객체 초기화
        bot_scores := '{}'::jsonb;
        
        -- weeklyCompetitors 배열에서 봇 찾기
        FOR competitor_record IN 
            SELECT jsonb_array_elements(current_league_metadata->'weeklyCompetitors') AS competitor
        LOOP
            -- 봇 ID 확인 (bot-으로 시작하는 경우)
            bot_id := competitor_record.competitor->>'id';
            
            IF bot_id LIKE 'bot-%' THEN
                -- 7~350 사이 랜덤 점수 생성
                random_score := floor(random() * 344) + 7; -- 344 = 350 - 7 + 1
                
                -- 어제 점수도 랜덤으로 생성 (random_score의 80~95% 정도로 설정)
                yesterday_score := floor(random() * (random_score * 0.15)) + floor(random_score * 0.80);
                IF yesterday_score < 0 THEN yesterday_score := 0; END IF;
                IF yesterday_score >= random_score THEN yesterday_score := floor(random_score * 0.9); END IF;
                
                -- 봇 점수 객체에 추가
                bot_scores := bot_scores || jsonb_build_object(
                    bot_id,
                    jsonb_build_object(
                        'score', random_score,
                        'lastUpdate', now_timestamp,
                        'yesterdayScore', yesterday_score
                    )
                );
                
                total_bots := total_bots + 1;
            END IF;
        END LOOP;
        
        -- 봇이 하나라도 있으면 업데이트
        IF bot_scores != '{}'::jsonb AND jsonb_typeof(bot_scores) = 'object' THEN
            -- leagueMetadata에 weeklyCompetitorsBotScores 추가/업데이트
            current_league_metadata := jsonb_set(
                current_league_metadata,
                '{weeklyCompetitorsBotScores}',
                bot_scores,
                true
            );
            
            -- status에 leagueMetadata 업데이트
            current_status := jsonb_set(
                current_status,
                '{leagueMetadata}',
                current_league_metadata,
                true
            );
            
            -- User 테이블 업데이트
            UPDATE "User"
            SET status = current_status
            WHERE id = user_record.id;
            
            updated_count := updated_count + 1;
        ELSE
            skipped_no_bots := skipped_no_bots + 1;
        END IF;
    END LOOP;
    
    RAISE NOTICE '========== 봇 점수 업데이트 완료 ==========';
    RAISE NOTICE '업데이트된 유저: %명', updated_count;
    RAISE NOTICE '총 봇 수: %개', total_bots;
    RAISE NOTICE '건너뛴 유저: 경쟁상대 없음 %명, 봇 없음 %명', skipped_no_competitors, skipped_no_bots;
END $$;

-- ============================================
-- 업데이트 결과 확인
-- ============================================

SELECT 
    u.id,
    u.nickname,
    bot_key as bot_id,
    (u.status->'leagueMetadata'->'weeklyCompetitorsBotScores'->bot_key->>'score')::INTEGER as bot_score,
    (u.status->'leagueMetadata'->'weeklyCompetitorsBotScores'->bot_key->>'yesterdayScore')::INTEGER as yesterday_score,
    (u.status->'leagueMetadata'->'weeklyCompetitorsBotScores'->bot_key->>'lastUpdate')::BIGINT as last_update
FROM "User" u,
LATERAL jsonb_object_keys(u.status->'leagueMetadata'->'weeklyCompetitorsBotScores') AS bot_key
WHERE u.status->'leagueMetadata'->'weeklyCompetitorsBotScores' IS NOT NULL
  AND jsonb_typeof(u.status->'leagueMetadata'->'weeklyCompetitorsBotScores') = 'object'
ORDER BY u.nickname, bot_key
LIMIT 50;

-- ============================================
-- 통계 확인
-- ============================================

WITH bot_scores_expanded AS (
    SELECT 
        u.id,
        u.nickname,
        bot_key,
        (u.status->'leagueMetadata'->'weeklyCompetitorsBotScores'->bot_key->>'score')::INTEGER as bot_score
    FROM "User" u,
    LATERAL jsonb_object_keys(u.status->'leagueMetadata'->'weeklyCompetitorsBotScores') AS bot_key
    WHERE u.status->'leagueMetadata'->'weeklyCompetitorsBotScores' IS NOT NULL
      AND jsonb_typeof(u.status->'leagueMetadata'->'weeklyCompetitorsBotScores') = 'object'
)
SELECT 
    COUNT(DISTINCT id) as total_users,
    COUNT(*) as total_bots,
    AVG(bot_score)::INTEGER as avg_score,
    MIN(bot_score) as min_score,
    MAX(bot_score) as max_score
FROM bot_scores_expanded;

