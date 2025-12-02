import { type AppState, type User, type UserCredentials, type QuestLog, type DailyQuestData, type WeeklyCompetitor, type WeeklyQuestData, type MonthlyQuestData, type Guild, CoreStat, GameMode, LeagueTier, GuildMemberRole, GuildResearchId, type InventoryItem } from '../types/index.js';
// FIX: Corrected import paths to resolve circular dependency.
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, BOT_NAMES, AVATAR_POOL, GUILD_MISSIONS_POOL, GUILD_INITIAL_MEMBER_LIMIT, defaultSettings } from '../constants/index.js';
import * as crypto from 'crypto';
// FIX: Import createDefaultBaseStats from shared utils.
import { createDefaultBaseStats } from '../utils/statUtils.js';

// Re-export for convenience
export { createDefaultBaseStats };

export const createDefaultQuests = (): QuestLog => ({
    daily: {
        quests: [],
        activityProgress: 0,
        claimedMilestones: [false, false, false, false, false],
        lastReset: 0,
    },
    weekly: {
        quests: [],
        activityProgress: 0,
        claimedMilestones: [false, false, false, false, false],
        lastReset: 0,
    },
    monthly: {
        quests: [],
        activityProgress: 0,
        claimedMilestones: [false, false, false, false, false],
        lastReset: 0,
    },
});

export const createDefaultSpentStatPoints = (): Record<CoreStat, number> => ({
    [CoreStat.Concentration]: 0,
    [CoreStat.ThinkingSpeed]: 0,
    [CoreStat.Judgment]: 0,
    [CoreStat.Calculation]: 0,
    [CoreStat.CombatPower]: 0,
    [CoreStat.Stability]: 0,
});

export const createDefaultInventory = (): InventoryItem[] => [];

const allGameModes = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES].map(m => m.mode);
export const defaultStats: User['stats'] = allGameModes.reduce((acc, mode) => {
    acc[mode] = { wins: 0, losses: 0, rankingScore: 0 };
    return acc;
}, {} as Record<GameMode, { wins: number; losses: number; rankingScore: number }>);

// createInitialBotCompetitors 제거됨 - 던전 시스템으로 변경
// export const createInitialBotCompetitors = (newUser: Pick<User, 'league' | 'tournamentScore'>): WeeklyCompetitor[] => {
//     ...
// };

export const createDefaultUser = (id: string, username: string, nickname: string, isAdmin = false, kakaoId?: string): User => {
    const now = Date.now();
    const user: User = {
        id,
        username,
        nickname,
        isAdmin,
        strategyLevel: 1,
        strategyXp: 0,
        playfulLevel: 1,
        playfulXp: 0,
        baseStats: createDefaultBaseStats(),
        spentStatPoints: createDefaultSpentStatPoints(),
        inventory: createDefaultInventory(),
        inventorySlots: {
            equipment: 30,
            consumable: 30,
            material: 30,
        },
        equipment: {},
        equipmentPresets: Array(5).fill(null).map((_, i) => ({ name: `프리셋 ${i + 1}`, equipment: {} })),
        actionPoints: { current: 30, max: 30 },
        lastActionPointUpdate: now,
        actionPointPurchasesToday: 0,
        lastActionPointPurchaseDate: 0,
        dailyShopPurchases: {},
        gold: 500,
        diamonds: 10,
        mannerScore: 200,
        mannerMasteryApplied: false,
        pendingPenaltyNotification: null,
        mail: [],
        quests: createDefaultQuests(),
        stats: JSON.parse(JSON.stringify(defaultStats)),
        chatBanUntil: 0,
        connectionBanUntil: 0,
        avatarId: 'profile_1',
        borderId: 'default',
        ownedBorders: ['default', 'simple_black'],
        previousSeasonTier: null,
        seasonHistory: {},
        tournamentScore: 0,
        league: LeagueTier.Sprout,
        // weeklyCompetitors 제거됨 - 던전 시스템으로 변경
        lastLeagueUpdate: 0,
        // 던전 진행 상태 초기화
        dungeonProgress: {
            neighborhood: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
            national: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
            world: { currentStage: 0, unlockedStages: [1], stageResults: {}, dailyStageAttempts: {} },
        },
        monthlyGoldBuffExpiresAt: 0,
        mbti: null,
        isMbtiPublic: false,
        singlePlayerProgress: 0,
        bonusStatPoints: 0,
        singlePlayerMissions: {},
        guildId: undefined,
        guildCoins: 0,
        guildBossAttempts: 0,
        lastLoginAt: now,
        dailyDonations: { gold: 0, diamond: 0, date: 0 },

        // Tournament progress
        lastNeighborhoodPlayedDate: undefined,
        neighborhoodRewardClaimed: false,
        lastNeighborhoodTournament: null,

        lastNationalPlayedDate: undefined,
        nationalRewardClaimed: false,
        lastNationalTournament: null,
        
        lastWorldPlayedDate: undefined,
        worldRewardClaimed: false,
        lastWorldTournament: null,
        
        blacksmithLevel: 1,
        blacksmithXp: 0,
    };
    
    // createInitialBotCompetitors 제거됨 - 던전 시스템으로 변경
    // user.weeklyCompetitors 제거됨
    user.lastLeagueUpdate = now;

    return user;
};


export const getInitialState = (): Omit<AppState, 'liveGames' | 'negotiations' | 'userStatuses' | 'userConnections' | 'userLastChatMessage' | 'waitingRoomChats' | 'gameChats' | 'adminLogs' | 'announcements' | 'globalOverrideAnnouncement' | 'gameModeAvailability' | 'announcementInterval' | 'towerRankings' | 'userLastChatMessage'> => {
    const adminUser = createDefaultUser('user-admin-static-id', '푸른별바둑학원', '관리자', true);
    const testUser1 = createDefaultUser('user-test-1', '푸른별', '푸른별');
    const testUser2 = createDefaultUser('user-test-2', '노란별', '노란별');
    const testUser3 = createDefaultUser('user-test-3', '녹색별', '녹색별');

    const createCredentials = (password: string): { hash: string; salt: string } => {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
        return { hash, salt };
    };

    const adminCreds = createCredentials('1217');
    const test1Creds = createCredentials('1217');
    const test2Creds = createCredentials('1217');
    const test3Creds = createCredentials('1217');


    return {
        users: {
            [adminUser.id]: adminUser,
            [testUser1.id]: testUser1,
            [testUser2.id]: testUser2,
            [testUser3.id]: testUser3,
        },
        userCredentials: {
            '푸른별바둑학원': { ...adminCreds, userId: adminUser.id },
            '푸른별': { ...test1Creds, userId: testUser1.id },
            '노란별': { ...test2Creds, userId: testUser2.id },
            '녹색별': { ...test3Creds, userId: testUser3.id },
        },
        singlePlayerGames: {},
        towerGames: {},
        homeBoardPosts: [],
    };
}

export const createDefaultGuild = (id: string, name: string, description: string, isPublic: boolean, creator: User): Guild => {
    const now = Date.now();
    return {
        id,
        name,
        description,
        isPublic,
        icon: '/images/guild/profile/icon1.png',
        leaderId: creator.id,
        gold: 0,
        level: 1,
        experience: 0,
        xp: 0,
        researchPoints: 0,
        createdAt: now,
        updatedAt: now,
        members: [{
            id: `${id}-member-${creator.id}`,
            guildId: id,
            userId: creator.id,
            nickname: creator.nickname,
            role: 'leader',
            joinDate: now,
            createdAt: now,
            updatedAt: now,
            contributionTotal: 0,
            weeklyContribution: 0,
        }],
        applicants: [],
        weeklyMissions: GUILD_MISSIONS_POOL.map(m => ({
            id: `quest-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            guildId: id,
            missionType: m.progressKey || '',
            status: 'active' as const,
            title: m.title,
            description: m.description,
            target: m.target,
            progress: 0,
            progressKey: m.progressKey,
            personalReward: m.personalReward,
            guildReward: m.guildReward,
            claimedBy: [],
            createdAt: now,
            updatedAt: now,
        })),
        lastMissionReset: now,
        chatHistory: [],
        checkIns: {},
        dailyCheckInRewardsClaimed: [],
        memberLimit: GUILD_INITIAL_MEMBER_LIMIT,
        research: (Object.values(GuildResearchId) as GuildResearchId[]).reduce((acc, researchId) => {
            (acc as any)[researchId] = { level: 1 };
            return acc;
        }, {} as Record<GuildResearchId, { level: number }>),
        researchTask: null,
    };
};