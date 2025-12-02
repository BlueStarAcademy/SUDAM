/**
 * 모든 유저의 챔피언십 관련 데이터를 완전히 초기화하는 스크립트
 * - 던전 진행 상태 초기화
 * - 토너먼트 상태 초기화
 * - 일일 랭킹 데이터 초기화
 * - 챔피언십 점수 초기화
 */

import * as db from '../db.js';
import * as types from '../../types/index.js';

const resetAllChampionshipData = async () => {
    console.log('[ResetChampionshipData] Starting complete championship data reset...');
    
    const allUsers = await db.getAllUsers();
    console.log(`[ResetChampionshipData] Found ${allUsers.length} users`);
    
    let usersUpdated = 0;
    let dungeonProgressReset = 0;
    let tournamentStateReset = 0;
    let dailyRankingsReset = 0;
    let scoreReset = 0;
    
    for (const user of allUsers) {
        let hasChanges = false;
        const updatedUser = JSON.parse(JSON.stringify(user));
        
        // 1. 던전 진행 상태 초기화
        if (updatedUser.dungeonProgress) {
            updatedUser.dungeonProgress = {
                neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
            };
            hasChanges = true;
            dungeonProgressReset++;
            console.log(`[ResetChampionshipData] Reset dungeonProgress for ${updatedUser.nickname} (${updatedUser.id})`);
        }
        
        // 2. 토너먼트 상태 초기화
        if (updatedUser.lastNeighborhoodTournament) {
            updatedUser.lastNeighborhoodTournament = null;
            hasChanges = true;
            tournamentStateReset++;
        }
        if (updatedUser.lastNationalTournament) {
            updatedUser.lastNationalTournament = null;
            hasChanges = true;
            tournamentStateReset++;
        }
        if (updatedUser.lastWorldTournament) {
            updatedUser.lastWorldTournament = null;
            hasChanges = true;
            tournamentStateReset++;
        }
        
        // 3. 플레이 날짜 초기화
        if (updatedUser.lastNeighborhoodPlayedDate) {
            updatedUser.lastNeighborhoodPlayedDate = null;
            hasChanges = true;
        }
        if (updatedUser.lastNationalPlayedDate) {
            updatedUser.lastNationalPlayedDate = null;
            hasChanges = true;
        }
        if (updatedUser.lastWorldPlayedDate) {
            updatedUser.lastWorldPlayedDate = null;
            hasChanges = true;
        }
        
        // 4. 일일 랭킹 데이터 초기화 (championship 부분만)
        if (updatedUser.dailyRankings) {
            if (updatedUser.dailyRankings.championship) {
                updatedUser.dailyRankings.championship = undefined;
                hasChanges = true;
                dailyRankingsReset++;
            }
        }
        
        // 5. 챔피언십 점수 초기화
        if (updatedUser.dailyDungeonScore !== undefined && updatedUser.dailyDungeonScore !== 0) {
            updatedUser.dailyDungeonScore = 0;
            hasChanges = true;
            scoreReset++;
        }
        if (updatedUser.cumulativeTournamentScore !== undefined && updatedUser.cumulativeTournamentScore !== 0) {
            updatedUser.cumulativeTournamentScore = 0;
            hasChanges = true;
            scoreReset++;
        }
        if (updatedUser.tournamentScore !== undefined && updatedUser.tournamentScore !== 0) {
            updatedUser.tournamentScore = 0;
            hasChanges = true;
            scoreReset++;
        }
        
        // 6. 보상 수령 상태 초기화 (선택사항)
        if (updatedUser.neighborhoodRewardClaimed) {
            updatedUser.neighborhoodRewardClaimed = false;
            hasChanges = true;
        }
        if (updatedUser.nationalRewardClaimed) {
            updatedUser.nationalRewardClaimed = false;
            hasChanges = true;
        }
        if (updatedUser.worldRewardClaimed) {
            updatedUser.worldRewardClaimed = false;
            hasChanges = true;
        }
        
        if (hasChanges) {
            await db.updateUser(updatedUser);
            usersUpdated++;
        }
    }
    
    console.log(`[ResetChampionshipData] Reset complete:`);
    console.log(`  - Users updated: ${usersUpdated}/${allUsers.length}`);
    console.log(`  - Dungeon progress reset: ${dungeonProgressReset}`);
    console.log(`  - Tournament states reset: ${tournamentStateReset}`);
    console.log(`  - Daily rankings reset: ${dailyRankingsReset}`);
    console.log(`  - Scores reset: ${scoreReset}`);
    console.log(`[ResetChampionshipData] All championship data has been reset. Users can now start fresh.`);
};

// 스크립트 실행
resetAllChampionshipData()
    .then(() => {
        console.log('[ResetChampionshipData] Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[ResetChampionshipData] Script failed:', error);
        process.exit(1);
    });
