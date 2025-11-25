// 긴급: 이번 주 경쟁 상대 봇들의 점수를 1~50점씩 추가하는 스크립트

import * as db from '../db.js';
import * as types from '../../types/index.js';

const addBotScores = async () => {
    console.log('[Emergency] Starting bot score addition...');
    
    const allUsers = await db.getAllUsers();
    console.log(`[Emergency] Found ${allUsers.length} users`);
    
    let usersUpdated = 0;
    let botsUpdated = 0;
    
    for (const user of allUsers) {
        let needsUpdate = false;
        const updatedUser = JSON.parse(JSON.stringify(user));
        
        // 이번 주 경쟁 상대 봇들의 점수를 1~50점씩 추가
        if (updatedUser.weeklyCompetitorsBotScores && Object.keys(updatedUser.weeklyCompetitorsBotScores).length > 0) {
            for (const botId in updatedUser.weeklyCompetitorsBotScores) {
                const botScoreData = updatedUser.weeklyCompetitorsBotScores[botId];
                if (botScoreData && botScoreData.score !== undefined) {
                    // 1~50 사이의 랜덤값 생성
                    const randomGain = Math.floor(Math.random() * 50) + 1;
                    const oldScore = botScoreData.score;
                    botScoreData.score = oldScore + randomGain;
                    botScoreData.lastUpdate = Date.now();
                    
                    botsUpdated++;
                    needsUpdate = true;
                    console.log(`[Emergency] Updated bot ${botId} score for ${updatedUser.nickname}: ${oldScore} -> ${botScoreData.score} (+${randomGain})`);
                }
            }
        }
        
        if (needsUpdate) {
            await db.updateUser(updatedUser);
            usersUpdated++;
        }
    }
    
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Bot score addition completed!`);
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Users updated: ${usersUpdated}`);
    console.log(`[Emergency] Bots updated: ${botsUpdated}`);
    console.log(`[Emergency] ========================================`);
};

// 스크립트 실행
addBotScores()
    .then(() => {
        console.log('[Emergency] Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Emergency] Script failed:', error);
        process.exit(1);
    });

