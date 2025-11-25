// 긴급: 모든 유저의 챔피언십 점수를 0으로 초기화하는 스크립트

import * as db from '../db.js';
import * as types from '../../types/index.js';

const resetAllChampionshipScores = async () => {
    console.log('[Emergency] Starting championship score reset...');
    
    const allUsers = await db.getAllUsers();
    console.log(`[Emergency] Found ${allUsers.length} users`);
    
    let usersUpdated = 0;
    let tournamentScoreReset = 0;
    let cumulativeScoreReset = 0;
    
    for (const user of allUsers) {
        let needsUpdate = false;
        const updatedUser = JSON.parse(JSON.stringify(user));
        
        // 1. 주간 챔피언십 점수 (tournamentScore)를 0으로 초기화
        if (updatedUser.tournamentScore !== 0) {
            updatedUser.tournamentScore = 0;
            needsUpdate = true;
            tournamentScoreReset++;
            console.log(`[Emergency] Reset tournamentScore for ${updatedUser.nickname} (${updatedUser.id}): ${user.tournamentScore} -> 0`);
        }
        
        // 2. 누적 챔피언십 점수 (cumulativeTournamentScore)도 0으로 초기화
        if ((updatedUser.cumulativeTournamentScore || 0) !== 0) {
            updatedUser.cumulativeTournamentScore = 0;
            needsUpdate = true;
            cumulativeScoreReset++;
            console.log(`[Emergency] Reset cumulativeTournamentScore for ${updatedUser.nickname} (${updatedUser.id}): ${user.cumulativeTournamentScore || 0} -> 0`);
        }
        
        // 3. yesterdayTournamentScore도 0으로 초기화
        if ((updatedUser.yesterdayTournamentScore || 0) !== 0) {
            updatedUser.yesterdayTournamentScore = 0;
            needsUpdate = true;
        }
        
        // 4. dailyRankings.championship도 초기화
        if (updatedUser.dailyRankings?.championship) {
            if (updatedUser.dailyRankings.championship.score !== 0 || updatedUser.dailyRankings.championship.rank !== 0) {
                updatedUser.dailyRankings.championship = {
                    rank: 0,
                    score: 0,
                    lastUpdated: Date.now()
                };
                needsUpdate = true;
            }
        }
        
        if (needsUpdate) {
            await db.updateUser(updatedUser);
            usersUpdated++;
        }
    }
    
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Championship score reset completed!`);
    console.log(`[Emergency] ========================================`);
    console.log(`[Emergency] Users updated: ${usersUpdated}`);
    console.log(`[Emergency] tournamentScore reset: ${tournamentScoreReset}`);
    console.log(`[Emergency] cumulativeTournamentScore reset: ${cumulativeScoreReset}`);
    console.log(`[Emergency] ========================================`);
};

// 스크립트 실행
resetAllChampionshipScores()
    .then(() => {
        console.log('[Emergency] Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Emergency] Script failed:', error);
        process.exit(1);
    });

