// 랭킹 데이터 캐싱 시스템
import * as db from './db.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../constants/index.js';

interface RankingEntry {
    id: string;
    nickname: string;
    avatarId: string;
    borderId: string;
    rank: number;
    score: number;
    totalGames: number;
    wins: number;
    losses: number;
    league?: string;
}

interface RankingCache {
    strategic: RankingEntry[];
    playful: RankingEntry[];
    championship: RankingEntry[];
    combat: RankingEntry[];
    manner: RankingEntry[];
    strategicSeason: RankingEntry[]; // 시즌별 티어 랭킹
    playfulSeason: RankingEntry[]; // 시즌별 티어 랭킹
    timestamp: number;
}

let rankingCache: RankingCache | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10분 캐시 (5분 -> 10분으로 증가)

// 랭킹 데이터를 계산하고 캐시에 저장
export async function buildRankingCache(): Promise<RankingCache> {
    const now = Date.now();
    
    // 캐시가 유효하면 반환
    if (rankingCache && (now - rankingCache.timestamp) < CACHE_TTL) {
        return rankingCache;
    }
    
    console.log('[RankingCache] Building ranking cache...');
    const startTime = Date.now();
    
    try {
        // inventory/equipment 없이 사용자 목록 가져오기 (더 빠름)
        const allUsers = await db.getAllUsers({ includeEquipment: false, includeInventory: false });
        
        if (!allUsers || allUsers.length === 0) {
            console.warn('[RankingCache] No users found, returning empty cache');
            return {
                strategic: [],
                playful: [],
                championship: [],
                combat: [],
                manner: [],
                strategicSeason: [],
                playfulSeason: [],
                timestamp: now
            };
        }
        
        // 병렬로 여러 랭킹 계산 (combat은 별도 처리)
        // 각 계산에 개별 에러 핸들링 추가 (하나 실패해도 다른 것들은 성공)
        const [strategicRankings, playfulRankings, championshipRankings, mannerRankings, combatRankings, strategicSeasonRankings, playfulSeasonRankings] = await Promise.all([
            Promise.resolve(calculateRanking(allUsers, SPECIAL_GAME_MODES, 'strategic', 'standard')).catch((err) => {
                console.error('[RankingCache] Error calculating strategic rankings:', err);
                return [];
            }),
            Promise.resolve(calculateRanking(allUsers, PLAYFUL_GAME_MODES, 'playful', 'playful')).catch((err) => {
                console.error('[RankingCache] Error calculating playful rankings:', err);
                return [];
            }),
            Promise.resolve(calculateChampionshipRankings(allUsers)).catch((err) => {
                console.error('[RankingCache] Error calculating championship rankings:', err);
                return [];
            }),
            Promise.resolve(calculateMannerRankings(allUsers)).catch((err) => {
                console.error('[RankingCache] Error calculating manner rankings:', err);
                return [];
            }),
            calculateCombatRankings(allUsers).catch((error) => {
                // combat ranking 실패 시 빈 배열 반환 (서버 크래시 방지)
                console.error('[RankingCache] Error calculating combat rankings:', error);
                return [];
            }),
            Promise.resolve(calculateSeasonRanking(allUsers, SPECIAL_GAME_MODES, 'strategic')).catch((err) => {
                console.error('[RankingCache] Error calculating strategic season rankings:', err);
                return [];
            }),
            Promise.resolve(calculateSeasonRanking(allUsers, PLAYFUL_GAME_MODES, 'playful')).catch((err) => {
                console.error('[RankingCache] Error calculating playful season rankings:', err);
                return [];
            })
        ]);
        
        rankingCache = {
            strategic: strategicRankings || [],
            playful: playfulRankings || [],
            championship: championshipRankings || [],
            combat: combatRankings || [],
            manner: mannerRankings || [],
            strategicSeason: strategicSeasonRankings || [],
            playfulSeason: playfulSeasonRankings || [],
            timestamp: now
        };
        
        const elapsed = Date.now() - startTime;
        console.log(`[RankingCache] Ranking cache built in ${elapsed}ms (${allUsers.length} users)`);
        
        return rankingCache;
    } catch (error) {
        console.error('[RankingCache] Error building ranking cache:', error);
        // 에러 발생 시 기존 캐시 반환 또는 빈 캐시 반환
        if (rankingCache) {
            console.warn('[RankingCache] Returning stale cache due to error');
            return rankingCache;
        }
        // 캐시가 없으면 빈 캐시 반환
        return {
            strategic: [],
            playful: [],
            championship: [],
            combat: [],
            manner: [],
            strategicSeason: [],
            playfulSeason: [],
            timestamp: now
        };
    }
}

// 챔피언십 랭킹 계산 (별도 함수로 분리)
function calculateChampionshipRankings(allUsers: any[]): RankingEntry[] {
    const rankings: RankingEntry[] = [];
    const allGameModes = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES];
    
    for (const user of allUsers) {
        if (!user || !user.id) continue;
        
        const totalGames = calculateTotalGames(user, allGameModes);
        let wins = 0;
        let losses = 0;
        for (const mode of allGameModes) {
            const gameStats = user.stats?.[mode.mode];
            if (gameStats) {
                wins += gameStats.wins || 0;
                losses += gameStats.losses || 0;
            }
        }
        
        rankings.push({
            id: user.id,
            nickname: user.nickname || user.username,
            avatarId: user.avatarId,
            borderId: user.borderId,
            rank: 0, // 정렬 후 설정
            score: user.cumulativeTournamentScore || 0,
            totalGames,
            wins,
            losses,
            league: user.league
        });
    }
    
    // 정렬 후 rank 설정
    rankings.sort((a, b) => b.score - a.score);
    return rankings.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// 매너 랭킹 계산 (별도 함수로 분리)
function calculateMannerRankings(allUsers: any[]): RankingEntry[] {
    const rankings: RankingEntry[] = [];
    const allGameModes = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES];
    
    for (const user of allUsers) {
        if (!user || !user.id || user.mannerScore === undefined) continue;
        
        rankings.push({
            id: user.id,
            nickname: user.nickname || user.username,
            avatarId: user.avatarId,
            borderId: user.borderId,
            rank: 0,
            score: user.mannerScore || 0,
            totalGames: calculateTotalGames(user, allGameModes),
            wins: 0,
            losses: 0,
            league: user.league
        });
    }
    
    // 정렬 후 rank 설정
    rankings.sort((a, b) => b.score - a.score);
    return rankings.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// 전투력 랭킹 계산 (장비 보너스 포함)
async function calculateCombatRankings(allUsers: any[]): Promise<RankingEntry[]> {
    const rankings: RankingEntry[] = [];
    const { calculateTotalStats } = await import('./statService.js');
    const { getAllUsers } = await import('./db.js');
    const allGameModes = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES];
    
    try {
        // 최적화: 상위 500명만 계산 (전체 사용자 계산 시 메모리 부족 가능)
        // Railway 환경에서는 메모리가 제한적이므로 상위 사용자만 처리
        const maxUsersToProcess = 500;
        const usersToProcess = allUsers.slice(0, maxUsersToProcess);
        
        // 배치로 처리하여 메모리 사용량 제한 (한 번에 50명씩)
        const batchSize = 50;
        const { getUser } = await import('./db.js');
        
        // inventory가 필요한 사용자 계산 (배치 처리)
        for (let i = 0; i < usersToProcess.length; i += batchSize) {
            const batch = usersToProcess.slice(i, i + batchSize);
            
            // 배치 단위로 병렬 처리 (50명씩)
            await Promise.all(batch.map(async (user) => {
                if (!user || !user.id) return;
                
                try {
                    // inventory를 포함한 사용자 데이터 가져오기
                    const fullUser = await getUser(user.id, { includeEquipment: true, includeInventory: true });
                    if (!fullUser) return;
                    
                    // calculateTotalStats로 6가지 능력치 합계 계산 (장비 보너스 포함)
                    const totalStats = calculateTotalStats(fullUser);
                    const sum = Object.values(totalStats).reduce((acc: number, value: number) => acc + value, 0);
                    
                    rankings.push({
                        id: fullUser.id,
                        nickname: fullUser.nickname || fullUser.username,
                        avatarId: fullUser.avatarId,
                        borderId: fullUser.borderId,
                        rank: 0,
                        score: sum,
                        totalGames: calculateTotalGames(fullUser, allGameModes),
                        wins: 0,
                        losses: 0,
                        league: fullUser.league
                    });
                } catch (error) {
                    console.error(`[RankingCache] Error calculating combat ranking for user ${user.id}:`, error);
                    // 에러 발생해도 계속 진행
                }
            }));
            
            // 배치 처리 사이에 짧은 대기 (메모리 압력 완화)
            if (i + batchSize < usersToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        
        console.log(`[RankingCache] Processed ${rankings.length} users for combat rankings (limited to ${maxUsersToProcess})`);
    } catch (error) {
        console.error('[RankingCache] Error loading users with inventory for combat rankings:', error);
        // 에러 발생 시 빈 배열 반환 (서버 크래시 방지)
        return [];
    }
    
    // 정렬 후 rank 설정
    rankings.sort((a, b) => b.score - a.score);
    return rankings.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// 특정 타입의 랭킹 계산 (누적 랭킹 점수 사용)
function calculateRanking(
    allUsers: any[],
    gameModes: any[],
    mode: 'strategic' | 'playful',
    scoreKey: 'standard' | 'playful'
): RankingEntry[] {
    const rankings: RankingEntry[] = [];
    
    for (const user of allUsers) {
        if (!user || !user.id) continue;
        
        // cumulativeRankingScore가 있어야 랭킹에 포함
        if (user.cumulativeRankingScore?.[scoreKey] === undefined) continue;
        
        // 한 번만 계산
        const totalGames = calculateTotalGames(user, gameModes);
        // 10판 이상 PVP 필수
        if (totalGames < 10) continue;
        
        let wins = 0;
        let losses = 0;
        for (const gameMode of gameModes) {
            const gameStats = user.stats?.[gameMode.mode];
            if (gameStats) {
                wins += gameStats.wins || 0;
                losses += gameStats.losses || 0;
            }
        }
        
        // cumulativeRankingScore는 이미 1200에서의 차이값 (예: 828점이면 -372점)
        const score = user.cumulativeRankingScore?.[scoreKey] || 0;
        
        rankings.push({
            id: user.id,
            nickname: user.nickname || user.username,
            avatarId: user.avatarId,
            borderId: user.borderId,
            rank: 0, // rank는 나중에 정렬 후 설정됨
            score: score, // 1200에서의 차이값 그대로 사용 (기본점수 제외)
            totalGames,
            wins,
            losses,
            league: user.league
        });
    }
    
    // 정렬 후 rank 설정
    rankings.sort((a, b) => b.score - a.score);
    return rankings.map((entry, index) => ({
        ...entry,
        rank: index + 1 // 정렬 후 rank 설정
    }));
}

// 시즌별 티어 랭킹 점수 계산 (매 시즌 시작일에 1200점 부여, 랭킹전을 통해 얻거나 잃은 점수)
function calculateSeasonRanking(
    allUsers: any[],
    gameModes: any[],
    mode: 'strategic' | 'playful'
): RankingEntry[] {
    const rankings: RankingEntry[] = [];
    
    for (const user of allUsers) {
        if (!user || !user.id) continue;
        
        // 한 번만 계산
        const totalGames = calculateTotalGames(user, gameModes);
        // 10판 이상 PVP 필수
        if (totalGames < 10) continue;
        
        let wins = 0;
        let losses = 0;
        let totalScore = 0;
        let modeCount = 0;
        
        // 해당 모드들의 rankingScore 평균 계산
        for (const gameMode of gameModes) {
            const gameStats = user.stats?.[gameMode.mode];
            if (gameStats) {
                wins += gameStats.wins || 0;
                losses += gameStats.losses || 0;
                // rankingScore는 매 시즌 시작일에 1200점으로 초기화되고 랭킹전을 통해 변동
                if (gameStats.rankingScore !== undefined) {
                    totalScore += gameStats.rankingScore;
                    modeCount++;
                }
            }
        }
        
        // 평균 점수 계산 (모드가 없으면 제외)
        if (modeCount === 0) continue;
        const avgScore = Math.round(totalScore / modeCount);
        
        rankings.push({
            id: user.id,
            nickname: user.nickname || user.username,
            avatarId: user.avatarId,
            borderId: user.borderId,
            rank: 0, // rank는 나중에 정렬 후 설정됨
            score: avgScore, // 시즌별 티어 랭킹 점수 (1200점 기준)
            totalGames,
            wins,
            losses,
            league: user.league
        });
    }
    
    // 정렬 후 rank 설정
    rankings.sort((a, b) => b.score - a.score);
    return rankings.map((entry, index) => ({
        ...entry,
        rank: index + 1 // 정렬 후 rank 설정
    }));
}

// 총 게임 수 계산
function calculateTotalGames(user: any, gameModes: any[]): number {
    let totalGames = 0;
    if (user.stats) {
        for (const gameMode of gameModes) {
            const gameStats = user.stats[gameMode.mode];
            if (gameStats) {
                totalGames += (gameStats.wins || 0) + (gameStats.losses || 0);
            }
        }
    }
    return totalGames;
}

// 캐시 무효화 (랭킹이 업데이트될 때 호출)
export function invalidateRankingCache(): void {
    rankingCache = null;
    console.log('[RankingCache] Cache invalidated');
}

// 특정 사용자의 랭킹 정보만 가져오기 (내 랭킹 확인용)
export async function getUserRankings(userId: string): Promise<{
    strategic?: { rank: number; score: number; totalPlayers: number };
    playful?: { rank: number; score: number; totalPlayers: number };
    championship?: { rank: number; score: number; totalPlayers: number };
    combat?: { rank: number; score: number; totalPlayers: number };
    manner?: { rank: number; score: number; totalPlayers: number };
}> {
    const cache = await buildRankingCache();
    
    const findRank = (rankings: RankingEntry[], userId: string) => {
        const entry = rankings.find(r => r.id === userId);
        return entry ? {
            rank: entry.rank,
            score: entry.score,
            totalPlayers: rankings.length
        } : undefined;
    };
    
    return {
        strategic: findRank(cache.strategic, userId),
        playful: findRank(cache.playful, userId),
        championship: findRank(cache.championship, userId),
        combat: findRank(cache.combat, userId),
        manner: findRank(cache.manner, userId)
    };
}

