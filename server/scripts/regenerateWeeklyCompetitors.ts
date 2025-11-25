// 긴급: 모든 유저의 주간 경쟁 상대를 다시 생성하고 봇 점수를 초기화하는 스크립트

import * as db from '../db.js';
import * as types from '../../types/index.js';
import { updateWeeklyCompetitorsIfNeeded } from '../scheduledTasks.js';
import { getKSTFullYear, getKSTMonth, getKSTDate_UTC } from '../../utils/timeUtils.js';

const regenerateWeeklyCompetitors = async () => {
    console.log('[Emergency] Starting weekly competitors regeneration...');
    
    const allUsers = await db.getAllUsers();
    console.log(`[Emergency] Found ${allUsers.length} users`);
    
    let usersUpdated = 0;
    let botsCreated = 0;
    const now = Date.now();
    
    for (const user of allUsers) {
        const updatedUser = JSON.parse(JSON.stringify(user));
        
        // lastWeeklyCompetitorsUpdate를 리셋하여 강제로 다시 매칭되도록 함
        updatedUser.lastWeeklyCompetitorsUpdate = undefined;
        
        // weeklyCompetitorsBotScores 초기화
        updatedUser.weeklyCompetitorsBotScores = {};
        
        // updateWeeklyCompetitorsIfNeeded를 강제로 실행하기 위해 lastWeeklyCompetitorsUpdate를 undefined로 설정한 후 호출
        const regeneratedUser = await updateWeeklyCompetitorsIfNeeded(updatedUser, allUsers);
        
        // 봇 점수 생성 (오늘 날짜 기준)
        // 클라이언트에서 봇을 동적으로 추가하므로, 클라이언트 형식의 봇 ID로 점수를 미리 생성
        const kstYear = getKSTFullYear(now);
        const kstMonth = getKSTMonth(now) + 1;
        const kstDate = getKSTDate_UTC(now);
        const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
        // KST 0시 타임스탬프 계산 (클라이언트와 동일한 방식)
        const currentKstDayStart = new Date(`${dateStr}T00:00:00+09:00`).getTime();
        
        if (!regeneratedUser.weeklyCompetitorsBotScores) {
            regeneratedUser.weeklyCompetitorsBotScores = {};
        }
        
        // 클라이언트는 최대 16명의 경쟁 상대를 표시하므로, 봇은 최대 15개까지 추가될 수 있음
        // 실제 유저 수를 확인하고 부족한 만큼 봇 점수 생성
        const actualUserCount = regeneratedUser.weeklyCompetitors ? 
            regeneratedUser.weeklyCompetitors.filter(c => !c.id.startsWith('bot-')).length : 0;
        const botsNeeded = Math.max(0, 16 - actualUserCount);
        
        // 클라이언트 형식의 봇 ID로 점수 생성 (bot-{currentKstDayStart}-{index})
        for (let i = 0; i < botsNeeded; i++) {
            const botId = `bot-${currentKstDayStart}-${i}`;
            
            // 봇 점수가 없거나 0이면 생성/업데이트
            if (!regeneratedUser.weeklyCompetitorsBotScores[botId] || 
                regeneratedUser.weeklyCompetitorsBotScores[botId].score === 0) {
                // 1-50 사이의 랜덤값 생성 (봇 ID와 날짜를 시드로 사용)
                const seedStr = `${botId}-${dateStr}`;
                let seed = 0;
                for (let j = 0; j < seedStr.length; j++) {
                    seed = ((seed << 5) - seed) + seedStr.charCodeAt(j);
                    seed = seed & seed;
                }
                const randomVal = Math.abs(Math.sin(seed)) * 10000;
                const initialGain = Math.floor((randomVal % 50)) + 1; // 1-50
                
                regeneratedUser.weeklyCompetitorsBotScores[botId] = {
                    score: initialGain,
                    lastUpdate: now,
                    yesterdayScore: 0
                };
                botsCreated++;
                console.log(`[Emergency] Created bot score for ${botId}: ${initialGain}점`);
            }
        }
        
        // 기존 봇 점수 중 클라이언트 형식이 아닌 것들은 삭제
        const existingBotIds = Object.keys(regeneratedUser.weeklyCompetitorsBotScores);
        for (const botId of existingBotIds) {
            if (!botId.match(/^bot-\d+-\d+$/)) {
                delete regeneratedUser.weeklyCompetitorsBotScores[botId];
            }
        }
        
        await db.updateUser(regeneratedUser);
        usersUpdated++;
    }
    
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Weekly competitors regeneration completed!`);
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Users updated: ${usersUpdated}`);
    console.log(`[Emergency] Bots created: ${botsCreated}`);
    console.log(`[Emergency] ========================================`);
};

// 스크립트 실행
regenerateWeeklyCompetitors()
    .then(() => {
        console.log('[Emergency] Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Emergency] Script failed:', error);
        process.exit(1);
    });

