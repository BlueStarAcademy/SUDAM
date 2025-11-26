

import * as db from './db.js';
import * as types from '../types/index.js';
import type { WeeklyCompetitor } from '../types/index.js';
import { RANKING_TIERS, SEASONAL_TIER_REWARDS, BORDER_POOL, LEAGUE_DATA, LEAGUE_WEEKLY_REWARDS, SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, SEASONAL_TIER_BORDERS, DAILY_QUESTS, WEEKLY_QUESTS, MONTHLY_QUESTS, TOURNAMENT_DEFINITIONS, BOT_NAMES, AVATAR_POOL } from '../constants';
import { randomUUID } from 'crypto';
import { getKSTDate, getCurrentSeason, getPreviousSeason, SeasonInfo, isDifferentWeekKST, isSameDayKST, getStartOfDayKST, isDifferentDayKST, isDifferentMonthKST, getKSTDay, getKSTHours, getKSTMinutes, getKSTFullYear, getKSTMonth, getKSTDate_UTC } from '../utils/timeUtils.js';
import { resetAndGenerateQuests } from './gameActions.js';
import * as tournamentService from './tournamentService.js';
import { calculateTotalStats } from './statService.js';
import { TournamentType } from '../types/index.js';
import { startTournamentSessionForUser } from './actions/tournamentActions.js';
import { broadcast } from './socket.js';
import * as mailRepo from './prisma/mailRepository.js';

let lastSeasonProcessed: SeasonInfo | null = null;
let lastWeeklyResetTimestamp: number | null = null;
let lastWeeklyLeagueUpdateTimestamp: number | null = null;
let lastDailyRankingUpdateTimestamp: number | null = null;
let lastDailyQuestResetTimestamp: number | null = null;
let lastTowerRankingRewardTimestamp: number | null = null;

export function setLastWeeklyLeagueUpdateTimestamp(timestamp: number): void {
    lastWeeklyLeagueUpdateTimestamp = timestamp;
}

export function getLastWeeklyLeagueUpdateTimestamp(): number | null {
    return lastWeeklyLeagueUpdateTimestamp;
}

const processRewardsForSeason = async (season: SeasonInfo) => {
    console.log(`[Scheduler] Processing rewards for ${season.name}...`);
    const allGameModes = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES].map(m => m.mode);
    const rewards = SEASONAL_TIER_REWARDS;

    const allUsers = await db.getAllUsers();
    const tierOrder = RANKING_TIERS.map(t => t.name);
    const now = Date.now();

    // Pre-calculate rankings for all modes to avoid repeated sorting
    const rankingsByMode: Record<string, { user: types.User, rank: number }[]> = {};
    for (const mode of allGameModes) {
        const eligibleUsers = allUsers
            .filter(u => u.stats?.[mode] && (u.stats[mode].wins + u.stats[mode].losses) >= 20)
            .sort((a, b) => (b.stats![mode].rankingScore || 0) - (a.stats![mode].rankingScore || 0));
        
        rankingsByMode[mode] = eligibleUsers.map((user, index) => ({ user, rank: index + 1 }));
    }

    for (const user of allUsers) {
        let bestTierInfo: { tierName: string, mode: types.GameMode } | null = null;
        let bestTierRank = Infinity;

        // Find user's best tier across all modes
        for (const mode of allGameModes) {
            const modeRanking = rankingsByMode[mode];
            const totalEligiblePlayers = modeRanking.length;
            const userRankInfo = modeRanking.find(r => r.user.id === user.id);
            
            let currentTierName = '새싹'; // Default

            if (userRankInfo) { // User was eligible and ranked
                const userScore = userRankInfo.user.stats![mode].rankingScore || 0;
                const userTotalGames = (userRankInfo.user.stats![mode].wins || 0) + (userRankInfo.user.stats![mode].losses || 0);
                for (const tier of RANKING_TIERS) {
                    if (tier.threshold(userScore, userRankInfo.rank, userTotalGames)) {
                        currentTierName = tier.name;
                        break;
                    }
                }
            }
            
            // Store historical tier for this mode
            if (!user.seasonHistory) user.seasonHistory = {};
            if (!user.seasonHistory[season.name]) user.seasonHistory[season.name] = {};
            user.seasonHistory[season.name][mode] = currentTierName;

            // Check if this is the best tier so far
            const currentTierIndex = tierOrder.indexOf(currentTierName);
            if (currentTierIndex < bestTierRank) {
                bestTierRank = currentTierIndex;
                bestTierInfo = { tierName: currentTierName, mode };
            }
        }
        
        // If the user participated in any mode, they have a best tier
        if (bestTierInfo) {
            user.previousSeasonTier = bestTierInfo.tierName;

            // 1. Grant border reward
            const seasonalBorderId = SEASONAL_TIER_BORDERS[bestTierInfo.tierName];
            if (seasonalBorderId) {
                if (!user.ownedBorders) user.ownedBorders = ['default', 'simple_black']; // Ensure array exists
                if (!user.ownedBorders.includes(seasonalBorderId)) {
                    user.ownedBorders.push(seasonalBorderId);
                }
                user.borderId = seasonalBorderId; // Equip the seasonal border
            }
            
            // 2. Grant mail reward
            const reward = rewards[bestTierInfo.tierName];
            if (reward) {
                const mailTitle = `${season.name} 최고 티어는 "${bestTierInfo.tierName}" 티어입니다.`;
                const mailMessage = `프로필의 테두리 아이템을 한 시즌동안 사용하실 수 있습니다.\n티어 보상 상품을 수령하세요.`;
                
                const mail: types.Mail = {
                    id: `mail-season-${randomUUID()}`,
                    from: 'System',
                    title: mailTitle,
                    message: mailMessage,
                    attachments: reward,
                    receivedAt: now,
                    expiresAt: now + 14 * 24 * 60 * 60 * 1000, // 14 days
                    isRead: false,
                    attachmentsClaimed: false,
                };
                if (!user.mail) user.mail = [];
                user.mail.unshift(mail); // Add to the top
            }
        }
        
        // 3. Reset game mode stats for the new season
        // 놀이바둑만 1200점으로 초기화, 전략바둑은 점수 유지
        if (user.stats) {
            const playfulModes = PLAYFUL_GAME_MODES.map(m => m.mode);
            const strategicModes = SPECIAL_GAME_MODES.map(m => m.mode);
            
            for (const mode of allGameModes) {
                if (user.stats[mode]) {
                    if (playfulModes.includes(mode)) {
                        // 놀이바둑: 매 시즌 1200점으로 초기화
                        user.stats[mode] = { wins: 0, losses: 0, rankingScore: 1200 };
                    } else if (strategicModes.includes(mode)) {
                        // 전략바둑: 점수 유지, 승패만 초기화
                        const currentScore = user.stats[mode].rankingScore || 1200;
                        user.stats[mode] = { wins: 0, losses: 0, rankingScore: currentScore };
                    } else {
                        // 기타 모드: 1200점으로 초기화 (기본 동작)
                        user.stats[mode] = { wins: 0, losses: 0, rankingScore: 1200 };
                    }
                }
            }
        }

        // 4. Save the updated user
        await db.updateUser(user);
    } // End of user loop
    
    console.log(`[Scheduler] Finished processing rewards and resetting stats for ${season.name}.`);
};

export const processRankingRewards = async (volatileState: types.VolatileState): Promise<void> => {
    const now = Date.now();
    const kstMonth = getKSTMonth(now);
    const kstDate = getKSTDate_UTC(now);
    const kstHours = getKSTHours(now);
    
    // Check if it's the start of a new season day
    const isNewSeasonDay = 
        (kstMonth === 0 && kstDate === 1) || // Jan 1
        (kstMonth === 3 && kstDate === 1) || // Apr 1
        (kstMonth === 6 && kstDate === 1) || // Jul 1
        (kstMonth === 9 && kstDate === 1);   // Oct 1

    if (!isNewSeasonDay || kstHours !== 0) { // Only run at midnight KST
        return;
    }

    if (lastSeasonProcessed === null) {
        const saved = await db.getKV<SeasonInfo>('lastSeasonProcessed');
        if (saved) {
            lastSeasonProcessed = saved;
        } else {
            // First time ever, set to previous season to prevent running on first boot
            lastSeasonProcessed = getPreviousSeason(now);
            await db.setKV('lastSeasonProcessed', lastSeasonProcessed);
            return;
        }
    }
    
    const currentSeason = getCurrentSeason(now);
    
    // Check if the current season is different from the last one we processed
    if (lastSeasonProcessed.name !== currentSeason.name) {
        const previousSeason = getPreviousSeason(now);
        await processRewardsForSeason(previousSeason);
        
        // Update the state to reflect that the new season has been processed
        lastSeasonProcessed = currentSeason;
        await db.setKV('lastSeasonProcessed', lastSeasonProcessed);
    }
};

// 월요일 0시에 티어변동 후 새로운 경쟁상대를 매칭하고 모든 점수를 리셋하는 함수
// 주의: 이 함수는 processWeeklyLeagueUpdates 이후에 호출되어야 함 (티어변동 후 새로운 경쟁상대 매칭)
// force: true로 호출되면 월요일 0시 체크를 건너뛰고 강제 실행
export async function processWeeklyResetAndRematch(force: boolean = false): Promise<void> {
    const now = Date.now();
    const kstDay = getKSTDay(now);
    const kstHours = getKSTHours(now);
    const kstMinutes = getKSTMinutes(now);
    const isMondayMidnight = kstDay === 1 && kstHours === 0 && kstMinutes < 5;
    
    // force가 false이고 월요일 0시가 아니면 실행하지 않음
    if (!force && !isMondayMidnight) {
        return;
    }
    
    // Check if we've already processed this Monday (force가 true면 체크 건너뜀)
    if (!force && lastWeeklyResetTimestamp !== null) {
        const lastResetDayStart = getStartOfDayKST(lastWeeklyResetTimestamp);
        const currentDayStart = getStartOfDayKST(now);
        
        // 같은 날이면 이미 처리한 것으로 간주
        if (lastResetDayStart === currentDayStart) {
            console.log(`[WeeklyReset] Already processed this Monday (${new Date(lastWeeklyResetTimestamp).toISOString()})`);
            return;
        }
    }
    
    console.log(`[WeeklyReset] Processing weekly reset and rematch${force ? ' (forced)' : ' at Monday 0:00 KST'}`);
    
    // 티어변동이 반영된 최신 유저 데이터를 가져오기 위해 모든 유저를 다시 조회
    const allUsersRaw = await db.getAllUsers();
    const allUsersWithUpdatedTiers = await Promise.all(
        allUsersRaw.map(u => db.getUser(u.id))
    );
    const allUsers = allUsersWithUpdatedTiers.filter((u): u is types.User => u !== null);
    
    console.log(`[WeeklyReset] Processing ${allUsers.length} users`);
        
    // 1. 새로운 경쟁상대 매칭 (티어변동 후 새로운 리그에 맞는 경쟁상대 매칭)
    // 2. 모든 점수 리셋 (유저 점수 0, 봇 점수 0, yesterdayScore 0)
    
    // 티어변동 후 새로운 경쟁상대 매칭
    // 모든 유저를 처리하되, 관리자나 초기데이터 아이디도 포함하여 처리
    for (const user of allUsers) {
        // 이미 최신 데이터이므로 다시 가져올 필요 없음
        if (!user) continue;
        
        // 월요일 0시에는 강제로 경쟁 상대를 업데이트 (주간 체크 무시)
        // 관리자나 초기데이터 아이디도 포함하여 처리
        let updatedUser = JSON.parse(JSON.stringify(user));
        const nowForUpdate = Date.now();
        
        // 항상 경쟁 상대를 업데이트 (티어 변경이 반영된 상태에서)
        console.log(`[WeeklyReset] Updating weekly competitors for ${user.nickname} (${user.id}) - League: ${user.league}`);
        
        // Find 15 other users in the same league (티어 변경이 반영된 최신 데이터 사용)
        const potentialCompetitors = allUsers.filter(
            u => u.id !== user.id && u.league === user.league
        );
                
        const shuffledCompetitors = potentialCompetitors.sort(() => 0.5 - Math.random());
        const selectedCompetitors = shuffledCompetitors.slice(0, 15);
        
        // Create the list of competitors including the current user
        const competitorList: types.WeeklyCompetitor[] = [user, ...selectedCompetitors].map(u => ({
            id: u.id,
            nickname: u.nickname,
            avatarId: u.avatarId,
            borderId: u.borderId,
            league: u.league,
            initialScore: 0 // All scores reset to 0 at the start of the week
        }));
        
        updatedUser.weeklyCompetitors = competitorList;
        updatedUser.lastWeeklyCompetitorsUpdate = nowForUpdate;
        
        // 모든 유저의 주간 점수를 0으로 리셋 (processWeeklyLeagueUpdates에서 이미 누적 점수에 추가됨)
        // 관리자 계정 포함 모든 유저의 점수를 강제로 0으로 초기화
        const oldScore = updatedUser.tournamentScore || 0;
        updatedUser.tournamentScore = 0;
        if (oldScore !== 0) {
            console.log(`[WeeklyReset] Reset tournamentScore for ${updatedUser.nickname} (${updatedUser.id}): ${oldScore} -> 0`);
        }
        
        // 월요일 0시에 유저의 yesterdayTournamentScore를 현재 누적 점수로 설정 (변화없음으로 시작)
        // 이렇게 하면 누적 점수는 업데이트되어도 변화표에 "변화없음"으로 표시됨
        // (liveScore - yesterdayScore = cumulativeTournamentScore - cumulativeTournamentScore = 0)
        updatedUser.yesterdayTournamentScore = updatedUser.cumulativeTournamentScore || 0;
        
        // dailyRankings.championship도 초기화하여 변화표가 올바르게 표시되도록 함
        if (!updatedUser.dailyRankings) {
            updatedUser.dailyRankings = {};
        }
        // 월요일 0시에는 누적 점수가 업데이트된 상태이지만, 변화표는 변화없음으로 시작하도록 설정
        // processDailyRankings에서 나중에 rank를 업데이트함
        updatedUser.dailyRankings.championship = {
            rank: 0, // processDailyRankings에서 나중에 업데이트됨
            score: updatedUser.cumulativeTournamentScore || 0, // 누적 점수 유지
            lastUpdated: now
        };
        
        // 새로운 경쟁상대에 봇이 포함된 경우를 대비해 초기화
        if (!updatedUser.weeklyCompetitorsBotScores) {
            updatedUser.weeklyCompetitorsBotScores = {};
        }
        
        // 기존 봇 점수 중 새로운 경쟁상대에 포함되지 않은 봇은 삭제
        const existingBotIds = Object.keys(updatedUser.weeklyCompetitorsBotScores);
        for (const botId of existingBotIds) {
            const competitorExists = updatedUser.weeklyCompetitors?.some((c: types.WeeklyCompetitor) => c.id === botId);
            if (!competitorExists) {
                // 새로운 경쟁상대에 포함되지 않은 봇은 삭제
                delete updatedUser.weeklyCompetitorsBotScores[botId];
            }
        }
        
        // 새로운 경쟁상대에 봇이 포함된 경우, 봇 점수를 초기화하고 월요일 0시에 1~50점을 한번 추가
        if (updatedUser.weeklyCompetitors) {
            for (const competitor of updatedUser.weeklyCompetitors) {
                if (competitor.id.startsWith('bot-')) {
                    const botId = competitor.id;
                    // 새로운 경쟁상대에 포함된 봇은 점수를 초기화하고 초기 점수 부여
                    // 1-50 사이의 랜덤값 생성 (봇 ID와 KST 기준 날짜를 시드로 사용)
                    const kstYear = getKSTFullYear(now);
                    const kstMonth = getKSTMonth(now) + 1; // 0-based to 1-based
                    const kstDate = getKSTDate_UTC(now);
                    const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
                    const seedStr = `${botId}-${dateStr}`;
                    let seed = 0;
                    for (let i = 0; i < seedStr.length; i++) {
                        seed = ((seed << 5) - seed) + seedStr.charCodeAt(i);
                        seed = seed & seed; // Convert to 32bit integer
                    }
                    const randomVal = Math.abs(Math.sin(seed)) * 10000;
                    const initialGain = Math.floor((randomVal % 50)) + 1; // 1-50
                    
                    updatedUser.weeklyCompetitorsBotScores[botId] = {
                        score: initialGain, // 월요일 0시에 경쟁 상대 갱신 직후 1~50점 추가
                        lastUpdate: now,
                        yesterdayScore: 0 // 변화없음으로 표시
                    };
                    
                    console.log(`[WeeklyReset] Initialized bot score for ${botId} (${competitor.nickname || 'Unknown'}): ${initialGain}점`);
                }
            }
        }
        
        await db.updateUser(updatedUser);
    }
    
    // 길드 미션 초기화
        const { resetWeeklyGuildMissions } = await import('./guildService.js');
        const guilds = await db.getKV<Record<string, types.Guild>>('guilds') || {};
        for (const guild of Object.values(guilds)) {
            // 마지막 초기화가 이번 주가 아니면 초기화
            const lastMissionReset = (guild as any).lastMissionReset;
            if (!lastMissionReset || isDifferentWeekKST(lastMissionReset, now)) {
                resetWeeklyGuildMissions(guild, now);
            }
        }
        if (Object.keys(guilds).length > 0) {
            await db.setKV('guilds', guilds);
            const { broadcast } = await import('./socket.js');
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            console.log(`[WeeklyReset] Reset all guild missions`);
        }
        
    lastWeeklyResetTimestamp = now;
    console.log(`[WeeklyReset] Completed: Reset all tournament scores, bot scores, and rematched competitors for ${allUsers.length} users`);
}

// 기존 함수는 호환성을 위해 유지 (월요일 0시 처리는 processWeeklyResetAndRematch로 대체)
export async function processWeeklyTournamentReset(): Promise<void> {
    // 월요일 0시 처리는 processWeeklyResetAndRematch에서 처리되므로 여기서는 아무것도 하지 않음
    // 기존 코드와의 호환성을 위해 함수는 유지
}

// 1회성 챔피언십 점수 초기화 함수
export async function resetAllTournamentScores(): Promise<void> {
    console.log(`[OneTimeReset] Resetting all tournament scores to 0`);
    const allUsers = await db.getAllUsers();
    
    for (const user of allUsers) {
        user.tournamentScore = 0;
        await db.updateUser(user);
    }
    
    console.log(`[OneTimeReset] Reset ${allUsers.length} users' tournament scores to 0`);
}

// 1회성: 모든 유저의 리그 점수를 0으로 초기화하여 변화없음으로 표시되도록 함
export async function resetAllUsersLeagueScoresForNewWeek(): Promise<void> {
    console.log(`[OneTimeReset] Resetting all users' tournament scores to 0 for new week`);
    const allUsers = await db.getAllUsers();
    let updatedCount = 0;
    
    for (const user of allUsers) {
        if (user.tournamentScore !== 0) {
            // 누적 점수에 현재 주간 점수 추가 (리셋 전에)
            const weeklyScore = user.tournamentScore || 0;
            user.cumulativeTournamentScore = (user.cumulativeTournamentScore || 0) + weeklyScore;
            
            // 주간 점수를 0으로 리셋
            user.tournamentScore = 0;
            await db.updateUser(user);
            updatedCount++;
        }
    }
    
    console.log(`[OneTimeReset] Reset ${updatedCount} users' tournament scores to 0 (total users: ${allUsers.length})`);
}

export async function resetAllChampionshipScoresToZero(): Promise<void> {
    console.log(`[OneTimeReset] Resetting all championship cumulative scores to 0`);
    const allUsers = await db.getAllUsers();
    const now = Date.now();
    let updatedCount = 0;

    for (const user of allUsers) {
        let hasChanges = false;

        if ((user.cumulativeTournamentScore ?? 0) !== 0) {
            user.cumulativeTournamentScore = 0;
            hasChanges = true;
        }

        if (!user.dailyRankings) {
            user.dailyRankings = {};
            hasChanges = true;
        }

        const currentChampionship = user.dailyRankings.championship;
        if (!currentChampionship || currentChampionship.score !== 0 || currentChampionship.rank !== 0) {
            user.dailyRankings.championship = {
                rank: 0,
                score: 0,
                lastUpdated: now
            };
            hasChanges = true;
        }

        if (hasChanges) {
            await db.updateUser(user);
            updatedCount++;
        }
    }

    console.log(`[OneTimeReset] Reset championship scores to 0 for ${updatedCount} users (total users: ${allUsers.length})`);
}

export async function processWeeklyLeagueUpdates(user: types.User): Promise<types.User> {
    if (!isDifferentWeekKST(user.lastLeagueUpdate ?? undefined, Date.now())) {
        return user; // Not a new week, no update needed
    }

    // 로그 제거 (과도한 로깅 방지)

    if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
        // 로그 제거 (과도한 로깅 방지)
        user.lastLeagueUpdate = Date.now();
        return user;
    }
    
    const now = Date.now();
    const allUsers = await db.getAllUsers();
    const competitorMap = new Map(allUsers.map(u => [u.id, u]));

    // 봇 점수가 없거나 0인 경우 즉시 계산
    if (!user.weeklyCompetitorsBotScores || Object.keys(user.weeklyCompetitorsBotScores).length === 0) {
        const updatedUserWithBotScores = await updateBotLeagueScores(user, true);
        if (updatedUserWithBotScores.weeklyCompetitorsBotScores) {
            user.weeklyCompetitorsBotScores = updatedUserWithBotScores.weeklyCompetitorsBotScores;
        }
    } else {
        // 일부 봇 점수가 없는 경우 보완
        let needsUpdate = false;
        for (const competitor of user.weeklyCompetitors) {
            if (competitor.id.startsWith('bot-') && (!user.weeklyCompetitorsBotScores[competitor.id] || user.weeklyCompetitorsBotScores[competitor.id].score === 0)) {
                needsUpdate = true;
                break;
            }
        }
        if (needsUpdate) {
            const updatedUserWithBotScores = await updateBotLeagueScores(user, true);
            if (updatedUserWithBotScores.weeklyCompetitorsBotScores) {
                user.weeklyCompetitorsBotScores = updatedUserWithBotScores.weeklyCompetitorsBotScores;
            }
        }
    }
    
    // weeklyCompetitors 전체(16명)를 기준으로 랭킹 계산
    // 모든 경쟁 상대(봇 포함)의 점수를 수집
    const finalRankings = user.weeklyCompetitors.map(c => {
        if (c.id.startsWith('bot-')) {
            // 봇의 경우 weeklyCompetitorsBotScores에서 점수 가져오기
            const botScore = user.weeklyCompetitorsBotScores?.[c.id]?.score || 0;
            return {
                id: c.id,
                nickname: c.nickname,
                finalScore: botScore
            };
        } else {
            const liveData = competitorMap.get(c.id);
            return {
                id: c.id,
                nickname: c.nickname,
                finalScore: liveData ? liveData.tournamentScore : c.initialScore
            };
        }
    }).sort((a, b) => b.finalScore - a.finalScore);
    
    // 사용자의 순위 계산 (weeklyCompetitors 내에서의 순위)
    const myRank = finalRankings.findIndex(c => c.id === user.id) + 1;
    
    // 디버깅: 경쟁 상대 수 확인
    if (finalRankings.length !== 16) {
        console.warn(`[LeagueUpdate] User ${user.nickname} (${user.id}): weeklyCompetitors count is ${finalRankings.length}, expected 16`);
    }
    
    if (myRank === 0) {
        console.warn(`[LeagueUpdate] User ${user.nickname} not found in their own competitor list. Aborting update.`);
        user.lastLeagueUpdate = Date.now();
        return user;
    }

    const currentLeague = user.league;
    const rewardTiers = LEAGUE_WEEKLY_REWARDS[currentLeague];
    if (!rewardTiers) {
        console.warn(`[LeagueUpdate] No reward tiers found for league: ${currentLeague}`);
        user.lastLeagueUpdate = Date.now();
        return user;
    }

    const myRewardTier = rewardTiers.find(tier => myRank >= tier.rankStart && myRank <= tier.rankEnd);
    if (!myRewardTier) {
        console.warn(`[LeagueUpdate] No reward tier found for rank ${myRank} in league ${currentLeague}`);
        user.lastLeagueUpdate = Date.now();
        return user;
    }

    const currentLeagueIndex = LEAGUE_DATA.findIndex(l => l.tier === currentLeague);
    if (currentLeagueIndex === -1) {
        console.warn(`[LeagueUpdate] User ${user.nickname} has an invalid league: ${user.league}. Resetting to Sprout.`);
        user.league = types.LeagueTier.Sprout;
    }

    let newLeagueIndex = currentLeagueIndex;
    let resultText = "";
    
    // Challenger 리그는 최상위 티어이므로 promote를 maintain으로 처리
    const isChallenger = currentLeague === types.LeagueTier.Challenger;
    const effectiveOutcome = (isChallenger && myRewardTier.outcome === 'promote') ? 'maintain' : myRewardTier.outcome;
    
    if (effectiveOutcome === 'promote') {
        newLeagueIndex = Math.min(LEAGUE_DATA.length - 1, currentLeagueIndex + 1);
        resultText = "승급";
    } else if (effectiveOutcome === 'demote') {
        newLeagueIndex = Math.max(0, currentLeagueIndex - 1);
        resultText = "강등";
    } else {
        resultText = "잔류";
    }
    
    const oldLeague = user.league;
    const newLeague = LEAGUE_DATA[newLeagueIndex].tier;
    
    if (oldLeague !== newLeague) {
        console.log(`[LeagueUpdate] ${user.nickname} (${user.id}): ${oldLeague} -> ${newLeague} (${resultText}, Rank: ${myRank})`);
        user.league = newLeague;
    } else {
        console.log(`[LeagueUpdate] ${user.nickname} (${user.id}): ${oldLeague} 유지 (${resultText}, Rank: ${myRank})`);
    }

    // 주간 점수를 누적 점수에 추가 (티어변동 계산 후)
    const weeklyScore = user.tournamentScore || 0;
    user.cumulativeTournamentScore = (user.cumulativeTournamentScore || 0) + weeklyScore;

    // KST 기준으로 날짜 정보 가져오기
    const kstYear = getKSTFullYear(now);
    const kstMonth = getKSTMonth(now);
    const kstDate = getKSTDate_UTC(now);
    const year = kstYear.toString().slice(-2);
    const month = kstMonth + 1;
    const week = Math.ceil(kstDate / 7);

    const mailTitle = `${year}년 ${month}월 ${week}주차 리그 정산 보상`;
    // weeklyCompetitors 전체 수를 표시 (항상 16명이어야 함)
    const totalCompetitors = user.weeklyCompetitors?.length || finalRankings.length;
    const mailMessage = `
${year}년 ${month}월 ${week}주차 주간 경쟁 결과, 이번주 경쟁 상대 ${totalCompetitors}명 중 ${myRank}위를 기록하셨습니다.
        
- 이전 리그: ${oldLeague}
- 현재 리그: ${newLeague}
        
결과: [${resultText}]

보상이 지급되었습니다. 5일 이내에 수령해주세요.
        
새로운 주간 경쟁이 시작됩니다. 행운을 빕니다!
    `.trim().replace(/^\s+/gm, '');

    // user.mail 배열 초기화 확인
    if (!user.mail || !Array.isArray(user.mail)) {
        user.mail = [];
    }
    
    const newMail: types.Mail = {
        id: `mail-league-${randomUUID()}`,
        from: 'System',
        title: mailTitle,
        message: mailMessage,
        attachments: { diamonds: myRewardTier.diamonds },
        receivedAt: now,
        expiresAt: now + 5 * 24 * 60 * 60 * 1000, // 5 days
        isRead: false,
        attachmentsClaimed: false,
    };
    user.mail.unshift(newMail);

    user.lastLeagueUpdate = now;
    
    // 로그 제거 (과도한 로깅 방지)

    return user;
}

export async function updateWeeklyCompetitorsIfNeeded(user: types.User, allUsers?: types.User[]): Promise<types.User> {
    const now = Date.now();
    if (!isDifferentWeekKST(user.lastWeeklyCompetitorsUpdate ?? undefined, now)) {
        return user; // No update needed
    }

    console.log(`[LeagueUpdate] Updating weekly competitors for ${user.nickname}`);

    // Find 15 other users in the same league (DB 쿼리로 최적화)
    let potentialCompetitors: types.User[];
    if (allUsers) {
        // 기존 방식 (호환성 유지)
        potentialCompetitors = allUsers.filter(
            u => u.id !== user.id && u.league === user.league
        );
    } else {
        // 최적화된 방식: 같은 리그의 유저만 DB에서 조회
        const { getUsersByLeague } = await import('./db.js');
        potentialCompetitors = await getUsersByLeague(user.league, user.id);
    }

    const shuffledCompetitors = potentialCompetitors.sort(() => 0.5 - Math.random());
    const selectedCompetitors = shuffledCompetitors.slice(0, 15);

    // Create the list of competitors including the current user
    const competitorList: types.WeeklyCompetitor[] = [user, ...selectedCompetitors].map(u => ({
        id: u.id,
        nickname: u.nickname,
        avatarId: u.avatarId,
        borderId: u.borderId,
        league: u.league,
        initialScore: 0 // All scores reset to 0 at the start of the week
    }));
    
    const updatedUser = JSON.parse(JSON.stringify(user));
    updatedUser.weeklyCompetitors = competitorList;
    updatedUser.lastWeeklyCompetitorsUpdate = now;
    
    // 새로운 주간 경쟁상대가 매칭되면 봇 점수 관리
    // 기존 봇 점수는 유지하되, 새로운 경쟁상대에 포함되지 않은 봇은 삭제
    if (!updatedUser.weeklyCompetitorsBotScores) {
        updatedUser.weeklyCompetitorsBotScores = {};
    }
    
    // 새로운 경쟁상대에 포함되지 않은 봇 점수 삭제
    const existingBotIds = Object.keys(updatedUser.weeklyCompetitorsBotScores);
    for (const botId of existingBotIds) {
        const competitorExists = competitorList.some(c => c.id === botId);
        if (!competitorExists) {
            delete updatedUser.weeklyCompetitorsBotScores[botId];
        }
    }
    
    // 새로운 경쟁상대에 포함된 봇 중 점수가 없는 경우만 초기화 (기존 점수는 유지)
    for (const competitor of competitorList) {
        if (competitor.id.startsWith('bot-')) {
            if (!updatedUser.weeklyCompetitorsBotScores[competitor.id]) {
                // 봇 점수가 없는 경우에만 초기화 (기존 점수는 유지)
                // 월요일 0시가 아닌 경우에는 점수를 추가하지 않음
                const kstDay = getKSTDay(now);
                const kstHours = getKSTHours(now);
                const kstMinutes = getKSTMinutes(now);
                const isMondayMidnight = kstDay === 1 && kstHours === 0 && kstMinutes < 5;
                
                if (isMondayMidnight) {
                    // 월요일 0시에만 초기 점수 부여
                    const kstYear = getKSTFullYear(now);
                    const kstMonth = getKSTMonth(now) + 1;
                    const kstDate = getKSTDate_UTC(now);
                    const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
                    const seedStr = `${competitor.id}-${dateStr}`;
                    let seed = 0;
                    for (let i = 0; i < seedStr.length; i++) {
                        seed = ((seed << 5) - seed) + seedStr.charCodeAt(i);
                        seed = seed & seed;
                    }
                    const randomVal = Math.abs(Math.sin(seed)) * 10000;
                    const initialGain = Math.floor((randomVal % 50)) + 1;
                    
                    updatedUser.weeklyCompetitorsBotScores[competitor.id] = {
                        score: initialGain,
                        lastUpdate: now,
                        yesterdayScore: 0
                    };
                } else {
                    // 월요일 0시가 아닌 경우에는 점수를 0으로 초기화만 함
                    updatedUser.weeklyCompetitorsBotScores[competitor.id] = {
                        score: 0,
                        lastUpdate: now,
                        yesterdayScore: 0
                    };
                }
            }
            // 기존 봇 점수가 있으면 유지 (리셋하지 않음)
        }
    }

    return updatedUser;
}

// 1회성: 모든 유저의 경쟁상대 봇에 3일치 점수 부여 (3~150점)
export async function grantThreeDaysBotScores(): Promise<void> {
    console.log(`[OneTimeGrant] Granting 3 days of bot scores (3-150 points) to all users...`);
    const allUsers = await db.getAllUsers();
    const now = Date.now();
    let updatedCount = 0;
    let totalBotsGranted = 0;
    
    for (const user of allUsers) {
        if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
            continue;
        }
        
        const updatedUser = JSON.parse(JSON.stringify(user));
        if (!updatedUser.weeklyCompetitorsBotScores) {
            updatedUser.weeklyCompetitorsBotScores = {};
        }
        
        let hasChanges = false;
        const todayStart = getStartOfDayKST(now);
        
        // 주간 경쟁상대가 업데이트된 날짜 계산
        const competitorsUpdateDay = user.lastWeeklyCompetitorsUpdate 
            ? getStartOfDayKST(user.lastWeeklyCompetitorsUpdate)
            : todayStart;
        
        // 클라이언트에서 생성되는 봇 ID 형식: bot-${currentKstDayStart}-${i}
        // currentKstDayStart는 현재 날짜의 KST 기준 날짜 시작 타임스탬프
        // 클라이언트와 동일한 방식으로 계산: new Date(now + KST_OFFSET)의 날짜 시작
        const KST_OFFSET = 9 * 60 * 60 * 1000;
        
        // 모든 가능한 봇 ID에 대해 점수 부여 (최대 16명의 경쟁상대이므로 0~15까지)
        const NUM_COMPETITORS = 16;
        const actualUserCount = updatedUser.weeklyCompetitors.filter((c: WeeklyCompetitor) => !c.id.startsWith('bot-')).length;
        const botsNeeded = Math.max(0, NUM_COMPETITORS - actualUserCount);
        
        // 주간 경쟁상대가 업데이트된 주의 모든 날짜에 대해 봇 점수 부여
        // 주간 경쟁상대는 월요일 0시에 업데이트되므로, 월요일부터 일요일까지의 모든 날짜에 대해 처리
        const weekStart = competitorsUpdateDay;
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const targetDay = weekStart + (dayOffset * 24 * 60 * 60 * 1000);
            // 클라이언트와 동일한 방식으로 KST 날짜 시작 타임스탬프 계산
            // 클라이언트: new Date(now + KST_OFFSET)의 날짜 시작
            const targetKstNow = new Date(targetDay + KST_OFFSET);
            const targetDayStartKST = new Date(targetKstNow.getFullYear(), targetKstNow.getMonth(), targetKstNow.getDate()).getTime();
            
            // 각 날짜마다 필요한 만큼의 봇 ID 생성 (최대 16명이므로 0~15)
            for (let i = 0; i < NUM_COMPETITORS; i++) {
                const botId = `bot-${targetDayStartKST}-${i}`;
                const botScoreData = user.weeklyCompetitorsBotScores?.[botId];
                const currentScore = botScoreData?.score || 0;
                
                // 이미 점수가 있으면 스킵 (중복 부여 방지)
                if (currentScore > 0) {
                    continue;
                }
                
                let totalGain = 0;
                
                // 3일치 점수 추가 (경쟁상대 업데이트일 다음날부터 3일)
                for (let scoreDayOffset = 1; scoreDayOffset <= 3; scoreDayOffset++) {
                    const targetDate = new Date(competitorsUpdateDay + (scoreDayOffset * 24 * 60 * 60 * 1000));
                    const kstYear = getKSTFullYear(targetDate.getTime());
                    const kstMonth = getKSTMonth(targetDate.getTime()) + 1; // 0-based to 1-based
                    const kstDate = getKSTDate_UTC(targetDate.getTime());
                    const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
                    const seedStr = `${botId}-${dateStr}`;
                    let seed = 0;
                    for (let j = 0; j < seedStr.length; j++) {
                        seed = ((seed << 5) - seed) + seedStr.charCodeAt(j);
                        seed = seed & seed; // Convert to 32bit integer
                    }
                    const randomVal = Math.abs(Math.sin(seed)) * 10000;
                    const dailyGain = Math.floor((randomVal % 50)) + 1; // 1-50
                    totalGain += dailyGain;
                }
                
                // 어제 점수는 0으로 설정 (변화 없음으로 표시)
                updatedUser.weeklyCompetitorsBotScores[botId] = {
                    score: totalGain, // 3~150점
                    lastUpdate: now,
                    yesterdayScore: 0
                };
                
                hasChanges = true;
                totalBotsGranted++;
                // 로그 제거: 너무 많은 로그 출력 방지
                // console.log(`[OneTimeGrant] Granted ${totalGain} points to bot ${botId} for user ${user.nickname}`);
            }
        }
        
        // weeklyCompetitors에 이미 있는 봇들도 처리 (혹시 모를 경우를 대비)
        for (const competitor of updatedUser.weeklyCompetitors) {
            if (competitor.id.startsWith('bot-')) {
                const botScoreData = user.weeklyCompetitorsBotScores?.[competitor.id];
                const currentScore = botScoreData?.score || 0;
                
                // 이미 점수가 있으면 스킵 (중복 부여 방지)
                if (currentScore > 0) {
                    continue;
                }
                
                let totalGain = 0;
                
                // 3일치 점수 추가 (각 날짜마다 1~50점)
                for (let dayOffset = 1; dayOffset <= 3; dayOffset++) {
                    const targetDate = new Date(competitorsUpdateDay + (dayOffset * 24 * 60 * 60 * 1000));
                    const kstYear = getKSTFullYear(targetDate.getTime());
                    const kstMonth = getKSTMonth(targetDate.getTime()) + 1; // 0-based to 1-based
                    const kstDate = getKSTDate_UTC(targetDate.getTime());
                    const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
                    const seedStr = `${competitor.id}-${dateStr}`;
                    let seed = 0;
                    for (let i = 0; i < seedStr.length; i++) {
                        seed = ((seed << 5) - seed) + seedStr.charCodeAt(i);
                        seed = seed & seed; // Convert to 32bit integer
                    }
                    const randomVal = Math.abs(Math.sin(seed)) * 10000;
                    const dailyGain = Math.floor((randomVal % 50)) + 1; // 1-50
                    totalGain += dailyGain;
                }
                
                // 어제 점수는 0으로 설정 (변화 없음으로 표시)
                updatedUser.weeklyCompetitorsBotScores[competitor.id] = {
                    score: totalGain, // 3~150점
                    lastUpdate: now,
                    yesterdayScore: 0
                };
                
                hasChanges = true;
            }
        }
        
        if (hasChanges) {
            await db.updateUser(updatedUser);
            updatedCount++;
            // 로그 간소화: 각 사용자마다 로그 출력하지 않음
            // console.log(`[OneTimeGrant] Updated user ${user.nickname}: granted scores to ${totalBotsGranted} bots`);
        }
    }
    
    console.log(`[OneTimeGrant] Granted 3 days of bot scores to ${updatedCount} users. Total bots granted: ${totalBotsGranted}`);
}

// 봇의 리그 점수를 하루에 한번 증가시키는 함수
// 봇의 특정 날짜에 대한 점수 계산 (1~50점)
function getBotScoreForDate(botId: string, date: Date): number {
    const kstYear = getKSTFullYear(date.getTime());
    const kstMonth = getKSTMonth(date.getTime()) + 1;
    const kstDate = getKSTDate_UTC(date.getTime());
    const dateStr = `${kstYear}-${String(kstMonth).padStart(2, '0')}-${String(kstDate).padStart(2, '0')}`;
    const seedStr = `${botId}-${dateStr}`;
    
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) {
        seed = ((seed << 5) - seed) + seedStr.charCodeAt(i);
        seed = seed & seed;
    }
    
    const randomVal = Math.abs(Math.sin(seed)) * 10000;
    return Math.floor((randomVal % 50)) + 1; // 1~50점
}

// 봇 점수 업데이트 함수 (매일 1~50점 추가)
export async function updateBotLeagueScores(user: types.User, forceUpdate: boolean = false): Promise<types.User> {
    if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
        return user;
    }
    
    const now = Date.now();
    const todayStart = getStartOfDayKST(now);
    
    if (!user.weeklyCompetitorsBotScores) {
        user.weeklyCompetitorsBotScores = {};
    }
    
    const updatedUser = JSON.parse(JSON.stringify(user));
    if (!updatedUser.weeklyCompetitorsBotScores) {
        updatedUser.weeklyCompetitorsBotScores = {};
    }
    
    let hasChanges = false;
    const competitorsUpdateDay = user.lastWeeklyCompetitorsUpdate 
        ? getStartOfDayKST(user.lastWeeklyCompetitorsUpdate)
        : todayStart;
    
    for (const competitor of updatedUser.weeklyCompetitors) {
        if (!competitor.id.startsWith('bot-')) {
            continue;
        }
        
        const botId = competitor.id;
        const botScoreData = user.weeklyCompetitorsBotScores[botId];
        const lastUpdate = botScoreData?.lastUpdate || 0;
        const lastUpdateDay = getStartOfDayKST(lastUpdate);
        const currentScore = botScoreData?.score || 0;
        
        // 강제 업데이트가 아니고, 오늘 이미 업데이트했으면 스킵
        // 단, 점수가 0이면 강제로 업데이트 (배포 사이트에서 봇 점수가 0으로 남아있는 경우 대비)
        const isTodayAlreadyUpdated = !forceUpdate && lastUpdateDay >= todayStart && currentScore > 0;
        
        if (isTodayAlreadyUpdated) {
            // 오늘 이미 업데이트했으면 스킵
            continue;
        }
        
        // 점수가 0이고 경쟁상대 업데이트일이 오늘 이전이면 강제로 업데이트
        if (currentScore === 0 && competitorsUpdateDay < todayStart) {
            // 봇 점수가 없거나 0이면 경쟁상대 업데이트일부터 오늘까지 모든 날짜 계산
            forceUpdate = true;
        }
        
        // 매일 0시에 실행될 때는 마지막 업데이트 다음 날부터 오늘까지 모든 날짜의 점수를 추가해야 함
        // 누락된 날짜의 점수를 모두 보완
        let startDay: number;
        let daysDiff: number;
        
        if (forceUpdate) {
            // 강제 업데이트: 경쟁상대 업데이트일부터 오늘까지 모든 날짜 계산
            startDay = competitorsUpdateDay;
            daysDiff = Math.floor((todayStart - startDay) / (1000 * 60 * 60 * 24));
        } else if (lastUpdate > 0) {
            // 마지막 업데이트가 있으면, 마지막 업데이트 다음 날부터 오늘까지 모든 날짜 계산
            if (lastUpdateDay < todayStart) {
                // 마지막 업데이트 다음 날부터 오늘까지 모든 날짜 계산 (누락된 날짜 보완)
                startDay = lastUpdateDay + (24 * 60 * 60 * 1000); // 마지막 업데이트 다음 날
                daysDiff = Math.floor((todayStart - startDay) / (1000 * 60 * 60 * 24));
                // daysDiff가 음수이면 오늘 날짜만 추가
                if (daysDiff < 0) {
                    startDay = todayStart;
                    daysDiff = 0;
                }
            } else {
                // 오늘 이미 업데이트했으면 스킵 (위에서 이미 체크했지만 안전장치)
                continue;
            }
        } else {
            // 봇 점수가 없으면 경쟁상대 업데이트일부터 오늘까지 모든 날짜 계산
            startDay = competitorsUpdateDay;
            daysDiff = Math.floor((todayStart - startDay) / (1000 * 60 * 60 * 24));
        }
        
        if (daysDiff < 0) {
            continue; // 미래 날짜는 스킵
        }
        
        // forceUpdate인 경우 현재 점수를 무시하고 처음부터 계산
        // forceUpdate가 아니면 현재 점수에 누락된 날짜의 점수만 추가
        const baseScore = forceUpdate ? 0 : currentScore;
        let totalGain = 0;
        let yesterdayScore = baseScore;
        
        // 시작일부터 오늘까지 각 날짜의 점수 추가
        for (let dayOffset = 0; dayOffset <= daysDiff; dayOffset++) {
            const targetDate = new Date(startDay + (dayOffset * 24 * 60 * 60 * 1000));
            const dailyGain = getBotScoreForDate(botId, targetDate);
            totalGain += dailyGain;
        }
        
        // 어제 점수 계산 (오늘 전날까지의 점수)
        if (daysDiff > 0) {
            // 여러 날짜를 추가하는 경우, 어제 점수는 오늘 전날까지의 점수
            yesterdayScore = baseScore + totalGain - getBotScoreForDate(botId, new Date(todayStart));
        } else if (daysDiff === 0) {
            // 오늘 날짜만 추가하는 경우, 어제 점수는 현재 점수
            yesterdayScore = baseScore;
        }
        
        const newScore = baseScore + totalGain;
        
        updatedUser.weeklyCompetitorsBotScores[botId] = {
            score: newScore,
            lastUpdate: now,
            yesterdayScore: yesterdayScore
        };
        
        hasChanges = true;
        
        console.log(`[BotScore] ${botId} (${competitor.nickname || 'Unknown'}): ${forceUpdate ? 'FORCE' : ''} +${totalGain}점 (${daysDiff + 1}일치, ${baseScore} -> ${newScore})`);
    }
    
    return hasChanges ? updatedUser : user;
}

// 1회성: 모든 유저의 봇 점수를 즉시 복구하는 함수
export async function recoverAllBotScores(forceDays?: number): Promise<void> {
    console.log(`[OneTimeRecover] Recovering all bot scores for all users${forceDays ? ` (forcing ${forceDays} days)` : ''}...`);
    const allUsers = await db.getAllUsers();
    const now = Date.now();
    const todayStart = getStartOfDayKST(now);
    let updatedCount = 0;
    let totalBotsRecovered = 0;
    
    for (const user of allUsers) {
        if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
            continue;
        }
        
        const updatedUser = JSON.parse(JSON.stringify(user));
        if (!updatedUser.weeklyCompetitorsBotScores) {
            updatedUser.weeklyCompetitorsBotScores = {};
        }
        
        let hasChanges = false;
        const competitorsUpdateDay = user.lastWeeklyCompetitorsUpdate 
            ? getStartOfDayKST(user.lastWeeklyCompetitorsUpdate)
            : todayStart;
        
        for (const competitor of updatedUser.weeklyCompetitors) {
            if (!competitor.id.startsWith('bot-')) {
                continue;
            }
            
            const botId = competitor.id;
            const botScoreData = user.weeklyCompetitorsBotScores?.[botId];
            const currentScore = botScoreData?.score || 0;
            
            // forceDays가 지정되면 무조건 복구, 아니면 점수가 0이거나 없으면 복구
            if (forceDays === undefined && currentScore > 0 && botScoreData) {
                continue;
            }
            
            // forceDays가 지정되면 그만큼, 아니면 경쟁상대 업데이트일부터 오늘까지
            const daysDiff = forceDays !== undefined 
                ? forceDays - 1  // forceDays=7이면 dayOffset 0~6 (7일)
                : Math.floor((todayStart - competitorsUpdateDay) / (1000 * 60 * 60 * 24));
            
            if (daysDiff < 0) {
                continue;
            }
            
            let totalGain = 0;
            let yesterdayScore = 0;
            
            // 경쟁상대 업데이트일부터 지정된 일수만큼 점수 추가
            for (let dayOffset = 0; dayOffset <= daysDiff; dayOffset++) {
                const targetDate = new Date(competitorsUpdateDay + (dayOffset * 24 * 60 * 60 * 1000));
                const dailyGain = getBotScoreForDate(botId, targetDate);
                totalGain += dailyGain;
                
                // 어제 점수 계산
                if (dayOffset === daysDiff && daysDiff > 0) {
                    yesterdayScore = totalGain - dailyGain;
                } else if (daysDiff === 0) {
                    yesterdayScore = 0;
                }
            }
            
            updatedUser.weeklyCompetitorsBotScores[botId] = {
                score: totalGain,
                lastUpdate: now,
                yesterdayScore: yesterdayScore
            };
            
            hasChanges = true;
            totalBotsRecovered++;
            console.log(`[OneTimeRecover] Recovered bot ${botId} for user ${user.nickname}: ${totalGain} points (${daysDiff + 1} days${forceDays ? ' forced' : ''})`);
        }
        
        if (hasChanges) {
            await db.updateUser(updatedUser);
            updatedCount++;
        }
    }
    
    console.log(`[OneTimeRecover] Recovered bot scores for ${updatedCount} users. Total bots recovered: ${totalBotsRecovered}`);
}

// 매일 0시에 랭킹 정산 (전략바둑, 놀이바둑, 챔피언십)
export async function processDailyRankings(): Promise<void> {
    const now = Date.now();
    const kstHours = getKSTHours(now);
    const kstMinutes = getKSTMinutes(now);
    const isMidnight = kstHours === 0 && kstMinutes < 5;
    
    // 디버깅: 현재 KST 시간 정보 로그
    if (process.env.NODE_ENV === 'development' && kstHours === 0) {
        console.log(`[DailyRanking] Checking: KST Hours=${kstHours}, Minutes=${kstMinutes}, isMidnight=${isMidnight}`);
    }
    
    if (!isMidnight) {
        return;
    }
    
    // 이미 오늘 처리했는지 확인
    if (lastDailyRankingUpdateTimestamp !== null) {
        const todayStart = getStartOfDayKST(now);
        const lastUpdateStart = getStartOfDayKST(lastDailyRankingUpdateTimestamp);
        
        if (lastUpdateStart === todayStart) {
            return; // Already processed today
        }
    }
    
    console.log(`[DailyRanking] Processing daily ranking calculations at midnight KST`);
    
    const allUsers = await db.getAllUsers();
    
    // 전략바둑 랭킹 계산 (1200에서의 차이 기준, 10판 이상 PVP 필수)
    // cumulativeRankingScore는 이미 1200에서의 차이값으로 저장되어 있음
    const strategicRankings = allUsers
        .filter(user => {
            if (!user || !user.id) return false;
            // 전략바둑 모드들의 총 게임 수 계산 (wins + losses)
            let totalGames = 0;
            for (const mode of SPECIAL_GAME_MODES) {
                const gameStats = user.stats?.[mode.mode];
                if (gameStats) {
                    totalGames += (gameStats.wins || 0) + (gameStats.losses || 0);
                }
            }
            // 10판 이상 PVP를 한 유저만 랭킹에 포함
            return totalGames >= 10 && user.cumulativeRankingScore?.['standard'] !== undefined;
        })
        .map(user => ({
            user,
            score: user.cumulativeRankingScore?.['standard'] || 0 // 이미 1200에서의 차이값
        }))
        .sort((a, b) => b.score - a.score) // 높은 차이값이 위로 (양수가 위로, 음수가 아래로)
        .map((entry, index) => ({
            userId: entry.user.id,
            rank: index + 1,
            score: entry.score
        }));
    
    // 놀이바둑 랭킹 계산 (1200에서의 차이 기준, 10판 이상 PVP 필수)
    // cumulativeRankingScore는 이미 1200에서의 차이값으로 저장되어 있음
    const playfulRankings = allUsers
        .filter(user => {
            if (!user || !user.id) return false;
            // 놀이바둑 모드들의 총 게임 수 계산 (wins + losses)
            let totalGames = 0;
            for (const mode of PLAYFUL_GAME_MODES) {
                const gameStats = user.stats?.[mode.mode];
                if (gameStats) {
                    totalGames += (gameStats.wins || 0) + (gameStats.losses || 0);
                }
            }
            // 10판 이상 PVP를 한 유저만 랭킹에 포함
            return totalGames >= 10 && user.cumulativeRankingScore?.['playful'] !== undefined;
        })
        .map(user => ({
            user,
            score: user.cumulativeRankingScore?.['playful'] || 0 // 이미 1200에서의 차이값
        }))
        .sort((a, b) => b.score - a.score) // 높은 차이값이 위로 (양수가 위로, 음수가 아래로)
        .map((entry, index) => ({
            userId: entry.user.id,
            rank: index + 1,
            score: entry.score
        }));
    
    // 챔피언십 랭킹 계산 (누적 점수 기준) - 모든 사용자 포함 (누적 점수가 0이어도 포함)
    const championshipRankings = allUsers
        .filter(user => user && user.id)
        .map(user => ({
            user,
            score: user.cumulativeTournamentScore || 0
        }))
        .sort((a, b) => b.score - a.score)
        .map((entry, index) => ({
            userId: entry.user.id,
            rank: index + 1,
            score: entry.score
        }));
    
    // 월요일 0시인지 확인 (챔피언십 랭킹 업데이트 시 사용)
    const kstDay = getKSTDay(now);
    const isMondayMidnight = kstDay === 1 && kstHours === 0 && kstMinutes < 5;
    
    // 각 유저의 dailyRankings 업데이트 및 봇 점수 업데이트
    // 매일 0시에 봇 점수를 1~50점씩 추가 (월요일 0시도 포함 - processWeeklyResetAndRematch 이후에 실행됨)
    // 모든 유저의 봇 점수를 업데이트하여 다른 유저가 볼 때도 정확한 점수가 표시되도록 함
    let botsUpdated = 0;
    for (const user of allUsers) {
        let updatedUser = JSON.parse(JSON.stringify(user));
        
        // 봇의 리그 점수 업데이트 (매일 0시에 실행, 월요일 0시도 포함)
        // 월요일 0시에는 processWeeklyResetAndRematch에서 이미 봇 점수를 리셋하고 초기 점수를 추가했으므로,
        // 여기서는 추가로 오늘 날짜의 점수를 더 추가함
        // forceUpdate=false로 호출하여 오늘 이미 업데이트된 경우 스킵
        // 단, 봇 점수가 모두 0이면 강제로 업데이트 (배포 사이트에서 봇 점수가 0으로 남아있는 경우 대비)
        // 모든 유저의 봇 점수를 업데이트하여 다른 유저가 볼 때도 정확한 점수가 표시되도록 함
        if (updatedUser.weeklyCompetitors && updatedUser.weeklyCompetitors.length > 0) {
            // 봇 점수가 모두 0인지 확인
            const hasZeroBotScores = updatedUser.weeklyCompetitors.some(c => 
                c.id.startsWith('bot-') && 
                (!updatedUser.weeklyCompetitorsBotScores?.[c.id] || 
                 updatedUser.weeklyCompetitorsBotScores[c.id].score === 0)
            );
            
            const userBeforeUpdate = JSON.stringify(updatedUser.weeklyCompetitorsBotScores || {});
            // 봇 점수가 모두 0이면 강제 업데이트
            updatedUser = await updateBotLeagueScores(updatedUser, hasZeroBotScores);
            const userAfterUpdate = JSON.stringify(updatedUser.weeklyCompetitorsBotScores || {});
            if (userBeforeUpdate !== userAfterUpdate) {
                botsUpdated++;
                // 봇 점수가 업데이트되었으면 DB에 저장
                await db.updateUser(updatedUser);
            }
        }
        
        if (!updatedUser.dailyRankings) {
            updatedUser.dailyRankings = {};
        }
        
        // 전략바둑 순위 저장
        const strategicRank = strategicRankings.findIndex(r => r.userId === user.id);
        if (strategicRank !== -1) {
            updatedUser.dailyRankings.strategic = {
                rank: strategicRank + 1,
                score: user.cumulativeRankingScore?.['standard'] || 0,
                lastUpdated: now
            };
        }
        
        // 놀이바둑 순위 저장
        const playfulRank = playfulRankings.findIndex(r => r.userId === user.id);
        if (playfulRank !== -1) {
            updatedUser.dailyRankings.playful = {
                rank: playfulRank + 1,
                score: user.cumulativeRankingScore?.['playful'] || 0,
                lastUpdated: now
            };
        }
        
        // 챔피언십 순위 저장 (누적 점수 기준 - 모든 사용자에게 저장)
        const championshipRank = championshipRankings.findIndex(r => r.userId === user.id);
        const currentScore = user.cumulativeTournamentScore || 0;
        
        // 월요일 0시인 경우: yesterdayTournamentScore를 현재 누적 점수로 설정하여 변화없음으로 시작
        // 월요일이 아닌 경우: 어제 점수를 저장 (0시 직전의 점수)
        if (isMondayMidnight) {
            // 월요일 0시에는 processWeeklyResetAndRematch에서 이미 yesterdayTournamentScore를 현재 누적 점수로 설정했지만,
            // 여기서도 확인하여 확실하게 설정 (누적 점수 = yesterdayScore이므로 변화량 = 0)
            updatedUser.yesterdayTournamentScore = currentScore;
            updatedUser.dailyRankings.championship = {
                rank: championshipRank !== -1 ? championshipRank + 1 : allUsers.length,
                score: currentScore, // 누적 점수는 업데이트된 상태이지만, 변화표는 변화없음으로 시작
                lastUpdated: now
            };
        } else {
            // 월요일이 아닌 경우: 어제 점수를 저장 (0시 직전의 점수)
            // dailyRankings.championship.score가 있으면 그것을 어제 점수로 사용, 없으면 현재 점수를 어제 점수로 설정
            const yesterdayScore = updatedUser.dailyRankings.championship?.score ?? currentScore;
            updatedUser.yesterdayTournamentScore = yesterdayScore;
            
            if (championshipRank !== -1) {
                updatedUser.dailyRankings.championship = {
                    rank: championshipRank + 1,
                    score: currentScore, // 현재 점수로 업데이트
                    lastUpdated: now
                };
            } else {
                // 랭킹에 없는 경우에도 0점으로 기록 (누적 점수가 없는 신규 사용자 등)
                updatedUser.dailyRankings.championship = {
                    rank: allUsers.length, // 마지막 순위
                    score: currentScore,
                    lastUpdated: now
                };
            }
        }
        
        await db.updateUser(updatedUser);
    }
    
    lastDailyRankingUpdateTimestamp = now;
    console.log(`[DailyRanking] Updated daily rankings for ${allUsers.length} users, updated bot scores for ${botsUpdated} users`);
}

// 매일 0시 KST에 일일 퀘스트 초기화 및 토너먼트 상태 리셋
export async function processDailyQuestReset(): Promise<void> {
    const now = Date.now();
    const kstHours = getKSTHours(now);
    const kstMinutes = getKSTMinutes(now);
    const isMidnight = kstHours === 0 && kstMinutes < 5;
    
    if (!isMidnight) {
        return;
    }
    
    // 이미 오늘 처리했는지 확인
    if (lastDailyQuestResetTimestamp !== null) {
        const todayStart = getStartOfDayKST(now);
        const lastResetStart = getStartOfDayKST(lastDailyQuestResetTimestamp);
        
        if (lastResetStart === todayStart) {
            return; // Already processed today
        }
    }
    
    console.log(`[DailyQuestReset] Processing daily quest reset and tournament state reset at midnight KST`);

    const allUsers = await db.getAllUsers();
    let resetCount = 0;
    let tournamentResetCount = 0;
    let tournamentSessionStartedCount = 0;

    // 모든 사용자에게 토너먼트 세션 자동 시작
    const tournamentTypes: TournamentType[] = ['neighborhood', 'national', 'world'];
    const updatedUsersMap = new Map<string, types.User>();

    for (const user of allUsers) {
        let updatedUser = await resetAndGenerateQuests(user);
        
        // Check if quests or tournament states were actually reset
        const questsChanged = JSON.stringify(user.quests) !== JSON.stringify(updatedUser.quests);
        const tournamentStatesChanged = 
            user.lastNeighborhoodTournament !== updatedUser.lastNeighborhoodTournament ||
            user.lastNationalTournament !== updatedUser.lastNationalTournament ||
            user.lastWorldTournament !== updatedUser.lastWorldTournament ||
            user.lastNeighborhoodPlayedDate !== updatedUser.lastNeighborhoodPlayedDate ||
            user.lastNationalPlayedDate !== updatedUser.lastNationalPlayedDate ||
            user.lastWorldPlayedDate !== updatedUser.lastWorldPlayedDate;
        
        if (questsChanged || tournamentStatesChanged) {
            await db.updateUser(updatedUser);
            resetCount++;
            if (tournamentStatesChanged) {
                tournamentResetCount++;
            }
        }

        // 각 토너먼트 타입에 대해 세션 시작 시도
        // 매일 0시에 토너먼트 상태가 리셋되었으므로, 모든 사용자에게 새로운 토너먼트 세션을 시작
        for (const tournamentType of tournamentTypes) {
            try {
                // 최신 유저 데이터 가져오기
                const freshUser = await db.getUser(user.id);
                if (!freshUser) continue;

                // forceNew = true: 매일 0시 자동 시작이므로 무조건 새 토너먼트 시작
                const result = await startTournamentSessionForUser(freshUser, tournamentType, true, true);
                if (result.success && result.updatedUser) {
                    updatedUser = result.updatedUser;
                    updatedUsersMap.set(user.id, updatedUser);
                    tournamentSessionStartedCount++;
                } else if (result.error) {
                    console.warn(`[DailyQuestReset] Failed to start tournament session for user ${freshUser.id}, type ${tournamentType}: ${result.error}`);
                }
            } catch (error) {
                console.error(`[DailyQuestReset] Failed to start tournament session for user ${user.id}, type ${tournamentType}:`, error);
            }
        }
    }

    // 모든 사용자 업데이트를 일괄 브로드캐스트
    if (updatedUsersMap.size > 0) {
        const usersToBroadcast: Record<string, types.User> = {};
        for (const [userId, updatedUser] of updatedUsersMap) {
            usersToBroadcast[userId] = updatedUser;
        }
        broadcast({ type: 'USER_UPDATE', payload: usersToBroadcast });
    }

    lastDailyQuestResetTimestamp = now;
    console.log(`[DailyQuestReset] Reset daily quests for ${resetCount} users, tournament states for ${tournamentResetCount} users, started tournament sessions for ${tournamentSessionStartedCount} user-tournament combinations`);
}

// 매일 0시 KST에 도전의 탑 랭킹 보상 지급
export async function processTowerRankingRewards(): Promise<void> {
    const now = Date.now();
    const kstHours = getKSTHours(now);
    const kstMinutes = getKSTMinutes(now);
    const kstMonth = getKSTMonth(now);
    const kstYear = getKSTFullYear(now);
    
    // 매월 1일 0시에만 처리
    const isFirstDayOfMonth = kstHours === 0 && kstMinutes < 5 && getKSTDate_UTC(now) === 1;
    
    if (!isFirstDayOfMonth) {
        return;
    }
    
    // 이미 이번 달에 처리했는지 확인
    if (lastTowerRankingRewardTimestamp !== null) {
        const lastMonth = getKSTMonth(lastTowerRankingRewardTimestamp);
        const lastYear = getKSTFullYear(lastTowerRankingRewardTimestamp);
        
        if (lastYear === kstYear && lastMonth === kstMonth) {
            return; // Already processed this month
        }
    }
    
    console.log(`[TowerRankingReward] Processing tower monthly rewards at first day of month KST`);
    
    const allUsers = await db.getAllUsers();
    
    // 최고 층수 기반 보상 정의
    const getRewardForFloor = (floor: number): { gold: number; diamonds: number; items: { itemId: string; quantity: number }[] } | null => {
        if (floor >= 100) {
            return {
                gold: 10000,
                diamonds: 100,
                items: [{ itemId: '장비상자6', quantity: 2 }]
            };
        } else if (floor >= 90) {
            return {
                gold: 7500,
                diamonds: 75,
                items: [{ itemId: '장비상자6', quantity: 1 }]
            };
        } else if (floor >= 80) {
            return {
                gold: 5000,
                diamonds: 50,
                items: [{ itemId: '장비상자5', quantity: 2 }]
            };
        } else if (floor >= 65) {
            return {
                gold: 2500,
                diamonds: 25,
                items: [{ itemId: '장비상자5', quantity: 1 }]
            };
        } else if (floor >= 50) {
            return {
                gold: 1500,
                diamonds: 20,
                items: [{ itemId: '장비상자4', quantity: 1 }]
            };
        } else if (floor >= 35) {
            return {
                gold: 1000,
                diamonds: 15,
                items: [{ itemId: '장비상자3', quantity: 1 }]
            };
        } else if (floor >= 20) {
            return {
                gold: 500,
                diamonds: 10,
                items: [{ itemId: '장비상자2', quantity: 1 }]
            };
        } else if (floor >= 10) {
            return {
                gold: 300,
                diamonds: 5,
                items: [{ itemId: '장비상자1', quantity: 1 }]
            };
        }
        return null; // 10층 미만은 보상 없음
    };
    
    // 각 사용자에게 최고 층수 기반 보상 지급
    let rewardCount = 0;
    for (const user of allUsers) {
        const monthlyTowerFloor = (user as any).monthlyTowerFloor ?? 0;
        
        if (monthlyTowerFloor < 10) {
            // 10층 미만은 보상 없음, monthlyTowerFloor 리셋만 수행
            (user as any).monthlyTowerFloor = 0;
            await db.updateUser(user);
            continue;
        }
        
        const reward = getRewardForFloor(monthlyTowerFloor);
        if (!reward) {
            // 보상이 없으면 monthlyTowerFloor 리셋만 수행
            (user as any).monthlyTowerFloor = 0;
            await db.updateUser(user);
            continue;
        }
        
        // 메일 생성
        const mailTitle = `도전의 탑 월간 보상 (${monthlyTowerFloor}층 클리어)`;
        const mailMessage = `한 달 동안 ${monthlyTowerFloor}층을 클리어하셨습니다.\n\n보상이 지급되었습니다. 30일 이내에 수령해주세요.`;
        
        const mail: types.Mail = {
            id: `mail-tower-monthly-${randomUUID()}`,
            from: 'System',
            title: mailTitle,
            message: mailMessage,
            attachments: {
                gold: reward.gold,
                diamonds: reward.diamonds,
                items: reward.items
            },
            receivedAt: now,
            expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
            isRead: false,
            attachmentsClaimed: false,
        };
        
        if (!user.mail) user.mail = [];
        user.mail.unshift(mail);
        
        // monthlyTowerFloor 리셋
        (user as any).monthlyTowerFloor = 0;
        
        await db.updateUser(user);
        rewardCount++;
    }
    
    lastTowerRankingRewardTimestamp = now;
    console.log(`[TowerRankingReward] Sent monthly rewards to ${rewardCount} users`);
}