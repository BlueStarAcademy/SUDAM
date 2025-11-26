import { User, LiveGameSession, AppState, UserCredentials, AdminLog, Announcement, OverrideAnnouncement, GameMode, HomeBoardPost } from '../types.ts';
import { deepClone } from './utils/cloneHelper.js';
import { getInitialState } from './initialData.ts';
import {
    listUsers,
    getUserById as prismaGetUserById,
    getUserByNickname as prismaGetUserByNickname,
    getUserByEmail as prismaGetUserByEmail,
    getUsersByLeague as prismaGetUsersByLeague,
    createUser as prismaCreateUser,
    updateUser as prismaUpdateUser,
    deleteUser as prismaDeleteUser
} from './prisma/userService.ts';
import {
    getUserCredentialByUsername,
    getUserCredentialByUserId,
    createUserCredential,
    deleteUserCredentialByUsername,
    getUserCredentialByKakaoId,
    updateUserCredential
} from './prisma/credentialService.ts';
import {
    createEmailVerificationToken as prismaCreateEmailVerificationToken,
    getEmailVerificationTokenByUserId as prismaGetEmailVerificationTokenByUserId,
    getEmailVerificationTokenByToken as prismaGetEmailVerificationTokenByToken,
    deleteEmailVerificationTokens as prismaDeleteEmailVerificationTokens,
    verifyUserEmail as prismaVerifyUserEmail
} from './prisma/emailVerificationService.ts';

// --- Initialization and Seeding ---
let isInitialized = false;

const seedInitialData = async () => {
    const initialState = getInitialState();
    const usersToCreate = Object.values(initialState.users);
    const credentialsToCreate = initialState.userCredentials;

    for (const user of usersToCreate) {
        // 이미 존재하는 사용자인지 확인
        const existingUser = await prismaGetUserById(user.id);
        if (existingUser) {
            console.log(`[DB] User ${user.username} (${user.id}) already exists, skipping creation.`);
            continue;
        }
        
        // username으로도 확인 (다른 ID로 같은 username이 있을 수 있음)
        const existingUserByUsername = await prismaGetUserByNickname(user.username);
        if (existingUserByUsername) {
            console.log(`[DB] User with username ${user.username} already exists, skipping creation.`);
            continue;
        }
        
        try {
            await prismaCreateUser(user);
            console.log(`[DB] Created initial user: ${user.username}`);
        } catch (error: any) {
            // UNIQUE 제약조건 위반 등은 무시 (이미 존재하는 경우)
            if (error.message && error.message.includes('UNIQUE constraint')) {
                console.log(`[DB] User ${user.username} already exists (detected by constraint), skipping creation.`);
            } else {
                console.error(`[DB] Error creating user ${user.username}:`, error);
                throw error;
            }
        }
    }
    
    for (const username of Object.keys(credentialsToCreate)) {
        const cred = credentialsToCreate[username];
        const originalUser = usersToCreate.find(u => u.username === username);
        if (originalUser) {
            // 이미 존재하는 credentials인지 확인
            const existingCreds = await getUserCredentialByUsername(username);
            if (existingCreds) {
                console.log(`[DB] Credentials for ${username} already exist, skipping creation.`);
                continue;
            }
            
            try {
                // initialData에서 cred는 { hash, salt, userId } 형태
                const passwordHash = (cred as any).hash || (cred as any).passwordHash;
                await createUserCredential(originalUser.username, passwordHash, cred.userId);
                console.log(`[DB] Created credentials for: ${username}`);
            } catch (error: any) {
                // UNIQUE 제약조건 위반 등은 무시 (이미 존재하는 경우)
                if (error.message && error.message.includes('UNIQUE constraint')) {
                    console.log(`[DB] Credentials for ${username} already exist (detected by constraint), skipping creation.`);
                } else {
                    console.error(`[DB] Error creating credentials for ${username}:`, error);
                    throw error;
                }
            }
        }
    }
    console.log('[DB] Initial data seeding complete.');
};

export const initializeDatabase = async () => {
    if (isInitialized) return;
    
    // 데이터베이스 연결 확인 및 재시도
    let retries = 3;
    let lastError: any = null;
    
    while (retries > 0) {
        try {
            const existingUsers = await listUsers();
            if (existingUsers.length === 0) {
                await seedInitialData();
            }
            isInitialized = true;
            console.log('[DB] Database initialized successfully');
            return;
        } catch (error: any) {
            lastError = error;
            retries--;
            
            // Prisma 연결 오류인 경우
            if (error.code === 'P1001' || error.message?.includes("Can't reach database server")) {
                console.warn(`[DB] Database connection failed. Retries left: ${retries}`);
                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기 후 재시도
                    continue;
                }
            }
            
            // 다른 오류는 즉시 throw
            throw error;
        }
    }
    
    // 모든 재시도 실패
    console.error('[DB] Failed to connect to database after 3 attempts.');
    console.error('[DB] Please check:');
    console.error('[DB] 1. DATABASE_URL environment variable is set correctly');
    console.error('[DB] 2. Database server is running and accessible');
    console.error('[DB] 3. Network connection is stable');
    throw lastError;
};


// --- Repository Functions ---

// --- Key-Value Store ---
export const getKV = async <T>(key: string): Promise<T | null> => {
    const kvRepository = await import('./repositories/kvRepository.ts');
    return kvRepository.getKV<T>(key);
};
export const setKV = async <T>(key: string, value: T): Promise<void> => {
    const kvRepository = await import('./repositories/kvRepository.ts');
    return kvRepository.setKV(key, value);
};

// --- User Functions ---
// 사용자 정보 메모리 캐시 (짧은 TTL로 빠른 응답)
interface CachedUser {
    user: User;
    timestamp: number;
}

const userCache = new Map<string, CachedUser>();
// Railway 환경에서는 캐시 TTL을 늘려서 데이터베이스 쿼리 감소
// 로컬 환경도 성능 개선을 위해 캐시 TTL 증가
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
// Railway DB는 네트워크 지연이 크므로 캐시 TTL을 더 길게 설정
const CACHE_TTL = isRailway ? 120000 : 30000; // Railway: 120초, 로컬: 30초 캐시 (성능 대폭 개선)
const MAX_CACHE_SIZE = 2000; // 최대 캐시 크기 제한 증가 (더 많은 사용자 캐싱)

// Railway 최적화: 기본적으로 equipment/inventory 제외
// getAllUsers 결과 캐싱 (WebSocket 연결 시마다 호출되므로)
let allUsersCache: { users: User[]; timestamp: number } | null = null;
const ALL_USERS_CACHE_TTL = isRailway ? 10000 : 5000; // Railway: 10초, 로컬: 5초 캐시 (성능 최적화)

export const getAllUsers = async (options?: { includeEquipment?: boolean; includeInventory?: boolean }): Promise<User[]> => {
    // equipment/inventory가 필요 없는 경우에만 캐시 사용
    const needsEquipment = options?.includeEquipment ?? false;
    const needsInventory = options?.includeInventory ?? false;
    const canUseCache = !needsEquipment && !needsInventory;
    
    if (canUseCache && allUsersCache) {
        const now = Date.now();
        if (now - allUsersCache.timestamp < ALL_USERS_CACHE_TTL) {
            return allUsersCache.users;
        }
    }
    
    const { listUsers } = await import('./prisma/userService.js');
    const users = await listUsers(options);
    
    // 캐시 업데이트 (equipment/inventory가 필요 없는 경우에만)
    if (canUseCache) {
        allUsersCache = {
            users: deepClone(users), // 깊은 복사 (최적화된 방식)
            timestamp: Date.now()
        };
    }
    
    return users;
};

// 캐시 크기 제한 (LRU 방식으로 오래된 항목 제거)
const cleanupCache = () => {
    if (userCache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(userCache.entries());
        // TTL이 지난 항목 먼저 제거
        const now = Date.now();
        entries.forEach(([key, value]) => {
            if (now - value.timestamp > CACHE_TTL) {
                userCache.delete(key);
            }
        });
        // 여전히 크기가 크면 오래된 항목부터 제거
        if (userCache.size > MAX_CACHE_SIZE) {
            const sorted = entries
                .filter(([key]) => userCache.has(key)) // 이미 삭제된 항목 제외
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = sorted.slice(0, userCache.size - MAX_CACHE_SIZE);
            toRemove.forEach(([key]) => userCache.delete(key));
        }
    }
};

export const getUser = async (id: string, options?: { includeEquipment?: boolean; includeInventory?: boolean }): Promise<User | null> => {
    // 캐시 정리 (주기적으로)
    if (Math.random() < 0.1) { // 10% 확률로 캐시 정리 (성능 오버헤드 최소화)
        cleanupCache();
    }
    
    // 캐시 확인 (equipment/inventory가 필요 없는 경우에만 캐시 사용)
    const needsEquipment = options?.includeEquipment ?? false;
    const needsInventory = options?.includeInventory ?? false;
    const canUseCache = !needsEquipment && !needsInventory;
    
    if (canUseCache) {
        const cached = userCache.get(id);
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < CACHE_TTL) {
            return cached.user;
        }
    }
    
    // 캐시 미스 또는 만료 - DB에서 조회
    const user = await prismaGetUserById(id, options);
    
    if (user && canUseCache) {
        // 캐시에 저장 (equipment/inventory가 필요 없는 경우에만)
        userCache.set(id, {
            user: deepClone(user), // 깊은 복사 (최적화된 방식)
            timestamp: Date.now()
        });
    } else if (!user) {
        // 사용자가 없으면 캐시에서도 제거
        userCache.delete(id);
    }
    
    return user;
};

// 사용자 정보가 업데이트되면 캐시 무효화
export const invalidateUserCache = (userId: string) => {
    userCache.delete(userId);
    // getAllUsers 캐시도 무효화 (사용자 정보 변경 시)
    allUsersCache = null;
};
export const getUserByNickname = async (nickname: string): Promise<User | null> => {
    return prismaGetUserByNickname(nickname);
};
export const getUserByEmail = async (email: string): Promise<User | null> => {
    return prismaGetUserByEmail(email);
};
export const getUsersByLeague = async (league: string | null, excludeUserId?: string): Promise<User[]> => {
    return prismaGetUsersByLeague(league, excludeUserId);
};
export const createUser = async (user: User): Promise<void> => {
    await prismaCreateUser(user);
};
export const updateUser = async (user: User): Promise<void> => {
    // 캐시에서 기존 데이터 확인 (DB 조회 최소화)
    let existing: User | null = null;
    const cached = userCache.get(user.id);
    if (cached) {
        existing = cached.user;
    }
    // 캐시에 없어도 DB 조회는 스킵 (성능 최적화)

    if (existing) {
        const prevInventoryCount = Array.isArray(existing.inventory) ? existing.inventory.length : 0;
        const nextInventoryCount = Array.isArray(user.inventory) ? user.inventory.length : 0;
        const prevEquipmentCount = existing.equipment ? Object.keys(existing.equipment).length : 0;
        const nextEquipmentCount = user.equipment ? Object.keys(user.equipment).length : 0;

        if (prevInventoryCount > 0 && nextInventoryCount === 0) {
            console.error(`[DB] CRITICAL: updateUser would clear inventory for ${user.id}. Restoring previous inventory snapshot.`);
            user.inventory = deepClone(existing.inventory);
        }
        if (prevEquipmentCount > 0 && nextEquipmentCount === 0) {
            console.error(`[DB] CRITICAL: updateUser would clear equipment for ${user.id}. Restoring previous equipment snapshot.`);
            user.equipment = deepClone(existing.equipment);
        }
    }

    await prismaUpdateUser(user);
    // 사용자 정보 업데이트 후 캐시 즉시 업데이트 (DB 재조회 방지로 성능 향상)
    userCache.set(user.id, {
        user: deepClone(user), // 깊은 복사 (최적화된 방식)
        timestamp: Date.now()
    });
    // getAllUsers 캐시도 무효화 (사용자 정보 변경 시)
    allUsersCache = null;
    
    // gameCache의 userCache도 업데이트 (다음 요청에서 캐시 히트 보장)
    try {
        const { updateUserCache } = await import('./gameCache.js');
        updateUserCache(user);
    } catch (error) {
        // gameCache가 없어도 치명적이지 않음 (로깅만)
        if (process.env.NODE_ENV === 'development') {
            console.warn('[updateUser] Failed to update gameCache:', error);
        }
    }
};
export const deleteUser = async (id: string): Promise<void> => {
    const user = await prismaGetUserById(id);
    if (!user) return;

    await deleteUserCredentialByUsername(user.username);
    await prismaDeleteUser(id);
    // 사용자 삭제 후 캐시 무효화
    invalidateUserCache(id);
};

// --- User Credentials Functions ---
export const getUserCredentials = async (username: string): Promise<UserCredentials | null> => {
    const cred = await getUserCredentialByUsername(username.toLowerCase());
    return cred ? { username: cred.username, passwordHash: cred.passwordHash, userId: cred.userId } : null;
};
export const getUserCredentialsByUserId = async (userId: string): Promise<UserCredentials | null> => {
    const cred = await getUserCredentialByUserId(userId);
    return cred ? { username: cred.username, passwordHash: cred.passwordHash, userId: cred.userId } : null;
};
export const createUserCredentials = async (username: string, passwordHash: string | null, userId: string, kakaoId?: string | null): Promise<void> => {
    await createUserCredential(username, passwordHash, userId, kakaoId);
};

export const getUserCredentialsByKakaoId = async (kakaoId: string): Promise<UserCredentials | null> => {
    const cred = await getUserCredentialByKakaoId(kakaoId);
    return cred ? { username: cred.username, passwordHash: cred.passwordHash, userId: cred.userId } : null;
};
export const updateUserCredentialPassword = async (userId: string, updates: { passwordHash?: string | null; kakaoId?: string | null; emailVerified?: boolean }): Promise<void> => {
    await updateUserCredential(userId, updates);
};

// --- Email Verification Functions ---
export const createEmailVerificationToken = async (data: {
    userId: string;
    email: string;
    token: string;
    code: string;
    expiresAt: Date;
}): Promise<void> => {
    await prismaCreateEmailVerificationToken(data);
};

export const getEmailVerificationTokenByUserId = async (userId: string) => {
    return await prismaGetEmailVerificationTokenByUserId(userId);
};

export const getEmailVerificationTokenByToken = async (token: string) => {
    return await prismaGetEmailVerificationTokenByToken(token);
};

export const deleteEmailVerificationTokens = async (userId: string): Promise<void> => {
    await prismaDeleteEmailVerificationTokens(userId);
};

export const verifyUserEmail = async (userId: string): Promise<void> => {
    await prismaVerifyUserEmail(userId);
    await updateUserCredential(userId, { emailVerified: true });
};

// --- Game Functions ---
export const getLiveGame = async (id: string): Promise<LiveGameSession | null> => {
    const { getLiveGame: prismaGetLiveGame } = await import('./prisma/gameService.ts');
    return prismaGetLiveGame(id);
};
export const getAllActiveGames = async (): Promise<LiveGameSession[]> => {
    const { getAllActiveGames: prismaGetAllActiveGames } = await import('./prisma/gameService.ts');
    return prismaGetAllActiveGames();
};
export const getAllEndedGames = async (): Promise<LiveGameSession[]> => {
    const { getAllEndedGames: prismaGetAllEndedGames } = await import('./prisma/gameService.ts');
    return prismaGetAllEndedGames();
};
export const saveGame = async (game: LiveGameSession, forceSave: boolean = false): Promise<void> => {
    // PVE 게임 최적화: 메모리에만 저장하고 게임 종료 시에만 DB 저장
    const isPVE = game.isSinglePlayer || game.gameCategory === 'tower';
    const isGameEnded = game.gameStatus === 'ended' || game.gameStatus === 'no_contest';
    
    if (isPVE && !isGameEnded && !forceSave) {
        // PVE 게임은 메모리에만 저장 (DB 저장 스킵)
        const now = Date.now();
        game.serverRevision = (game.serverRevision ?? 0) + 1;
        game.lastSyncedAt = now;
        // 캐시 자동 업데이트 (메모리 저장 후 즉시 반영)
        try {
            const { updateGameCache } = await import('./gameCache.js');
            updateGameCache(game);
        } catch (error) {
            // 캐시 업데이트 실패는 치명적이지 않으므로 로그만 남김
            console.warn(`[DB] Failed to update game cache for ${game.id}:`, error);
        }
        return;
    }
    
    // PVP 게임 또는 게임 종료 시 DB에 저장
    const { saveGame: prismaSaveGame } = await import('./prisma/gameService.ts');
    const now = Date.now();
    game.serverRevision = (game.serverRevision ?? 0) + 1;
    game.lastSyncedAt = now;
    await prismaSaveGame(game);
    // 캐시 자동 업데이트 (DB 저장 후 즉시 반영)
    try {
        const { updateGameCache } = await import('./gameCache.js');
        updateGameCache(game);
    } catch (error) {
        // 캐시 업데이트 실패는 치명적이지 않으므로 로그만 남김
        console.warn(`[DB] Failed to update game cache for ${game.id}:`, error);
    }
};
export const createHomeBoardPost = async (data: { title: string; content: string; authorId: string; isPinned: boolean }): Promise<HomeBoardPost> => {
    const prisma = (await import('./prismaClient.js')).default;
    const post = await prisma.homeBoardPost.create({
        data: {
            title: data.title,
            content: data.content,
            authorId: data.authorId,
            isPinned: data.isPinned
        }
    });
    return {
        id: post.id,
        title: post.title,
        content: post.content,
        authorId: post.authorId,
        isPinned: post.isPinned,
        createdAt: post.createdAt.getTime(),
        updatedAt: post.updatedAt.getTime()
    };
};

export const getAllHomeBoardPosts = async (): Promise<HomeBoardPost[]> => {
    const prisma = (await import('./prismaClient.js')).default;
    const posts = await prisma.homeBoardPost.findMany({
        orderBy: [
            { isPinned: 'desc' },
            { createdAt: 'desc' }
        ]
    });
    return posts.map(post => ({
        id: post.id,
        title: post.title,
        content: post.content,
        authorId: post.authorId,
        isPinned: post.isPinned,
        createdAt: post.createdAt.getTime(),
        updatedAt: post.updatedAt.getTime()
    }));
};

export const getHomeBoardPost = async (id: string): Promise<HomeBoardPost | null> => {
    const prisma = (await import('./prismaClient.js')).default;
    const post = await prisma.homeBoardPost.findUnique({
        where: { id }
    });
    if (!post) return null;
    return {
        id: post.id,
        title: post.title,
        content: post.content,
        authorId: post.authorId,
        isPinned: post.isPinned,
        createdAt: post.createdAt.getTime(),
        updatedAt: post.updatedAt.getTime()
    };
};

export const updateHomeBoardPost = async (id: string, data: { title: string; content: string; isPinned: boolean }): Promise<HomeBoardPost> => {
    const prisma = (await import('./prismaClient.js')).default;
    const post = await prisma.homeBoardPost.update({
        where: { id },
        data: {
            title: data.title,
            content: data.content,
            isPinned: data.isPinned
        }
    });
    return {
        id: post.id,
        title: post.title,
        content: post.content,
        authorId: post.authorId,
        isPinned: post.isPinned,
        createdAt: post.createdAt.getTime(),
        updatedAt: post.updatedAt.getTime()
    };
};

export const deleteHomeBoardPost = async (id: string): Promise<void> => {
    const prisma = (await import('./prismaClient.js')).default;
    await prisma.homeBoardPost.delete({
        where: { id }
    });
};

export const deleteGame = async (id: string): Promise<void> => {
    const { deleteGame: prismaDeleteGame } = await import('./prisma/gameService.ts');
    await prismaDeleteGame(id);
};


// --- Full State Retrieval (for client sync) ---
export const getAllData = async (): Promise<Pick<AppState, 'users' | 'userCredentials' | 'liveGames' | 'singlePlayerGames' | 'towerGames' | 'adminLogs' | 'announcements' | 'globalOverrideAnnouncement' | 'gameModeAvailability' | 'announcementInterval' | 'homeBoardPosts'> & { guilds?: Record<string, any> }> => {
    // Railway DB 성능 최적화: equipment/inventory 제외하여 쿼리 속도 향상
    const users = await listUsers({ includeEquipment: false, includeInventory: false });
    const allGames = await getAllActiveGames();
    const kvRepository = await import('./repositories/kvRepository.ts');
    
    // 게임을 카테고리별로 분리
    const liveGames: Record<string, LiveGameSession> = {};
    const singlePlayerGames: Record<string, LiveGameSession> = {};
    const towerGames: Record<string, LiveGameSession> = {};
    
    for (const game of allGames) {
        const category = game.gameCategory || (game.isSinglePlayer ? 'singleplayer' : 'normal');
        if (category === 'singleplayer') {
            singlePlayerGames[game.id] = game;
        } else if (category === 'tower') {
            towerGames[game.id] = game;
        } else {
            liveGames[game.id] = game;
        }
    }
    
    const adminLogs = await kvRepository.getKV<AdminLog[]>('adminLogs') || [];
    const announcements = await kvRepository.getKV<Announcement[]>('announcements') || [];
    const globalOverrideAnnouncement = await kvRepository.getKV<OverrideAnnouncement | null>('globalOverrideAnnouncement');
    const gameModeAvailability = await kvRepository.getKV<Record<GameMode, boolean>>('gameModeAvailability') || {};
    const announcementInterval = await kvRepository.getKV<number>('announcementInterval') || 3;
    const homeBoardPosts = await getAllHomeBoardPosts();
    const guilds = await kvRepository.getKV<Record<string, any>>('guilds') || {};
    
    // 사용자 데이터 최적화: 공개 정보만 포함 (인벤토리, 메일, 퀘스트 등은 제외)
    const optimizedUsers: Record<string, any> = {};
    for (const user of users) {
        const nickname = user.nickname && user.nickname.trim().length > 0 ? user.nickname : user.username;
        optimizedUsers[user.id] = {
            id: user.id,
            username: user.username,
            nickname,
            isAdmin: user.isAdmin,
            strategyLevel: user.strategyLevel,
            strategyXp: user.strategyXp,
            playfulLevel: user.playfulLevel,
            playfulXp: user.playfulXp,
            gold: user.gold,
            diamonds: user.diamonds,
            stats: user.stats,
            mannerScore: user.mannerScore,
            avatarId: user.avatarId,
            borderId: user.borderId,
            tournamentScore: user.tournamentScore,
            league: user.league,
            mbti: user.mbti,
            isMbtiPublic: user.isMbtiPublic,
            inventory: user.inventory ?? [],
            equipment: user.equipment ?? {},
            baseStats: user.baseStats ?? {},
            spentStatPoints: user.spentStatPoints ?? {},
            cumulativeRankingScore: user.cumulativeRankingScore ?? {},
            cumulativeTournamentScore: user.cumulativeTournamentScore ?? 0,
            dailyRankings: user.dailyRankings ?? {},
        };
    }
    
    return {
        users: optimizedUsers,
        userCredentials: {}, // Never send credentials to client
        liveGames,
        singlePlayerGames,
        towerGames,
        adminLogs,
        announcements,
        globalOverrideAnnouncement,
        gameModeAvailability,
        announcementInterval,
        homeBoardPosts,
        guilds,
    };
};