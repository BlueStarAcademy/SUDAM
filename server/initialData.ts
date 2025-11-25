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

export const createInitialBotCompetitors = (newUser: Pick<User, 'league' | 'tournamentScore'>): WeeklyCompetitor[] => {
    const competitors: WeeklyCompetitor[] = [];
    const botNames = [...BOT_NAMES].sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < 15; i++) {
        const score = newUser.tournamentScore + Math.floor((Math.random() - 0.5) * 100);
        competitors.push({
            id: `bot-weekly-${i}-${Date.now()}`,
            nickname: botNames[i % botNames.length],
            avatarId: 'bot_avatar',
            borderId: 'default',
            league: newUser.league,
            initialScore: score,
            currentScore: score,
        });
    }
    return competitors;
};

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
        synthesisLevel: 1,
        synthesisXp: 0,
        equipment: {},
        equipmentPresets: Array(5).fill(null).map((_, i) => ({ name: `프리셋 ${i + 1}`, equipment: {} })),
        actionPoints: { current: 30, max: 30 },
        lastActionPointUpdate: now,
        actionPointPurchasesToday: 0,
        lastActionPointPurchaseDate: 0,
        actionPointQuizzesToday: 0,
        lastActionPointQuizDate: 0,
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
        weeklyCompetitors: [],
        weeklyCompetitorsBotScores: {},
        lastWeeklyCompetitorsUpdate: 0,
        lastLeagueUpdate: 0,
        monthlyGoldBuffExpiresAt: 0,
        mbti: null,
        isMbtiPublic: false,
        singlePlayerProgress: 0,
        bonusStatPoints: 0,
        singlePlayerMissions: {},
        towerProgress: {
            highestFloor: 0,
            lastClearTimestamp: 0
        },
        claimedFirstClearRewards: [],
        currencyLogs: [],
        guildId: undefined,
        guildApplications: [],
        guildLeaveCooldownUntil: 0,
        guildCoins: 0,
        guildBossAttempts: 0,
        lastGuildBossAttemptDate: 0,
        lastLoginAt: now,
        dailyDonations: { gold: 0, diamond: 0, date: 0 },
        dailyMissionContribution: { amount: 0, date: 0 },
        guildShopPurchases: {},
        appSettings: defaultSettings,
        kakaoId,

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
        dailyChampionshipMatchesPlayed: 0,
        lastChampionshipMatchDate: 0,
    };
    
    const botCompetitors = createInitialBotCompetitors(user);
    user.weeklyCompetitors = [
        {
            id: user.id,
            nickname: user.nickname,
            avatarId: user.avatarId,
            borderId: user.borderId,
            league: user.league,
            initialScore: user.tournamentScore,
            currentScore: user.tournamentScore,
        },
        ...botCompetitors
    ];
    user.lastWeeklyCompetitorsUpdate = now;
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
        guilds: {},
        onlineUsers: [],
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
        level: 1,
        xp: 0,
        researchPoints: 0,
        members: [{
            userId: creator.id,
            nickname: creator.nickname,
            role: 'leader',
            joinedAt: now,
            contribution: 0,
            weeklyContribution: 0,
        }],
        applicants: [],
        weeklyMissions: GUILD_MISSIONS_POOL.map(m => ({
            ...m,
            id: `quest-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            progress: 0,
            isCompleted: false,
            claimedBy: [],
        })),
        missionProgress: {
            checkIns: 0,
            strategicWins: 0,
            playfulWins: 0,
            diamondsSpent: 0,
            equipmentEnhancements: 0,
            materialCrafts: 0,
            equipmentSyntheses: 0,
            championshipClaims: 0,
            towerFloor50Conquerors: [],
            towerFloor100Conquerors: [],
            bossAttempts: 0,
            epicGearAcquisitions: 0,
        },
        lastMissionReset: now,
        lastWeeklyContributionReset: now,
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