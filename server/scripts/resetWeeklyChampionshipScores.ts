// 주간 챔피언십 점수만 0으로 초기화하는 스크립트 (누적 점수는 유지)

import * as db from '../db.js';
import * as types from '../../types/index.js';

const resetWeeklyChampionshipScores = async () => {
    console.log('[WeeklyReset] Starting weekly championship score reset (tournamentScore only)...');
    
    const allUsers = await db.getAllUsers();
    console.log(`[WeeklyReset] Found ${allUsers.length} users`);
    
    let usersUpdated = 0;
    let tournamentScoreReset = 0;
    
    for (const user of allUsers) {
        let needsUpdate = false;
        const updatedUser = JSON.parse(JSON.stringify(user));
        
        // 주간 챔피언십 점수 (tournamentScore)만 0으로 초기화
        // 누적 점수 (cumulativeTournamentScore)는 유지
        if (updatedUser.tournamentScore !== 0) {
            updatedUser.tournamentScore = 0;
            needsUpdate = true;
            tournamentScoreReset++;
            console.log(`[WeeklyReset] Reset tournamentScore for ${updatedUser.nickname} (${updatedUser.id}): ${user.tournamentScore} -> 0`);
        }
        
        // yesterdayTournamentScore를 현재 누적 점수로 설정 (변화없음으로 표시)
        const currentCumulative = updatedUser.cumulativeTournamentScore || 0;
        if (updatedUser.yesterdayTournamentScore !== currentCumulative) {
            updatedUser.yesterdayTournamentScore = currentCumulative;
            needsUpdate = true;
        }
        
        // dailyRankings.championship 업데이트 (점수는 누적 점수 유지, rank는 0으로 초기화)
        if (!updatedUser.dailyRankings) {
            updatedUser.dailyRankings = {};
        }
        if (!updatedUser.dailyRankings.championship || updatedUser.dailyRankings.championship.score !== currentCumulative) {
            updatedUser.dailyRankings.championship = {
                rank: 0, // 랭킹은 나중에 processDailyRankings에서 업데이트됨
                score: currentCumulative, // 누적 점수 유지
                lastUpdated: Date.now()
            };
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            await db.updateUser(updatedUser);
            usersUpdated++;
        }
    }
    
    console.log(`[WeeklyReset] ========================================`);
    console.log(`[WeeklyReset] Weekly championship score reset completed!`);
    console.log(`[WeeklyReset] ========================================`);
    console.log(`[WeeklyReset] Users updated: ${usersUpdated}`);
    console.log(`[WeeklyReset] tournamentScore reset: ${tournamentScoreReset}`);
    console.log(`[WeeklyReset] cumulativeTournamentScore: MAINTAINED (not reset)`);
    console.log(`[WeeklyReset] ========================================`);
};

// 스크립트 실행
resetWeeklyChampionshipScores()
    .then(() => {
        console.log('[WeeklyReset] Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[WeeklyReset] Script failed:', error);
        process.exit(1);
    });

