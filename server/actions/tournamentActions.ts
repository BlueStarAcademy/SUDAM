import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, TournamentType, PlayerForTournament, InventoryItem, InventoryItemType, TournamentState, LeagueTier, CoreStat, EquipmentSlot } from '../../types/index.js';
import { ItemGrade } from '../../types/enums.js';
import * as types from '../../types/index.js';
import { TOURNAMENT_DEFINITIONS, BASE_TOURNAMENT_REWARDS, CONSUMABLE_ITEMS, MATERIAL_ITEMS, TOURNAMENT_SCORE_REWARDS, BOT_NAMES, AVATAR_POOL, BORDER_POOL, DUNGEON_STAGE_BOT_STATS, DUNGEON_TYPE_MULTIPLIER, DUNGEON_RANK_REWARD_MULTIPLIER, DUNGEON_DEFAULT_REWARD_MULTIPLIER, DUNGEON_STAGE_BASE_REWARDS_GOLD, DUNGEON_STAGE_BASE_REWARDS_MATERIAL, DUNGEON_STAGE_BASE_REWARDS_EQUIPMENT, DUNGEON_STAGE_BASE_SCORE, DUNGEON_RANK_SCORE_BONUS, DUNGEON_DEFAULT_SCORE_BONUS } from '../../constants';
import { updateQuestProgress } from '../questService.js';
import { createItemFromTemplate, SHOP_ITEMS } from '../shop.js';
import { isSameDayKST, getStartOfDayKST } from '../../utils/timeUtils.js';
import * as tournamentService from '../tournamentService.js';
import { addItemsToInventory, createItemInstancesFromReward } from '../../utils/inventoryUtils.js';
import { calculateTotalStats } from '../statService.js';
import { handleRewardAction } from './rewardActions.js';
import { generateNewItem } from './inventoryActions.js';
import { broadcast } from '../socket.js';
import { createDefaultQuests } from '../initialData.js';
import { getCachedUser, updateUserCache } from '../gameCache.js';


type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

const ALL_SLOTS: EquipmentSlot[] = ['fan', 'board', 'top', 'bottom', 'bowl', 'stones'];
const GRADE_ORDER: ItemGrade[] = [ItemGrade.Normal, ItemGrade.Uncommon, ItemGrade.Rare, ItemGrade.Epic, ItemGrade.Legendary, ItemGrade.Mythic];

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// 리그별 봇 설정
const LEAGUE_BOT_CONFIG: Record<LeagueTier, {
    minLevel: number;
    maxLevel: number;
    minStat: number;
    maxStat: number;
    equipmentGrade: ItemGrade;
}> = {
    [LeagueTier.Sprout]: {
        minLevel: 5,
        maxLevel: 10,
        minStat: 100,
        maxStat: 120,
        equipmentGrade: ItemGrade.Rare, // 고급장비 (rare/epic)
    },
    [LeagueTier.Rookie]: {
        minLevel: 8,
        maxLevel: 15,
        minStat: 130,
        maxStat: 150,
        equipmentGrade: ItemGrade.Rare,
    },
    [LeagueTier.Rising]: {
        minLevel: 12,
        maxLevel: 20,
        minStat: 170,
        maxStat: 200,
        equipmentGrade: ItemGrade.Epic,
    },
    [LeagueTier.Ace]: {
        minLevel: 18,
        maxLevel: 28,
        minStat: 220,
        maxStat: 250,
        equipmentGrade: ItemGrade.Epic,
    },
    [LeagueTier.Diamond]: {
        minLevel: 25,
        maxLevel: 35,
        minStat: 270,
        maxStat: 300,
        equipmentGrade: ItemGrade.Legendary,
    },
    [LeagueTier.Master]: {
        minLevel: 32,
        maxLevel: 42,
        minStat: 330,
        maxStat: 380,
        equipmentGrade: ItemGrade.Legendary,
    },
    [LeagueTier.Grandmaster]: {
        minLevel: 40,
        maxLevel: 48,
        minStat: 400,
        maxStat: 500,
        equipmentGrade: ItemGrade.Legendary,
    },
    [LeagueTier.Challenger]: {
        minLevel: 45,
        maxLevel: 50,
        minStat: 520,
        maxStat: 600,
        equipmentGrade: ItemGrade.Mythic, // 신화장비
    },
};

// 봇 생성 함수: 리그별 설정에 따라 랜덤 레벨, 장비, 능력치로 봇 User 객체 생성
export const createBotUser = (league: LeagueTier, tournamentType: TournamentType, botId: string, botName: string, botAvatar: { id: string }, botBorder: { id: string }): User => {
    const config = LEAGUE_BOT_CONFIG[league] || LEAGUE_BOT_CONFIG[LeagueTier.Sprout];
    
    // 1. 리그별 레벨 범위에서 랜덤 생성
    const strategyLevel = getRandomInt(config.minLevel, config.maxLevel);
    const playfulLevel = getRandomInt(config.minLevel, config.maxLevel);
    
    // 2. 리그별 장비 등급으로 장비 생성
    const inventory: InventoryItem[] = [];
    const equipment: Record<EquipmentSlot, string> = {} as any;
    
    for (const slot of ALL_SLOTS) {
        // 리그별 지정된 등급으로 아이템 생성
        // 고급장비(rare)의 경우 rare 또는 epic 중 랜덤 선택
        let selectedGrade: ItemGrade = config.equipmentGrade;
        
        if (config.equipmentGrade === ItemGrade.Rare) {
            // rare 리그: rare(70%) 또는 epic(30%)
            selectedGrade = Math.random() < 0.7 ? ItemGrade.Rare : ItemGrade.Epic;
        } else if (config.equipmentGrade === ItemGrade.Epic) {
            // epic 리그: epic(80%) 또는 legendary(20%)
            selectedGrade = Math.random() < 0.8 ? ItemGrade.Epic : ItemGrade.Legendary;
        } else if (config.equipmentGrade === ItemGrade.Legendary) {
            // legendary 리그: legendary(85%) 또는 mythic(15%)
            selectedGrade = Math.random() < 0.85 ? ItemGrade.Legendary : ItemGrade.Mythic;
        }
        // mythic 리그는 항상 mythic
        
        // 아이템 생성 및 장착
        const item = generateNewItem(selectedGrade, slot);
        item.isEquipped = true;
        inventory.push(item);
        equipment[slot] = item.name;
    }
    
    // 3. 리그별 능력치 범위에서 랜덤 생성
    const tournamentMultiplier: Record<TournamentType, number> = {
        neighborhood: 0.8,
        national: 1.0,
        world: 1.2,
    };
    const multiplier = tournamentMultiplier[tournamentType] || 1.0;
    
    const baseStats: Record<CoreStat, number> = {} as any;
    const spentStatPoints: Record<CoreStat, number> = {} as any;
    
    // 각 능력치를 리그별 범위 내에서 랜덤 생성
    for (const stat of Object.values(CoreStat)) {
        // baseStats는 리그별 범위에서 랜덤 생성 후 토너먼트 타입에 따른 보정 적용
        const baseStatValue = getRandomInt(config.minStat, config.maxStat);
        baseStats[stat] = Math.round(baseStatValue * multiplier);
        
        // spentStatPoints는 레벨에 따라 분배 (각 레벨당 2포인트씩)
        const totalPoints = (strategyLevel + playfulLevel) * 2;
        // 각 능력치에 고르게 분배하되 약간의 랜덤 변동 추가
        spentStatPoints[stat] = Math.floor(totalPoints / 6) + getRandomInt(-3, 3);
        spentStatPoints[stat] = Math.max(0, spentStatPoints[stat]);
    }
    
    // 봇 User 객체 생성
    const botUser: User = {
        id: botId,
        username: `bot_${botId}`,
        nickname: botName,
        isAdmin: false,
        strategyLevel,
        strategyXp: 0,
        playfulLevel,
        playfulXp: 0,
        blacksmithLevel: 1,
        blacksmithXp: 0,
        baseStats,
        spentStatPoints,
        inventory,
        inventorySlots: { equipment: 40, consumable: 40, material: 40 },
        equipment,
        actionPoints: { current: 0, max: 0 },
        lastActionPointUpdate: Date.now(),
        actionPointPurchasesToday: 0,
        lastActionPointPurchaseDate: 0,
        dailyShopPurchases: {},
        gold: 0,
        diamonds: 0,
        mannerScore: 100,
        mail: [],
        quests: createDefaultQuests(),
        stats: {}, // 게임 모드별 전적 정보 (봇은 빈 객체)
        avatarId: botAvatar.id,
        borderId: botBorder.id,
        ownedBorders: [botBorder.id],
        tournamentScore: 0,
        league,
    };
    
    return botUser;
};


// 토너먼트 세션을 시작하는 헬퍼 함수 (재사용 가능)
export const startTournamentSessionForUser = async (user: User, tournamentType: TournamentType, skipBroadcast = false, forceNew = false): Promise<{ success: boolean; error?: string; updatedUser?: User }> => {
    const definition = TOURNAMENT_DEFINITIONS[tournamentType];
    if (!definition) return { success: false, error: '유효하지 않은 토너먼트 타입입니다.' };
    
    let stateKey: keyof User;
    let playedDateKey: keyof User;
    switch (tournamentType) {
        case 'neighborhood':
            stateKey = 'lastNeighborhoodTournament';
            playedDateKey = 'lastNeighborhoodPlayedDate';
            break;
        case 'national':
            stateKey = 'lastNationalTournament';
            playedDateKey = 'lastNationalPlayedDate';
            break;
        case 'world':
            stateKey = 'lastWorldTournament';
            playedDateKey = 'lastWorldPlayedDate';
            break;
        default:
            return { success: false, error: 'Invalid tournament type.' };
    }

    const now = Date.now();
    const existingState = (user as any)[stateKey] as TournamentState | null;

    // forceNew가 false이고 이미 토너먼트가 있으면 업데이트만 하고 반환
    // forceNew가 true이면 (매일 0시 자동 시작) 무조건 새 토너먼트 시작
    if (!forceNew && existingState) {
        const userInTournament = existingState.players.find(p => p.id === user.id);
        if (userInTournament) {
            // 능력치는 토너먼트 생성 시점(0시)의 originalStats로 고정되어 있으므로 업데이트하지 않음
            // PVE처럼 클론과 대결하는 구조이므로, 토너먼트 중 능력치 변경은 반영되지 않음
            // 아바타와 테두리만 업데이트 (시각적 정보만 최신 상태로 유지)
            userInTournament.avatarId = user.avatarId;
            userInTournament.borderId = user.borderId;
        }
        (user as any)[stateKey] = existingState;
        // 사용자 캐시 업데이트
        updateUserCache(user);
        // DB 저장은 비동기로 처리하여 응답 지연 최소화
        db.updateUser(user).catch(err => {
            console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
        });
        return { success: true, updatedUser: user };
    }

    // forceNew가 true인 경우, 기존 토너먼트가 완료되지 않았어도 새로 시작
    // (매일 0시에 리셋 후 자동 시작하는 경우)
    
    // 최신 유저 데이터 가져오기 (능력치가 최신 상태인지 확인) - 캐시 사용
    const freshUser = await getCachedUser(user.id);
    if (!freshUser) return { success: false, error: 'User not found in DB.' };
    
    const allUsers = await db.getAllUsers();
    // allUsers에 현재 유저가 최신 상태로 포함되도록 업데이트
    const currentUserIndex = allUsers.findIndex(u => u.id === freshUser.id);
    if (currentUserIndex !== -1) {
        allUsers[currentUserIndex] = freshUser;
    } else {
        allUsers.push(freshUser);
    }
    
    const myLeague = freshUser.league;
    const myId = freshUser.id;

    // 각 경기장 매칭: 같은 리그에 있는 모든 유저(온라인/오프라인 포함) 중에서 완전 랜덤으로 선택
    // 주간 경쟁 상대(weeklyCompetitors)와는 별개이며, 매칭될 수도 있고 안될 수도 있음 (완전 랜덤)
    // 오프라인 사용자도 포함되어 있으며, 매칭 시점(0시)의 능력치로 고정되어 PVE처럼 클론과 대결하는 구조
    const potentialOpponents = allUsers
        .filter(u => u.id !== myId && u.league === myLeague)
        .sort(() => 0.5 - Math.random()); // 완전 랜덤 셔플
    
    const neededOpponents = definition.players - 1;
    const selectedOpponents = potentialOpponents.slice(0, neededOpponents);
    
    // 같은 리그에 인원이 부족한 경우 봇으로 보완

    const botsToCreate = neededOpponents - selectedOpponents.length;
    const botNames = [...BOT_NAMES].sort(() => 0.5 - Math.random());
    const botUsers: User[] = [];

    for (let i = 0; i < botsToCreate; i++) {
        const botName = botNames[i % botNames.length];
        const botAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
        const botBorder = BORDER_POOL[Math.floor(Math.random() * BORDER_POOL.length)];
        const botId = `bot-${botName}-${i}`;
        
        // 랜덤 레벨, 장비, 능력치로 봇 생성
        const botUser = createBotUser(myLeague, tournamentType, botId, botName, botAvatar, botBorder);
        botUsers.push(botUser);
        
        selectedOpponents.push({
            id: botId,
            nickname: botName,
            avatarId: botAvatar.id,
            borderId: botBorder.id,
            league: myLeague,
        } as any);
    }
    
    // 오늘 0시 기준 타임스탬프 (능력치 고정용)
    const todayStartKST = getStartOfDayKST(now);
    
    // 현재 유저를 포함한 모든 참가자 생성
    const allParticipants = [{ id: freshUser.id, nickname: freshUser.nickname, avatarId: freshUser.avatarId, borderId: freshUser.borderId, league: freshUser.league }, ...selectedOpponents];
    
    const participants: PlayerForTournament[] = allParticipants.map(p => {
        let initialStats: Record<CoreStat, number>;
        if (p.id.startsWith('bot-')) {
            // 봇의 경우 생성된 User 객체에서 능력치 가져오기 (고정값)
            const botUser = botUsers.find(b => b.id === p.id);
            if (botUser) {
                // calculateTotalStats로 봇의 최종 능력치 계산
                initialStats = calculateTotalStats(botUser);
            } else {
                // 폴백: 기본 능력치 생성
                const baseStatValue = 100;
                const stats: Partial<Record<CoreStat, number>> = {};
                for (const key of Object.values(CoreStat)) {
                    stats[key] = baseStatValue;
                }
                initialStats = stats as Record<CoreStat, number>;
            }
        } else {
            // 실제 유저의 경우 - allUsers에서 찾아서 매칭 시점(0시)의 능력치로 고정
            // 오프라인/온라인 모두 포함되며, 이 시점의 능력치가 토너먼트 전체에서 사용됨 (PVE 클론 구조)
            const realUser = allUsers.find(u => u.id === p.id);
            if (realUser) {
                // calculateTotalStats는 baseStats + spentStatPoints + 장비 보너스를 모두 계산
                // 이 능력치는 originalStats에 저장되어 토너먼트 전체에서 고정됨
                initialStats = calculateTotalStats(realUser);
            } else {
                // 폴백: 기본 능력치 생성
                const baseStatValue = 100;
                const stats: Partial<Record<CoreStat, number>> = {};
                for (const key of Object.values(CoreStat)) {
                    stats[key] = baseStatValue;
                }
                initialStats = stats as Record<CoreStat, number>;
            }
        }
        
        return {
            id: p.id,
            nickname: p.nickname,
            avatarId: p.avatarId,
            borderId: p.borderId,
            league: p.league,
            stats: JSON.parse(JSON.stringify(initialStats)), // Mutable copy for simulation
            originalStats: initialStats, // Store the original stats (오늘 0시 기준 고정값)
            wins: 0,
            losses: 0,
            condition: 1000, // Initialize with a magic number for "not set"
            statsTimestamp: todayStartKST, // 오늘 0시 기준 타임스탬프 저장
        };
    });
    
    const shuffledParticipants = [participants[0], ...participants.slice(1).sort(() => 0.5 - Math.random())];

    const newState = tournamentService.createTournament(tournamentType, freshUser, shuffledParticipants);
    (freshUser as any)[stateKey] = newState;
    (freshUser as any)[playedDateKey] = now;
    
    // 사용자 캐시 업데이트
    updateUserCache(freshUser);
    // DB 저장은 비동기로 처리하여 응답 지연 최소화
    db.updateUser(freshUser).catch(err => {
        console.error(`[TournamentActions] Failed to save user ${freshUser.id}:`, err);
    });
    
    // WebSocket으로 사용자 업데이트 브로드캐스트 (옵션)
    if (!skipBroadcast) {
        const { broadcastUserUpdate } = await import('../socket.js');
        broadcastUserUpdate(freshUser, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament']);
    }
    
    return { success: true, updatedUser: freshUser };
};

export const handleTournamentAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    const now = Date.now();

    console.log(`[handleTournamentAction] Processing action: ${type}, userId: ${user.id}`);
    
    try {
        switch (type) {
        case 'START_TOURNAMENT_SESSION': {
            const { type } = payload as { type: TournamentType };
            const definition = TOURNAMENT_DEFINITIONS[type];
            if (!definition) return { error: '유효하지 않은 토너먼트 타입입니다.' };
            
            let stateKey: keyof User;
            let playedDateKey: keyof User;
            switch (type) {
                case 'neighborhood':
                    stateKey = 'lastNeighborhoodTournament';
                    playedDateKey = 'lastNeighborhoodPlayedDate';
                    break;
                case 'national':
                    stateKey = 'lastNationalTournament';
                    playedDateKey = 'lastNationalPlayedDate';
                    break;
                case 'world':
                    stateKey = 'lastWorldTournament';
                    playedDateKey = 'lastWorldPlayedDate';
                    break;
                default:
                    return { error: 'Invalid tournament type.' };
            }

            const activeTournament = volatileState.activeTournaments?.[user.id];

            if (activeTournament && activeTournament.type === type) {
                return { clientResponse: { redirectToTournament: type } };
            }

            const existingState = (user as any)[stateKey] as TournamentState | null;

            // Championship은 던전 모드로만 진행됩니다.
            // START_TOURNAMENT_SESSION은 던전 선택 화면으로 리다이렉트하는 용도로만 사용됩니다.
            // 실제 던전 스테이지 시작은 START_DUNGEON_STAGE 액션을 사용해야 합니다.
            
            // 기존 일반 토너먼트 모드 상태가 있으면 제거 (던전 모드로 완전 전환)
            if (existingState && !existingState.currentStageAttempt) {
                console.log(`[START_TOURNAMENT_SESSION] 일반 토너먼트 모드 상태 감지 - 던전 모드로 전환을 위해 제거`);
                (user as any)[stateKey] = null;
                // DB에 저장
                updateUserCache(user);
                db.updateUser(user).catch(err => {
                    console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
                });
            }
            
            // 던전 모드 세션이 이미 진행 중인 경우 또는 새로 시작하는 경우 모두 던전 선택 화면으로 리다이렉트
            console.log(`[START_TOURNAMENT_SESSION] 던전 선택 화면으로 리다이렉트`);
            return { clientResponse: { redirectToTournament: type } };
        }

        case 'START_TOURNAMENT_ROUND': {
            const { type } = payload as { type: TournamentType };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            
            // Get the most up-to-date user data from DB (캐시 무시하고 직접 가져와서 최신 장비 정보 확보)
            // 다음 경기 준비 시 최신 장비 정보가 반영되도록 DB에서 직접 가져옴
            const freshUser = await db.getUser(user.id);
            if (!freshUser) return { error: 'User not found in DB.' };
            
            // 캐시도 최신 정보로 업데이트
            updateUserCache(freshUser);

            const tournamentState = (freshUser as any)[stateKey] as types.TournamentState | null;
            if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            
            // round_complete 상태에서만 startNextRound를 호출하여 다음 경기 준비
            const shouldStartNextRound = tournamentState.status === 'round_complete';
            
            // 다음 경기 준비 전: 유저의 최신 능력치를 계산하여 originalStats 업데이트
            const userPlayer = tournamentState.players.find(p => p.id === freshUser.id);
            if (userPlayer) {
                // 유저의 최신 능력치를 계산하여 originalStats와 stats 업데이트
                const latestStats = calculateTotalStats(freshUser);
                userPlayer.originalStats = JSON.parse(JSON.stringify(latestStats));
                userPlayer.stats = JSON.parse(JSON.stringify(latestStats));
            }
            
            if (shouldStartNextRound) {
                // Now that we have the fresh state, start the next round. This will mutate tournamentState.
                // startNextRound에서 이미 컨디션을 부여하므로 여기서는 다시 부여하지 않음
                tournamentService.startNextRound(tournamentState, freshUser);
            } else if (tournamentState.status === 'bracket_ready') {
                // bracket_ready 상태이지만 startNextRound를 호출하지 않은 경우 (뒤로가기 후 다시 들어온 경우)
                // 컨디션이 부여되지 않은 경우에만 컨디션 부여
                // 유저의 컨디션은 절대 변경하지 않음 (회복제로 변경된 컨디션 유지)
                tournamentState.players.forEach(p => {
                    // 유저의 컨디션은 절대 변경하지 않음
                    if (p.id === freshUser.id) {
                        return; // 유저의 컨디션은 건드리지 않음
                    }
                    
                    // 컨디션이 undefined, null, 1000이거나 유효 범위(40-100)를 벗어나면 새로 부여
                    // 이미 유효한 컨디션이 있으면(40-100 사이) 다시 부여하지 않음
                    const hasValidCondition = p.condition !== undefined && 
                                             p.condition !== null && 
                                             p.condition !== 1000 && 
                                             p.condition >= 40 && 
                                             p.condition <= 100;
                    if (!hasValidCondition) {
                        p.condition = Math.floor(Math.random() * 61) + 40; // 40-100
                    }
                });
            }
            
            // The state object on the user is already mutated, so just save the user.
            // 사용자 캐시 업데이트
    updateUserCache(freshUser);
    // DB 저장은 비동기로 처리하여 응답 지연 최소화
    db.updateUser(freshUser).catch(err => {
        console.error(`[TournamentActions] Failed to save user ${freshUser.id}:`, err);
    });
            
            // Update volatile state as well for immediate consistency
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[user.id] = tournamentState;
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(freshUser, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament']);
            
            return { clientResponse: { redirectToTournament: type, updatedUser: freshUser } };
        }

        case 'SKIP_TOURNAMENT_END': {
            const { type } = payload as { type: TournamentType };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            
            const freshUser = await getCachedUser(user.id);
            if (!freshUser) return { error: 'User not found' };
        
            const tournamentState = (freshUser as any)[stateKey] as TournamentState | null;
            if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            
            if (tournamentState) {
                tournamentService.skipToResults(tournamentState, user.id);
            
                (freshUser as any)[stateKey] = tournamentState;
                // 사용자 캐시 업데이트
    updateUserCache(freshUser);
    // DB 저장은 비동기로 처리하여 응답 지연 최소화
    db.updateUser(freshUser).catch(err => {
        console.error(`[TournamentActions] Failed to save user ${freshUser.id}:`, err);
    });
        
                if (volatileState.activeTournaments?.[user.id]) {
                    delete volatileState.activeTournaments[user.id];
                }
            }
            
            return {};
        }
        
        case 'FORFEIT_TOURNAMENT': {
            const { type } = payload as { type: TournamentType };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            let tournamentState: types.TournamentState | null | undefined = volatileState.activeTournaments?.[user.id];

            if (!tournamentState) {
                tournamentState = (user as any)[stateKey] as types.TournamentState | null;
                 if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            }
            
            if (tournamentState) {
                tournamentService.forfeitTournament(tournamentState, user.id);
            
                (user as any)[stateKey] = tournamentState;
                // 사용자 캐시 업데이트
                updateUserCache(user);
                // DB 저장은 비동기로 처리하여 응답 지연 최소화
                db.updateUser(user).catch(err => {
                    console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
                });

                if (volatileState.activeTournaments) {
                    delete volatileState.activeTournaments[user.id];
                }
            }
            
            return {};
        }

        case 'FORFEIT_CURRENT_MATCH': {
            const { type } = payload as { type: TournamentType };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            let tournamentState: types.TournamentState | null | undefined = volatileState.activeTournaments?.[user.id];

            if (!tournamentState) {
                tournamentState = (user as any)[stateKey] as types.TournamentState | null;
                if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            }
            
            if (tournamentState) {
                tournamentService.forfeitCurrentMatch(tournamentState, user);
            
                (user as any)[stateKey] = tournamentState;
                // 사용자 캐시 업데이트
                updateUserCache(user);
                // DB 저장은 비동기로 처리하여 응답 지연 최소화
                db.updateUser(user).catch(err => {
                    console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
                });

                if (volatileState.activeTournaments) {
                    volatileState.activeTournaments[user.id] = tournamentState;
                }
            }
            
            return { clientResponse: { updatedUser: user } };
        }

        case 'SAVE_TOURNAMENT_PROGRESS': {
            const { type } = payload as { type: TournamentType };
            const tournamentState = volatileState.activeTournaments?.[user.id];
            
            if (tournamentState) {
                let stateKey: keyof User;
                switch (type) {
                    case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                    case 'national': stateKey = 'lastNationalTournament'; break;
                    case 'world': stateKey = 'lastWorldTournament'; break;
                    default: return { error: 'Invalid tournament type.' };
                }

                (user as any)[stateKey] = tournamentState;
                
                // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
                db.updateUser(user).catch(err => {
                    console.error(`[SKIP_TOURNAMENT_END] Failed to save user ${user.id}:`, err);
                });

                if (volatileState.activeTournaments && tournamentState.status !== 'round_in_progress') {
                    delete volatileState.activeTournaments[user.id];
                }
            }
            return {};
        }

        case 'CLEAR_TOURNAMENT_SESSION': {
            const { type } = payload as { type?: TournamentType };
            if (type) {
                let stateKey: keyof User;
                switch (type) {
                    case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                    case 'national': stateKey = 'lastNationalTournament'; break;
                    case 'world': stateKey = 'lastWorldTournament'; break;
                    default: return { error: 'Invalid tournament type.' };
                }
                (user as any)[stateKey] = null;
            } else {
                user.lastNeighborhoodTournament = null;
                user.lastNationalTournament = null;
                user.lastWorldTournament = null;
            }
            
            if (volatileState.activeTournaments?.[user.id]) {
                if (!type || volatileState.activeTournaments[user.id].type === type) {
                    delete volatileState.activeTournaments[user.id];
                }
            }

            // 사용자 캐시 업데이트
            updateUserCache(user);
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(user).catch(err => {
                console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
            });
            return {};
        }

        case 'CLAIM_TOURNAMENT_REWARD': {
            return handleRewardAction(volatileState, action, user);
        }

        case 'USE_CONDITION_POTION': {
            const { tournamentType, potionType } = payload as { tournamentType: TournamentType; potionType: 'small' | 'medium' | 'large' };
            
            // 회복제 타입별 정보
            const potionInfo = {
                small: { name: '컨디션회복제(소)', minRecovery: 1, maxRecovery: 10, price: 100 },
                medium: { name: '컨디션회복제(중)', minRecovery: 10, maxRecovery: 20, price: 150 },
                large: { name: '컨디션회복제(대)', minRecovery: 20, maxRecovery: 30, price: 200 }
            }[potionType];

            if (!potionInfo) {
                return { error: '유효하지 않은 회복제 타입입니다.' };
            }

            let stateKey: keyof User;
            switch (tournamentType) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }

            // Check if user has condition potion in inventory
            const conditionPotion = user.inventory.find(item => item.name === potionInfo.name && item.type === 'consumable');
            if (!conditionPotion) {
                return { error: `${potionInfo.name}이(가) 없습니다.` };
            }

            // Check if user has enough gold
            if (user.gold < potionInfo.price && !user.isAdmin) {
                return { error: `골드가 부족합니다. (필요: ${potionInfo.price} 골드)` };
            }

            // Get tournament state
            const tournamentState = (user as any)[stateKey] as TournamentState | null;
            if (!tournamentState) {
                return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            }

            // Only allow using condition potion before match starts (not during round_in_progress)
            if (tournamentState.status === 'round_in_progress') {
                return { error: '경기가 진행 중에는 컨디션 회복제를 사용할 수 없습니다.' };
            }

            // Check if user has an upcoming match or current match
            // 경기 시작 전(bracket_ready) 상태에서는 항상 다음 경기가 있거나, 경기 완료 후에도 다음 경기가 있을 수 있음
            const hasUpcomingUserMatch = tournamentState.rounds.some(round => 
                round.matches.some(match => match.isUserMatch && !match.isFinished)
            );

            // 경기 시작 전 상태이거나 다음 경기가 있으면 컨디션 회복제 사용 가능
            // round_complete 상태에서도 다음 경기가 있을 수 있으므로 hasUpcomingUserMatch를 확인
            if (tournamentState.status !== 'bracket_ready' && tournamentState.status !== 'round_complete' && !hasUpcomingUserMatch) {
                return { error: '다음 경기가 없습니다.' };
            }

            // Find user player in tournament
            const userPlayer = tournamentState.players.find(p => p.id === user.id);
            if (!userPlayer) {
                return { error: '선수를 찾을 수 없습니다.' };
            }

            // Check if condition is already 100
            if (userPlayer.condition >= 100) {
                return { error: '컨디션이 이미 최대입니다.' };
            }

            // Use condition potion - 인벤토리에서 제거
            // quantity가 1보다 크면 감소, 1이면 배열에서 제거
            if (conditionPotion.quantity && conditionPotion.quantity > 1) {
                conditionPotion.quantity--;
            } else {
                // quantity가 1이거나 undefined인 경우 배열에서 제거
                const itemIndex = user.inventory.findIndex(i => i.id === conditionPotion.id);
                if (itemIndex !== -1) {
                    user.inventory.splice(itemIndex, 1);
                }
            }
            
            // 인벤토리 배열의 참조를 변경하여 React가 변경을 감지하도록 함
            user.inventory = [...user.inventory];

            // Deduct gold
            if (!user.isAdmin) {
                user.gold -= potionInfo.price;
            }

            // Calculate random recovery amount
            const getRandomInt = (min: number, max: number) => {
                return Math.floor(Math.random() * (max - min + 1)) + min;
            };
            const recoveryAmount = getRandomInt(potionInfo.minRecovery, potionInfo.maxRecovery);
            const newCondition = Math.min(100, userPlayer.condition + recoveryAmount);
            userPlayer.condition = newCondition;

            // Save tournament state and user
            try {
                // 사용자 캐시 업데이트
                updateUserCache(user);
                // DB 저장은 비동기로 처리하여 응답 지연 최소화
                db.updateUser(user).catch(err => {
                    console.error(`[TournamentActions] Failed to save user ${user.id}:`, err);
                });
                
                // 저장 후 DB에서 다시 읽어서 검증 (인벤토리 변경사항이 확실히 반영되었는지 확인)
                const savedUser = await getCachedUser(user.id);
                if (!savedUser) {
                    console.error(`[USE_CONDITION_POTION] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[USE_CONDITION_POTION] Error updating user ${user.id}:`, error);
                console.error(`[USE_CONDITION_POTION] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['actionPoints']);

            return { 
                clientResponse: { 
                    updatedUser: user,
                    redirectToTournament: tournamentType
                } 
            };
        }

        case 'START_TOURNAMENT_MATCH': {
            const { type } = payload as { type: TournamentType };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            
            // Get the most up-to-date user data from DB (캐시 무시하고 직접 가져와서 최신 장비 정보 확보)
            // 경기 시작 시 최신 장비 정보가 반영되도록 DB에서 직접 가져옴
            const freshUser = await db.getUser(user.id);
            if (!freshUser) return { error: 'User not found in DB.' };
            
            // 캐시도 최신 정보로 업데이트
            updateUserCache(freshUser);

            const tournamentState = (freshUser as any)[stateKey] as types.TournamentState | null;
            if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            
            // 유저의 다음 경기 찾기 (상태 확인 전에 먼저 찾기)
            let userMatch: types.Match | null = null;
            let roundIndex = -1;
            let matchIndex = -1;

            if (tournamentState.type === 'neighborhood') {
                const currentRound = tournamentState.currentRoundRobinRound || 1;
                // rounds 배열에서 name이 "1회차", "2회차" 등인 라운드 찾기
                const currentRoundObj = tournamentState.rounds.find(r => r.name === `${currentRound}회차`);
                if (!currentRoundObj) {
                    return { error: `현재 회차(${currentRound}회차)의 라운드를 찾을 수 없습니다.` };
                }
                const match = currentRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                if (match) {
                    userMatch = match;
                    // roundIndex는 rounds 배열의 실제 인덱스
                    roundIndex = tournamentState.rounds.findIndex(r => r.id === currentRoundObj.id);
                    matchIndex = currentRoundObj.matches.findIndex(m => m.id === match.id);
                }
            } else {
                // tournament 타입 (national, world)
                for (let i = 0; i < tournamentState.rounds.length; i++) {
                    const round = tournamentState.rounds[i];
                    const match = round.matches.find(m => m.isUserMatch && !m.isFinished);
                    if (match) {
                        userMatch = match;
                        roundIndex = i;
                        matchIndex = round.matches.findIndex(m => m.id === match.id);
                        break;
                    }
                }
            }

            if (!userMatch) {
                return { error: '시작할 유저 경기를 찾을 수 없습니다.' };
            }

            // 경기 시작 전 상태인지 확인 (bracket_ready 또는 round_complete 상태에서 시작 가능)
            // 단, 유저 매치가 있는 경우에만 허용
            if (tournamentState.status !== 'bracket_ready' && tournamentState.status !== 'round_complete') {
                return { error: `경기를 시작할 수 있는 상태가 아닙니다. (현재 상태: ${tournamentState.status})` };
            }
            if (roundIndex === -1 || matchIndex === -1) {
                return { error: `경기 인덱스를 찾을 수 없습니다. (roundIndex: ${roundIndex}, matchIndex: ${matchIndex})` };
            }

            // 경기 시작 전: 유저의 최신 능력치를 계산하여 originalStats 업데이트 및 stats 복구
            const userPlayer = tournamentState.players.find(p => p.id === freshUser.id);
            if (userPlayer) {
                // 유저의 최신 능력치를 계산하여 originalStats와 stats 업데이트
                const latestStats = calculateTotalStats(freshUser);
                userPlayer.originalStats = JSON.parse(JSON.stringify(latestStats));
                userPlayer.stats = JSON.parse(JSON.stringify(latestStats));
            }

            // 경기 상대방의 능력치도 originalStats로 복구
            const match = tournamentState.rounds[roundIndex].matches[matchIndex];
            if (match.players[0] && match.players[1]) {
                const p1 = tournamentState.players.find(p => p.id === match.players[0]!.id);
                const p2 = tournamentState.players.find(p => p.id === match.players[1]!.id);
                
                if (p1 && p1.originalStats) {
                    p1.stats = JSON.parse(JSON.stringify(p1.originalStats));
                }
                if (p2 && p2.originalStats) {
                    p2.stats = JSON.parse(JSON.stringify(p2.originalStats));
                }
            }

            // 경기 시작 전: 플레이어 컨디션 확인 및 로깅
            if (match.players[0] && match.players[1]) {
                const p1 = tournamentState.players.find(p => p.id === match.players[0]!.id);
                const p2 = tournamentState.players.find(p => p.id === match.players[1]!.id);
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[START_TOURNAMENT_MATCH] Player conditions before match start: p1=${p1?.condition}, p2=${p2?.condition}`);
                }
                // 컨디션이 유효하지 않으면(undefined, null, 1000, 또는 범위 밖) 경고
                if (p1 && (p1.condition === undefined || p1.condition === null || p1.condition === 1000 || p1.condition < 40 || p1.condition > 100)) {
                    console.warn(`[START_TOURNAMENT_MATCH] Invalid condition for p1: ${p1.condition}`);
                }
                if (p2 && (p2.condition === undefined || p2.condition === null || p2.condition === 1000 || p2.condition < 40 || p2.condition > 100)) {
                    console.warn(`[START_TOURNAMENT_MATCH] Invalid condition for p2: ${p2.condition}`);
                }
            }
            
            // 경기 시작: 상태를 round_in_progress로 변경
            tournamentState.status = 'round_in_progress';
            tournamentState.currentSimulatingMatch = { roundIndex, matchIndex };
            tournamentState.currentMatchCommentary = [];
            tournamentState.timeElapsed = 0;
            tournamentState.currentMatchScores = { player1: 0, player2: 0 };
            
            // 클라이언트 시뮬레이션을 위한 시드 생성
            tournamentState.simulationSeed = randomUUID();
            
            // 개발 모드에서만 상세 로그 출력
            if (process.env.NODE_ENV === 'development') {
                console.log(`[START_TOURNAMENT_MATCH] Match started: roundIndex=${roundIndex}, matchIndex=${matchIndex}`);
            }
            
            // 첫 틱을 위한 시간 초기화 - 현재 시간으로 설정하여 클라이언트가 업데이트를 받을 때까지 시간이 점프되지 않도록 함
            const now = Date.now();
            tournamentState.lastSimulationTime = now;

            // Save tournament state
            // 사용자 캐시 업데이트
            updateUserCache(freshUser);
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(freshUser).catch(err => {
                console.error(`[TournamentActions] Failed to save user ${freshUser.id}:`, err);
            });
            
            // Update volatile state
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[freshUser.id] = tournamentState;

            // WebSocket으로 사용자 업데이트 브로드캐스트
            const updatedUserCopy = JSON.parse(JSON.stringify(freshUser));
            broadcast({ type: 'USER_UPDATE', payload: { [freshUser.id]: updatedUserCopy } });

            return { clientResponse: { redirectToTournament: type } };
        }

        case 'ADVANCE_TOURNAMENT_SIMULATION': {
            // 개발 모드에서만 로그 출력
            if (process.env.NODE_ENV === 'development') {
                console.log(`[TournamentActions] ADVANCE_TOURNAMENT_SIMULATION received for user ${user.id}`);
            }
            const { type, timestamp } = payload as { type: TournamentType; timestamp: number };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            
            // Get the most up-to-date user data from DB
            const freshUser = await db.getUser(user.id);
            if (!freshUser) return { error: 'User not found in DB.' };
            
            // 캐시도 최신 정보로 업데이트
            updateUserCache(freshUser);

            const tournamentState = (freshUser as any)[stateKey] as types.TournamentState | null;
            if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            
            // 클라이언트에서 시뮬레이션 진행
            const { advanceSimulation } = await import('../tournamentService.js');
            
            // 클라이언트 타임스탬프를 시뮬레이션 함수에 전달
            (tournamentState as any).__clientTimestamp = timestamp;
            
            const prevStatus = tournamentState.status;
            const advanced = advanceSimulation(tournamentState, freshUser);
            if (!advanced) {
                return {}; // 아직 진행할 시간이 안 됨
            }

            // 토너먼트 완료 시점에 점수 자동 합산 (보상 수령 여부와 관계없이)
            // 하루에 한번씩 각 경기장에서 모은 점수를 합산하여 주간 경쟁에 사용
            if ((tournamentState.status === 'complete' || tournamentState.status === 'eliminated') && 
                (prevStatus !== 'complete' && prevStatus !== 'eliminated')) {
                // 토너먼트가 방금 완료된 경우에만 점수 추가 (중복 추가 방지)
                let statusKey: keyof User;
                switch (type) {
                    case 'neighborhood':
                        statusKey = 'neighborhoodRewardClaimed';
                        break;
                    case 'national':
                        statusKey = 'nationalRewardClaimed';
                        break;
                    case 'world':
                        statusKey = 'worldRewardClaimed';
                        break;
                    default:
                        statusKey = 'neighborhoodRewardClaimed';
                }
                
                // 보상을 이미 수령했는지 확인 (중복 추가 방지)
                const alreadyClaimed = (freshUser as any)[statusKey];
                if (!alreadyClaimed) {
                    // 순위 계산 및 점수 추가
                    const { calculateRanks } = await import('../tournamentService.js');
                    const { TOURNAMENT_SCORE_REWARDS } = await import('../../constants.js');
                    
                    try {
                        const rankings = calculateRanks(tournamentState);
                        const userRanking = rankings.find(r => r.id === freshUser.id);
                        
                        if (userRanking) {
                            const userRank = userRanking.rank;
                            const scoreRewardInfo = TOURNAMENT_SCORE_REWARDS[type];
                            let scoreRewardKey: number;
                            
                            if (type === 'neighborhood') {
                                scoreRewardKey = userRank;
                            } else if (type === 'national') {
                                scoreRewardKey = userRank <= 4 ? userRank : 5;
                            } else { // world
                                if (userRank <= 4) scoreRewardKey = userRank;
                                else if (userRank <= 8) scoreRewardKey = 5;
                                else scoreRewardKey = 9;
                            }
                            
                            const scoreReward = scoreRewardInfo[scoreRewardKey];
                            if (scoreReward !== undefined) {
                                const oldCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                                freshUser.cumulativeTournamentScore = oldCumulativeScore + scoreReward;
                                const oldScore = freshUser.tournamentScore || 0;
                                freshUser.tournamentScore = oldScore + scoreReward;
                                console.log(`[ADVANCE_TOURNAMENT_SIMULATION] Auto-added score for ${type}: rank=${userRank}, scoreReward=${scoreReward}, tournamentScore: ${oldScore} -> ${freshUser.tournamentScore}, cumulativeTournamentScore: ${oldCumulativeScore} -> ${freshUser.cumulativeTournamentScore}`);
                            }
                        }
                    } catch (error: any) {
                        console.error(`[ADVANCE_TOURNAMENT_SIMULATION] Error calculating ranks for auto-score:`, error);
                        // 에러가 발생해도 계속 진행 (보상 수령 시점에 점수가 추가될 수 있음)
                    }
                }
            }

            // Keep volatile state reference updated
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[freshUser.id] = tournamentState;

            // 사용자 캐시 업데이트
            updateUserCache(freshUser);
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(freshUser).catch(err => {
                console.error(`[TournamentActions] Failed to save user ${freshUser.id}:`, err);
            });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(freshUser, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament']);

            return { clientResponse: { updatedUser: freshUser } };
        }

        case 'COMPLETE_TOURNAMENT_SIMULATION': {
            const { type, result } = payload as { 
                type: TournamentType; 
                result: { 
                    timeElapsed: number; 
                    player1Score: number; 
                    player2Score: number; 
                    commentary: any[]; 
                    winnerId: string;
                };
            };
            let stateKey: keyof User;
            switch (type) {
                case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                case 'national': stateKey = 'lastNationalTournament'; break;
                case 'world': stateKey = 'lastWorldTournament'; break;
                default: return { error: 'Invalid tournament type.' };
            }
            
            // Get the most up-to-date user data from DB
            const freshUser = await db.getUser(user.id);
            if (!freshUser) return { error: 'User not found in DB.' };
            
            // 캐시도 최신 정보로 업데이트
            updateUserCache(freshUser);

            const tournamentState = (freshUser as any)[stateKey] as types.TournamentState | null;
            if (!tournamentState) return { error: '토너먼트 정보를 찾을 수 없습니다.' };
            
            // currentSimulatingMatch가 없으면 가장 최근에 진행 중이었던 경기를 찾거나, 
            // 클라이언트에서 제공한 result를 기반으로 경기를 찾음
            let roundIndex = -1;
            let matchIndex = -1;
            
            if (tournamentState.currentSimulatingMatch) {
                roundIndex = tournamentState.currentSimulatingMatch.roundIndex;
                matchIndex = tournamentState.currentSimulatingMatch.matchIndex;
            } else {
                // currentSimulatingMatch가 없으면 가장 최근 라운드에서 완료되지 않은 경기 찾기
                // 또는 클라이언트 result의 winnerId를 기반으로 경기 찾기
                if (result.winnerId) {
                    // winnerId를 기반으로 해당 플레이어가 포함된 경기 찾기
                    for (let r = tournamentState.rounds.length - 1; r >= 0; r--) {
                        const round = tournamentState.rounds[r];
                        for (let m = round.matches.length - 1; m >= 0; m--) {
                            const match = round.matches[m];
                            if (match.players.some(p => p && p.id === result.winnerId) && !match.isFinished) {
                                roundIndex = r;
                                matchIndex = m;
                                break;
                            }
                        }
                        if (roundIndex >= 0) break;
                    }
                }
                
                // 여전히 찾지 못했으면 가장 최근 라운드의 가장 최근 경기 사용
                if (roundIndex < 0 && tournamentState.rounds.length > 0) {
                    const lastRound = tournamentState.rounds[tournamentState.rounds.length - 1];
                    if (lastRound.matches.length > 0) {
                        roundIndex = tournamentState.rounds.length - 1;
                        matchIndex = lastRound.matches.length - 1;
                    }
                }
            }
            
            // 인덱스 유효성 검사
            if (roundIndex < 0 || roundIndex >= tournamentState.rounds.length) {
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`[COMPLETE_TOURNAMENT_SIMULATION] Invalid roundIndex ${roundIndex} for user ${user.id}. Tournament: ${JSON.stringify({
                        status: tournamentState.status,
                        currentSimulatingMatch: tournamentState.currentSimulatingMatch,
                        roundsCount: tournamentState.rounds.length
                    })}`);
                }
                // 이미 완료된 경기라면 성공 반환 (중복 요청 처리)
                return { clientResponse: { updatedUser: freshUser } };
            }
            
            const round = tournamentState.rounds[roundIndex];
            if (matchIndex < 0 || matchIndex >= round.matches.length) {
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`[COMPLETE_TOURNAMENT_SIMULATION] Invalid matchIndex ${matchIndex} for user ${user.id}. Round has ${round.matches.length} matches.`);
                }
                // 이미 완료된 경기라면 성공 반환 (중복 요청 처리)
                return { clientResponse: { updatedUser: freshUser } };
            }

            const match = round.matches[matchIndex];
            
            // 이미 완료된 경기인 경우에도 결과를 업데이트할 수 있도록 허용
            // (클라이언트와 서버 간 동기화 문제로 인해 중복 요청이 올 수 있음)
            if (match.isFinished && match.winner && match.score) {
                // 이미 완료된 경기이고 결과도 있으면 성공 반환 (중복 요청 처리)
                return { clientResponse: { updatedUser: freshUser } };
            }

            // 클라이언트 결과 검증 (하이브리드 방식)
            // simulationSeed가 있으면 서버에서도 시뮬레이션을 실행하여 결과를 비교
            // simulationSeed가 없으면 클라이언트 결과를 직접 사용 (시뮬레이션이 이미 완료된 경우)
            const p1 = tournamentState.players.find(p => p.id === match.players[0]!.id);
            const p2 = tournamentState.players.find(p => p.id === match.players[1]!.id);
            
            if (!p1 || !p2) {
                return { error: '플레이어를 찾을 수 없습니다.' };
            }

            // simulationSeed가 있으면 서버 검증 시뮬레이션 실행
            if (tournamentState.simulationSeed) {
                try {
                    const { runServerSimulation } = await import('../tournamentService.js');
                    const serverResult = await runServerSimulation(
                        tournamentState.simulationSeed,
                        p1,
                        p2
                    );

                    // 결과 검증 (점수 차이가 너무 크면 거부)
                    const clientScoreDiff = Math.abs(result.player1Score - result.player2Score);
                    const serverScoreDiff = Math.abs(serverResult.player1Score - serverResult.player2Score);
                    const scoreDiffRatio = Math.abs(clientScoreDiff - serverScoreDiff) / Math.max(clientScoreDiff, serverScoreDiff, 1);
                    
                    // 승자 검증
                    const clientWinner = result.winnerId;
                    const serverWinner = serverResult.winnerId;
                    
                    // 점수 차이가 20% 이상이거나 승자가 다르면 거부
                    if (scoreDiffRatio > 0.2 || clientWinner !== serverWinner) {
                        console.warn(`[COMPLETE_TOURNAMENT_SIMULATION] Result mismatch for user ${user.id}. Client: ${JSON.stringify(result)}, Server: ${JSON.stringify(serverResult)}`);
                        // 검증 실패 시 서버 결과 사용
                        match.winner = tournamentState.players.find(p => p.id === serverWinner) || null;
                        match.isFinished = true;
                        match.commentary = serverResult.commentary;
                        match.timeElapsed = result.timeElapsed;
                        match.score = {
                            player1: serverResult.player1Score,
                            player2: serverResult.player2Score
                        };
                        match.finalScore = {
                            player1: serverResult.player1Score / (serverResult.player1Score + serverResult.player2Score) * 100,
                            player2: serverResult.player2Score / (serverResult.player1Score + serverResult.player2Score) * 100
                        };
                    } else {
                        // 검증 성공 시 클라이언트 결과 사용
                        match.winner = tournamentState.players.find(p => p.id === clientWinner) || null;
                        match.isFinished = true;
                        match.commentary = result.commentary;
                        match.timeElapsed = result.timeElapsed;
                        match.score = {
                            player1: result.player1Score,
                            player2: result.player2Score
                        };
                        match.finalScore = {
                            player1: result.player1Score / (result.player1Score + result.player2Score) * 100,
                            player2: result.player2Score / (result.player1Score + result.player2Score) * 100
                        };
                    }
                } catch (error) {
                    console.error(`[COMPLETE_TOURNAMENT_SIMULATION] Server simulation failed for user ${user.id}:`, error);
                    // 서버 시뮬레이션 실패 시 클라이언트 결과 사용
                    const clientWinner = result.winnerId;
                    match.winner = tournamentState.players.find(p => p.id === clientWinner) || null;
                    match.isFinished = true;
                    match.commentary = result.commentary;
                    match.timeElapsed = result.timeElapsed;
                    match.score = {
                        player1: result.player1Score,
                        player2: result.player2Score
                    };
                    match.finalScore = {
                        player1: result.player1Score / (result.player1Score + result.player2Score) * 100,
                        player2: result.player2Score / (result.player1Score + result.player2Score) * 100
                    };
                }
            } else {
                // simulationSeed가 없으면 클라이언트 결과 직접 사용
                const clientWinner = result.winnerId;
                match.winner = tournamentState.players.find(p => p.id === clientWinner) || null;
                match.isFinished = true;
                match.commentary = result.commentary;
                match.timeElapsed = result.timeElapsed;
                match.score = {
                    player1: result.player1Score,
                    player2: result.player2Score
                };
                match.finalScore = {
                    player1: result.player1Score / (result.player1Score + result.player2Score) * 100,
                    player2: result.player2Score / (result.player1Score + result.player2Score) * 100
                };
            }

            // 시뮬레이션 관련 데이터 초기화
            tournamentState.currentSimulatingMatch = null;
            tournamentState.currentMatchCommentary = [];
            tournamentState.timeElapsed = 0;
            tournamentState.currentMatchScores = { player1: 0, player2: 0 };
            tournamentState.simulationSeed = undefined; // 시드 초기화

            // 매치 완료 처리
            const { processMatchCompletion } = await import('../tournamentService.js');
            const prevStatus = tournamentState.status;
            processMatchCompletion(tournamentState, freshUser, match, roundIndex);

            // 모든 경기가 완료되었는지 확인
            const allMatchesFinished = tournamentState.rounds.every(r => r.matches.every(m => m.isFinished));
            if (allMatchesFinished) {
                // 모든 경기가 완료되었으면 complete 상태로 설정
                tournamentState.status = 'complete';
                // 경기 종료 시 모든 플레이어의 컨디션 초기화 (컨디션 회복제 낭비 방지)
                tournamentState.players.forEach(p => {
                    p.condition = 1000;
                });
                
                // 토너먼트 완료 시점에 점수 자동 합산 (보상 수령 여부와 관계없이)
                // 하루에 한번씩 각 경기장에서 모은 점수를 합산하여 주간 경쟁에 사용
                if ((tournamentState.status === 'complete' || tournamentState.status === 'eliminated') && 
                    (prevStatus !== 'complete' && prevStatus !== 'eliminated')) {
                    // 토너먼트가 방금 완료된 경우에만 점수 추가 (중복 추가 방지)
                    let statusKey: keyof User;
                    switch (type) {
                        case 'neighborhood':
                            statusKey = 'neighborhoodRewardClaimed';
                            break;
                        case 'national':
                            statusKey = 'nationalRewardClaimed';
                            break;
                        case 'world':
                            statusKey = 'worldRewardClaimed';
                            break;
                        default:
                            statusKey = 'neighborhoodRewardClaimed';
                    }
                    
                    // 보상을 이미 수령했는지 확인 (중복 추가 방지)
                    const alreadyClaimed = (freshUser as any)[statusKey];
                    if (!alreadyClaimed) {
                        // 순위 계산 및 점수 추가
                        const { calculateRanks } = await import('../tournamentService.js');
                        const { TOURNAMENT_SCORE_REWARDS } = await import('../../constants.js');
                        
                        try {
                            const rankings = calculateRanks(tournamentState);
                            const userRanking = rankings.find(r => r.id === freshUser.id);
                            
                            if (userRanking) {
                                const userRank = userRanking.rank;
                                const scoreRewardInfo = TOURNAMENT_SCORE_REWARDS[type];
                                let scoreRewardKey: number;
                                
                                if (type === 'neighborhood') {
                                    scoreRewardKey = userRank;
                                } else if (type === 'national') {
                                    scoreRewardKey = userRank <= 4 ? userRank : 5;
                                } else { // world
                                    if (userRank <= 4) scoreRewardKey = userRank;
                                    else if (userRank <= 8) scoreRewardKey = 5;
                                    else scoreRewardKey = 9;
                                }
                                
                                const scoreReward = scoreRewardInfo[scoreRewardKey];
                                if (scoreReward !== undefined) {
                                    const oldCumulativeScore = freshUser.cumulativeTournamentScore || 0;
                                    freshUser.cumulativeTournamentScore = oldCumulativeScore + scoreReward;
                                    const oldScore = freshUser.tournamentScore || 0;
                                    freshUser.tournamentScore = oldScore + scoreReward;
                                    console.log(`[COMPLETE_TOURNAMENT_SIMULATION] Auto-added score for ${type}: rank=${userRank}, scoreReward=${scoreReward}, tournamentScore: ${oldScore} -> ${freshUser.tournamentScore}, cumulativeTournamentScore: ${oldCumulativeScore} -> ${freshUser.cumulativeTournamentScore}`);
                                }
                            }
                        } catch (error: any) {
                            console.error(`[COMPLETE_TOURNAMENT_SIMULATION] Error calculating ranks for auto-score:`, error);
                            // 에러가 발생해도 계속 진행 (보상 수령 시점에 점수가 추가될 수 있음)
                        }
                    }
                }
            } else {
                // 다음 라운드 진행 여부 확인
                const allMatchesInRoundFinished = tournamentState.rounds[roundIndex].matches.every(m => m.isFinished);
                if (allMatchesInRoundFinished) {
                    // processMatchCompletion에서 이미 상태를 변경했을 수 있으므로 확인
                    if (tournamentState.status !== 'complete' && tournamentState.status !== 'eliminated') {
                        tournamentState.status = 'round_complete';
                        // round_complete 상태에서는 다음 라운드 대진표만 준비하고,
                        // startNextRound는 사용자가 "다음경기" 버튼을 눌렀을 때만 호출됨 (START_TOURNAMENT_ROUND 액션)
                        // 다음 라운드 대진표 준비 (prepareNextRound는 전국/월드챔피언십에서만 필요)
                        if (tournamentState.type === 'national' || tournamentState.type === 'world') {
                            const { prepareNextRound } = await import('../tournamentService.js');
                            prepareNextRound(tournamentState, freshUser);
                        }
                        // 동네바둑리그는 이미 모든 회차의 대진표가 생성되어 있으므로 prepareNextRound 불필요
                    }
                } else {
                    // 아직 라운드 내 다른 경기가 남아있으면 bracket_ready 상태 유지
                    if (tournamentState.status !== 'complete' && tournamentState.status !== 'eliminated') {
                        tournamentState.status = 'bracket_ready';
                    }
                }
            }

            // Keep volatile state reference updated
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[freshUser.id] = tournamentState;

            // 사용자 캐시 업데이트
            updateUserCache(freshUser);
            // DB 저장
            await db.updateUser(freshUser);

            // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(freshUser, ['lastNeighborhoodTournament', 'lastNationalTournament', 'lastWorldTournament']);

            return { clientResponse: { updatedUser: freshUser } };
        }

        case 'ENTER_TOURNAMENT_VIEW':
        case 'LEAVE_TOURNAMENT_VIEW':
            // 단순히 뷰 진입/이탈을 추적하는 액션이므로 성공 응답만 반환
            return {};

        case 'START_DUNGEON_STAGE': {
            // Payload 상세 로깅
            console.log('[START_DUNGEON_STAGE] Received payload:', JSON.stringify(payload));
            console.log('[START_DUNGEON_STAGE] Payload type:', typeof payload);
            console.log('[START_DUNGEON_STAGE] Payload keys:', payload ? Object.keys(payload) : 'null');
            
            // Payload 검증
            if (!payload || typeof payload !== 'object') {
                console.error('[START_DUNGEON_STAGE] Invalid payload:', payload);
                return { error: '잘못된 요청 형식입니다.' };
            }
            
            const { dungeonType, stage } = payload as { dungeonType?: TournamentType; stage?: number };
            
            console.log('[START_DUNGEON_STAGE] Extracted values:', { dungeonType, stage, stageType: typeof stage });
            
            // dungeonType 검증
            if (!dungeonType || !['neighborhood', 'national', 'world'].includes(dungeonType)) {
                console.error('[START_DUNGEON_STAGE] Invalid dungeonType:', dungeonType, 'Type:', typeof dungeonType);
                return { error: `유효하지 않은 던전 타입입니다. (받은 값: ${dungeonType})` };
            }
            
            // stage 검증
            if (stage === undefined || stage === null) {
                console.error('[START_DUNGEON_STAGE] Stage is undefined or null:', stage);
                return { error: '단계 정보가 전달되지 않았습니다.' };
            }
            
            if (typeof stage !== 'number') {
                console.error('[START_DUNGEON_STAGE] Stage is not a number:', stage, 'Type:', typeof stage);
                return { error: `단계 정보가 숫자가 아닙니다. (받은 값: ${stage}, 타입: ${typeof stage})` };
            }
            
            if (isNaN(stage)) {
                console.error('[START_DUNGEON_STAGE] Stage is NaN:', stage);
                return { error: '단계 정보가 올바르지 않습니다. (NaN)' };
            }
            
            if (stage < 1 || stage > 10) {
                console.error('[START_DUNGEON_STAGE] Stage out of range:', stage);
                return { error: `유효하지 않은 단계입니다. (1~10단계, 받은 값: ${stage})` };
            }
            
            console.log('[START_DUNGEON_STAGE] Validation passed, proceeding with dungeon stage creation');
            
            // 던전 진행 상태 확인
            const freshUser = await getCachedUser(user.id) || await db.getUser(user.id);
            if (!freshUser) return { error: '사용자를 찾을 수 없습니다.' };
            
            if (!freshUser.dungeonProgress) {
                freshUser.dungeonProgress = {
                    neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                };
            }
            
            const dungeonProgress = freshUser.dungeonProgress[dungeonType] || {
                currentStage: 0,
                unlockedStages: [1], // 1단계는 기본 언락
                stageResults: {},
                dailyStageAttempts: {},
            };
            
            // 이전 단계 클리어 확인
            if (stage > 1 && !dungeonProgress.unlockedStages.includes(stage)) {
                return { error: `이전 단계를 먼저 클리어해야 합니다.` };
            }
            
            // 일일 시도 횟수 확인 (필요시 제한)
            const today = getStartOfDayKST(now);
            const todayAttempts = dungeonProgress.dailyStageAttempts[stage] || 0;
            // 일일 시도 횟수 제한은 나중에 추가 가능
            
            // 전체 토너먼트 생성 (유저 + 봇들)
            const definition = TOURNAMENT_DEFINITIONS[dungeonType];
            const neededBots = definition.players - 1; // 유저를 제외한 봇 수
            
            // 봇들 생성
            const botNames = [...BOT_NAMES].sort(() => 0.5 - Math.random());
            const botPlayers: PlayerForTournament[] = [];
            
            for (let i = 0; i < neededBots; i++) {
                const botName = botNames[i % botNames.length];
                const botAvatar = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
                const botBorder = BORDER_POOL[Math.floor(Math.random() * BORDER_POOL.length)];
                const botId = `dungeon-bot-${dungeonType}-${stage}-${i}-${Date.now()}`;
                
                const { createDungeonStageBot } = await import('../tournamentService.js');
                // stage 파라미터가 제대로 전달되는지 확인 및 로깅
                console.log(`[START_DUNGEON_STAGE] Creating bot for stage ${stage}, dungeonType: ${dungeonType}, botId: ${botId}`);
                const bot = createDungeonStageBot(stage, dungeonType, botId, botName, botAvatar, botBorder);
                console.log(`[START_DUNGEON_STAGE] Bot created with stats:`, Object.values(bot.stats));
                botPlayers.push(bot);
            }
            
            // 유저 PlayerForTournament 생성
            // 던전 모드에서는 league를 사용하지 않음 (단계별 시스템 사용)
            const userStats = calculateTotalStats(freshUser);
            const userPlayer: PlayerForTournament = {
                id: freshUser.id,
                nickname: freshUser.nickname,
                avatarId: freshUser.avatarId,
                borderId: freshUser.borderId,
                league: 'Sprout' as any, // 던전 모드에서는 리그 정보가 필요 없음 (타입 호환성을 위해 기본값 설정)
                stats: JSON.parse(JSON.stringify(userStats)), // Mutable copy
                originalStats: userStats, // Original stats 저장
                condition: 1000, // 컨디션은 createTournament에서 설정됨
                wins: 0,
                losses: 0,
            };
            
            // 모든 플레이어 (유저 + 봇들)
            const allPlayers = [userPlayer, ...botPlayers];
            
            // 토너먼트 생성 (기존 createTournament 함수 사용)
            const { createTournament } = await import('../tournamentService.js');
            const dungeonState = createTournament(dungeonType, freshUser, allPlayers);
            
            // 던전 전용 필드 추가
            dungeonState.title = `${TOURNAMENT_DEFINITIONS[dungeonType].name} ${stage}단계`;
            dungeonState.currentStageAttempt = stage;
            
            // 던전 상태 저장
            let stateKey: keyof User;
            switch (dungeonType) {
                case 'neighborhood':
                    stateKey = 'lastNeighborhoodTournament';
                    break;
                case 'national':
                    stateKey = 'lastNationalTournament';
                    break;
                case 'world':
                    stateKey = 'lastWorldTournament';
                    break;
                default:
                    return { error: 'Invalid dungeon type.' };
            }
            
            (freshUser as any)[stateKey] = dungeonState;
            
            // 일일 시도 횟수 증가
            dungeonProgress.dailyStageAttempts[stage] = todayAttempts + 1;
            freshUser.dungeonProgress[dungeonType] = dungeonProgress;
            
            await db.updateUser(freshUser);
            updateUserCache(freshUser);
            
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[freshUser.id] = dungeonState;
            
            return { clientResponse: { dungeonState, updatedUser: freshUser } };
        }

        case 'COMPLETE_DUNGEON_STAGE': {
            const { dungeonType, stage } = payload as { dungeonType: TournamentType; stage: number };
            
            const freshUser = await getCachedUser(user.id) || await db.getUser(user.id);
            if (!freshUser) return { error: '사용자를 찾을 수 없습니다.' };
            
            let stateKey: keyof User;
            switch (dungeonType) {
                case 'neighborhood':
                    stateKey = 'lastNeighborhoodTournament';
                    break;
                case 'national':
                    stateKey = 'lastNationalTournament';
                    break;
                case 'world':
                    stateKey = 'lastWorldTournament';
                    break;
                default:
                    return { error: 'Invalid dungeon type.' };
            }
            
            const dungeonState = (freshUser as any)[stateKey] as TournamentState | null;
            if (!dungeonState || dungeonState.currentStageAttempt !== stage) {
                return { error: '진행 중인 던전이 없습니다.' };
            }
            
            // 토너먼트가 완료되었는지 확인
            const isTournamentComplete = dungeonState.status === 'complete' || dungeonState.status === 'eliminated';
            if (!isTournamentComplete) {
                return { error: '토너먼트가 아직 완료되지 않았습니다.' };
            }
            
            // 던전 진행 상태 업데이트
            if (!freshUser.dungeonProgress) {
                freshUser.dungeonProgress = {
                    neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                    world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
                };
            }
            
            const dungeonProgress = freshUser.dungeonProgress[dungeonType] || {
                currentStage: 0,
                unlockedStages: [1],
                stageResults: {},
                dailyStageAttempts: {},
            };
            
            // 토너먼트 순위 계산
            const userPlayer = dungeonState.players.find(p => p.id === freshUser.id);
            if (!userPlayer) {
                return { error: '플레이어 정보를 찾을 수 없습니다.' };
            }
            
            // 순위 계산 (wins/losses 기준, 동일하면 승률 기준)
            const rankedPlayers = [...dungeonState.players].sort((a, b) => {
                // 1순위: 승수
                if (b.wins !== a.wins) {
                    return b.wins - a.wins;
                }
                // 2순위: 패수 (적을수록 좋음)
                if (a.losses !== b.losses) {
                    return a.losses - b.losses;
                }
                // 3순위: 승률
                const aWinRate = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
                const bWinRate = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
                return bWinRate - aWinRate;
            });
            
            const userRank = rankedPlayers.findIndex(p => p.id === freshUser.id) + 1;
            const cleared = userRank <= (dungeonType === 'neighborhood' ? 6 : dungeonType === 'national' ? 8 : 16); // 모든 순위가 클리어로 간주
            const clearTime = now;
            
            // 단계 결과 저장
            if (!dungeonProgress.stageResults[stage]) {
                dungeonProgress.stageResults[stage] = {
                    cleared: false,
                    scoreDiff: 0,
                    clearTime: 0,
                };
            }
            
            // 클리어 성공 시 업데이트 및 보상 지급
            let rewards: { gold?: number; materials?: Record<string, number>; equipmentBoxes?: Record<string, number>; changeTickets?: number } = {};
            
            // 기본 보상 지급 (각 경기마다 누적된 보상)
            if (dungeonState.accumulatedGold) {
                freshUser.gold = (freshUser.gold || 0) + dungeonState.accumulatedGold;
            }
            
            // 보상 아이템 수집 (기본 보상 + 순위 보상)
            const itemsToCreate: (InventoryItem | { itemId: string; quantity: number })[] = [];
            
            // 기본 보상 아이템 추가 (각 경기마다 누적된 재료/장비상자)
            if (dungeonState.accumulatedMaterials) {
                for (const [materialName, quantity] of Object.entries(dungeonState.accumulatedMaterials)) {
                    itemsToCreate.push({ itemId: materialName, quantity });
                }
            }
            
            if (dungeonState.accumulatedEquipmentBoxes) {
                for (const [boxName, quantity] of Object.entries(dungeonState.accumulatedEquipmentBoxes)) {
                    const boxItemKey = Object.keys(SHOP_ITEMS).find(key => {
                        const shopItem = SHOP_ITEMS[key as keyof typeof SHOP_ITEMS];
                        return shopItem && (shopItem as any).name === boxName;
                    });
                    if (boxItemKey) {
                        itemsToCreate.push({ itemId: boxItemKey, quantity });
                    } else {
                        itemsToCreate.push({ itemId: boxName, quantity });
                    }
                }
            }
            
            if (cleared) {
                dungeonProgress.stageResults[stage].cleared = true;
                dungeonProgress.stageResults[stage].scoreDiff = 0; // 토너먼트에서는 점수차이 대신 순위 사용
                dungeonProgress.stageResults[stage].clearTime = clearTime;
                
                // 현재 단계 업데이트
                if (stage > dungeonProgress.currentStage) {
                    dungeonProgress.currentStage = stage;
                }
                
                // 다음 단계 언락 조건: 해당 단계에서 3등 이상 달성 시
                if (userRank <= 3 && !dungeonProgress.unlockedStages.includes(stage + 1) && stage < 10) {
                    dungeonProgress.unlockedStages.push(stage + 1);
                    dungeonProgress.unlockedStages.sort((a, b) => a - b);
                }
                
                // 일일 랭킹 점수 계산 (기본 점수만 저장, 순위 보너스는 나중에 적용)
                const baseScore = DUNGEON_STAGE_BASE_SCORE[stage] || 0;
                dungeonProgress.stageResults[stage].dailyScore = baseScore;
                dungeonProgress.stageResults[stage].rank = userRank; // 순위 저장
                
                // 일일 던전 점수 누적
                if (!freshUser.dailyDungeonScore) {
                    freshUser.dailyDungeonScore = 0;
                }
                freshUser.dailyDungeonScore += baseScore;
                
                // 누적 챔피언십 점수에 추가 (홈 화면 랭킹용)
                if (!freshUser.cumulativeTournamentScore) {
                    freshUser.cumulativeTournamentScore = 0;
                }
                freshUser.cumulativeTournamentScore += baseScore;
                
                // 순위별 보상 지급
                const { DUNGEON_RANK_REWARDS } = await import('../../constants/tournaments.js');
                const rankReward = DUNGEON_RANK_REWARDS[dungeonType]?.[stage]?.[userRank];
                if (rankReward && rankReward.items) {
                    for (const item of rankReward.items) {
                        // 타입 가드: InventoryItem이 아닌 경우만 처리
                        if ('itemId' in item && item.itemId && item.quantity) {
                            itemsToCreate.push({ itemId: item.itemId, quantity: item.quantity });
                        }
                    }
                }
            }
            
            // 모든 보상 아이템 지급 (기본 보상 + 순위 보상)
            if (itemsToCreate.length > 0) {
                const itemInstances = createItemInstancesFromReward(itemsToCreate);
                const addResult = addItemsToInventory(
                    freshUser.inventory || [],
                    freshUser.inventorySlots || { equipment: 30, consumable: 30, material: 30 },
                    itemInstances
                );
                if (addResult.success) {
                    freshUser.inventory = addResult.updatedInventory;
                } else {
                    console.warn(`[COMPLETE_DUNGEON_STAGE] Failed to add items to inventory for user ${freshUser.id}: inventory full`);
                }
            }
            
            // 던전 상태 업데이트 (이미 complete/eliminated 상태이므로 유지)
            
            freshUser.dungeonProgress[dungeonType] = dungeonProgress;
            (freshUser as any)[stateKey] = dungeonState;
            
            await db.updateUser(freshUser);
            updateUserCache(freshUser);
            
            if (!volatileState.activeTournaments) volatileState.activeTournaments = {};
            volatileState.activeTournaments[freshUser.id] = dungeonState;
            
            return { 
                clientResponse: { 
                    dungeonState, 
                    cleared,
                    userRank,
                    rankReward: cleared ? (await import('../../constants/tournaments.js')).DUNGEON_RANK_REWARDS[dungeonType]?.[stage]?.[userRank] : undefined,
                    updatedUser: freshUser 
                } 
            };
        }

        default:
            console.error(`[handleTournamentAction] Unhandled action type: ${type}`);
            return { error: `Action ${type} is not handled by tournamentActions.` };
        }
    } catch (error: any) {
        console.error(`[handleTournamentAction] Exception processing ${type}:`, error?.message || error, error?.stack);
        return { error: `서버 오류가 발생했습니다: ${error?.message || 'Unknown error'}` };
    }
};