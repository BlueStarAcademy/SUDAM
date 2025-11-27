import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import process from 'process';
import http from 'http';
import { createWebSocketServer, broadcast } from './socket.js';
import { handleAction, resetAndGenerateQuests, updateQuestProgress } from './gameActions.js';
import { regenerateActionPoints } from './effectService.js';
import { updateGameStates } from './gameModes.js';
import * as db from './db.js';
import { analyzeGame, initializeKataGo } from './kataGoService.js';
// FIX: Import missing types from the centralized types file.
import * as types from '../types/index.js';
import { Player } from '../types/index.js';
import { processGameSummary, endGame } from './summaryService.js';
// FIX: Correctly import from the placeholder module.
import * as aiPlayer from './aiPlayer.js';
import { processRankingRewards, processWeeklyLeagueUpdates, updateWeeklyCompetitorsIfNeeded, processWeeklyTournamentReset, resetAllTournamentScores, resetAllUsersLeagueScoresForNewWeek, processDailyRankings, processDailyQuestReset, resetAllChampionshipScoresToZero, processTowerRankingRewards } from './scheduledTasks.js';
import * as tournamentService from './tournamentService.js';
import { AVATAR_POOL, BOT_NAMES, PLAYFUL_GAME_MODES, SPECIAL_GAME_MODES, SINGLE_PLAYER_MISSIONS, GRADE_LEVEL_REQUIREMENTS, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '../constants';
import { calculateTotalStats } from './statService.js';
import { isSameDayKST, getKSTDate } from '../utils/timeUtils.js';
import { createDefaultBaseStats, createDefaultUser } from './initialData.ts';
import { containsProfanity } from '../profanity.js';
import { volatileState } from './state.js';
import { CoreStat } from '../types/index.js';
import { clearAiSession, syncAiSession } from './aiSessionManager.js';
import { hashPassword, verifyPassword } from './utils/passwordUtils.js';
import { sendEmailVerification, verifyEmailCode } from './services/emailVerificationService.js';
import { getKakaoAuthUrl, getKakaoAccessToken, getKakaoUserInfo } from './services/kakaoAuthService.js';

const getTournamentStateByType = (user: types.User, type: types.TournamentType): types.TournamentState | null => {
    switch (type) {
        case 'neighborhood':
            return user.lastNeighborhoodTournament ?? null;
        case 'national':
            return user.lastNationalTournament ?? null;
        case 'world':
            return user.lastWorldTournament ?? null;
        default:
            return null;
    }
};

let isProcessingTournamentTick = false;
let isProcessingMainLoop = false;
let hasLoggedMainLoopSkip = false;

const OFFLINE_REGEN_INTERVAL_MS = 60_000; // 1 minute
let lastOfflineRegenAt = 0;
const DAILY_TASK_CHECK_INTERVAL_MS = 60_000; // 1 minute
let lastDailyTaskCheckAt = 0;
let lastBotScoreUpdateAt = 0;

// 만료된 negotiation 정리 함수
const cleanupExpiredNegotiations = (volatileState: types.VolatileState, now: number): void => {
    const expiredNegIds: string[] = [];
    
    for (const [negId, neg] of Object.entries(volatileState.negotiations)) {
        if (neg.deadline && now > neg.deadline && neg.status === 'pending') {
            expiredNegIds.push(negId);
            
            // 사용자 상태 복구
            if (volatileState.userStatuses[neg.challenger.id]?.status === types.UserStatus.Negotiating) {
                volatileState.userStatuses[neg.challenger.id].status = types.UserStatus.Waiting;
            }
            if (volatileState.userStatuses[neg.opponent.id]?.status === types.UserStatus.Negotiating) {
                volatileState.userStatuses[neg.opponent.id].status = types.UserStatus.Waiting;
            }
        }
    }
    
    for (const negId of expiredNegIds) {
        delete volatileState.negotiations[negId];
    }
    
    if (expiredNegIds.length > 0) {
        broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
    }
};

const processSinglePlayerMissions = (user: types.User): types.User => {
    const now = Date.now();
    if (!user.singlePlayerMissions) {
        return user;
    }

    let userModified = false;
    // We make a copy of the user object to modify. This is safer and avoids null issues.
    const updatedUser: types.User = JSON.parse(JSON.stringify(user));

    for (const missionId in updatedUser.singlePlayerMissions) {
        const missionState = updatedUser.singlePlayerMissions[missionId];
        const missionInfo = SINGLE_PLAYER_MISSIONS.find(m => m.id === missionId);

        if (missionState && missionInfo && missionState.isStarted) {
            // Ensure accumulatedAmount and level are numbers
            if (typeof missionState.accumulatedAmount !== 'number') {
                missionState.accumulatedAmount = 0;
                userModified = true;
            }
            if (typeof missionState.level !== 'number') {
                missionState.level = 1;
                userModified = true;
            }

            const currentLevel = missionState.level || 1;
            const levelInfo = missionInfo.levels[currentLevel - 1];
            if (!levelInfo) continue;

            if (missionState.accumulatedAmount >= levelInfo.maxCapacity) {
                continue; 
            }

            const elapsedMs = now - missionState.lastCollectionTime;
            const productionIntervalMs = levelInfo.productionRateMinutes * 60 * 1000;
            if (productionIntervalMs <= 0) continue;

            const cycles = Math.floor(elapsedMs / productionIntervalMs);

            if (cycles > 0) {
                const amountToAdd = cycles * levelInfo.rewardAmount;
                const newAmount = Math.min(levelInfo.maxCapacity, missionState.accumulatedAmount + amountToAdd);
                
                if (newAmount > missionState.accumulatedAmount) {
                    missionState.accumulatedAmount = newAmount;
                    missionState.lastCollectionTime += cycles * productionIntervalMs;
                    userModified = true;
                }
            }
        }
    }
    // Return the updated user only if there were modifications.
    return userModified ? updatedUser : user;
};


const startServer = async () => {
    // --- Debug: Check DATABASE_URL ---
    const dbUrl = process.env.DATABASE_URL;
    console.log(`[Server Startup] DATABASE_URL check: ${dbUrl ? `Set (length: ${dbUrl.length}, starts with: ${dbUrl.substring(0, 20)}...)` : 'NOT SET'}`);
    if (!dbUrl) {
        console.error("[Server Startup] DATABASE_URL is not set! Please check Railway Variables.");
        console.error("[Server Startup] All environment variables:", Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES')).join(', '));
    }
    
    // --- Initialize Database on Start ---
    try {
        await db.initializeDatabase();
    } catch (err: any) {
        console.error("Error during server startup:", err);
        
        // 데이터베이스 연결 오류인 경우 더 자세한 안내
        if (err.code === 'P1001' || err.message?.includes("Can't reach database server") || 
            err.message?.includes('connection') || err.code?.startsWith('P')) {
            console.error("\n[Server] Database connection failed!");
            console.error("[Server] Please ensure:");
            console.error("[Server] 1. DATABASE_URL environment variable is set correctly");
            console.error("[Server] 2. Database server is running and accessible");
            console.error("[Server] 3. Network connection allows access to the database");
            
            const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.DATABASE_URL?.includes('railway');
            if (isRailway) {
                console.error("\n[Server] Railway-specific checks:");
                console.error("[Server] 1. Railway Postgres service is running");
                console.error("[Server] 2. Postgres service is connected to your backend service");
                console.error("[Server] 3. Check Railway Dashboard → Your Service → Variables → DATABASE_URL");
                console.error("[Server] 4. DATABASE_URL should use internal network: postgres.railway.internal:5432");
                console.error("[Server] 5. If using public URL, ensure it's correct and accessible");
            }
            
            console.error("\n[Server] Example DATABASE_URL format:");
            console.error("[Server] postgresql://user:password@host:port/database");
        }
        
        // Railway 환경에서는 프로세스를 종료하지 않고 계속 재시도하도록 할 수도 있지만,
        // 현재는 명시적으로 종료하여 Railway가 재시작하도록 함
        (process as any).exit(1);
    }

    // Fetch all users from DB
    const allDbUsers = await db.getAllUsers();
    const coreStats = Object.values(CoreStat) as CoreStat[];
    let usersUpdatedCount = 0;

    // First, run the migration logic to ensure all users have correct base stats
    for (const user of allDbUsers) {
        const defaultBaseStats = createDefaultBaseStats();
        let needsUpdate = false;

        // More robust check: if baseStats is missing, or any stat is not a number or is less than 100
        if (!user.baseStats || coreStats.some(stat => typeof user.baseStats?.[stat] !== 'number' || user.baseStats[stat] < 100)) {
            user.baseStats = defaultBaseStats;
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            console.log(`[Server Startup] Updating base stats for user: ${user.nickname}`);
            await db.updateUser(user);
            usersUpdatedCount++;
        }
    }

    console.log(`[Server Startup] Base stats update complete. ${usersUpdatedCount} user(s) had their base stats updated.`);

    // --- 1회성 작업들 (환경 변수로 제어) ---
    // 필요시에만 주석을 해제하여 실행하세요.
    
    // --- 1회성 챔피언십 점수 초기화 ---
    // await resetAllTournamentScores();
    
    // --- 1회성: 모든 유저의 리그 점수를 0으로 초기화 ---
    // await resetAllUsersLeagueScoresForNewWeek();
    
    // --- 1회성: 모든 유저의 챔피언십 점수를 0으로 초기화 ---
    // await resetAllChampionshipScoresToZero();
    
    // --- 1회성: 어제 점수가 0으로 되어있는 봇 점수 수정 (즉시 실행) ---
    try {
        console.log(`[Server Startup] Fixing bot yesterday scores...`);
        const scheduledTasks = await import('./scheduledTasks.js');
        if (scheduledTasks.fixBotYesterdayScores && typeof scheduledTasks.fixBotYesterdayScores === 'function') {
            await scheduledTasks.fixBotYesterdayScores();
        } else {
            console.warn('[Server Startup] fixBotYesterdayScores function not found, skipping...');
        }
    } catch (error: any) {
        console.error('[Server Startup] Failed to fix bot yesterday scores:', error.message);
        // 서버 시작을 계속 진행 (치명적 오류가 아님)
    }
    
    // --- 봇 점수 관련 로직은 이미 개선되어 서버 시작 시 실행 불필요 ---
    // const { grantThreeDaysBotScores } = await import('./scheduledTasks.js');
    // await grantThreeDaysBotScores();
    // 
    // --- 모든 유저의 경쟁 상대 봇 점수 즉시 계산 및 업데이트 ---
    // console.log(`[Server Startup] Updating bot scores for all users...`);
    // const { updateBotLeagueScores } = await import('./scheduledTasks.js');
    // let botScoreUpdateCount = 0;
    // for (const user of allDbUsers) {
    //     const updatedUser = await updateBotLeagueScores(user);
    //     if (JSON.stringify(user) !== JSON.stringify(updatedUser)) {
    //         await db.updateUser(updatedUser);
    //         botScoreUpdateCount++;
    //     }
    // }
    // console.log(`[Server Startup] Bot scores update complete. ${botScoreUpdateCount} user(s) had their bot scores updated.`);

    const app = express();
    console.log(`[Server] process.env.PORT: ${process.env.PORT}`);
    const port = parseInt(process.env.PORT || '4000', 10);
    console.log(`[Server] Using port: ${port}`);

    app.use(cors());
    app.use(express.json({ limit: '10mb' }) as any);
    
    // Ignore development tooling noise such as Vite/Esbuild status pings
    app.use('/@esbuild', (_req, res) => {
        res.status(204).end();
    });

    // Serve static files from public directory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, '..', 'public');
    app.use('/images', express.static(path.join(publicPath, 'images')));
    app.use('/sounds', express.static(path.join(publicPath, 'sounds')));
    
    // Serve frontend build files (CSS, JS, assets)
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath, {
        maxAge: '1h', // Cache HTML for 1 hour (shorter for SPA updates)
        etag: true,
        lastModified: true,
        index: false, // Don't serve index.html for directory requests
        setHeaders: (res, filePath) => {
            // Set proper MIME types for JS modules
            if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            }
        }
    }));
    
    // 응답 압축 미들웨어 (네트워크 전송량 감소)
    const compression = (await import('compression')).default;
    app.use(compression({
        filter: (req, res) => {
            // JSON 응답과 텍스트만 압축 (이미지 등은 제외)
            if (req.headers['x-no-compression']) {
                return false;
            }
            return compression.filter(req, res);
        },
        level: 6, // 압축 레벨 (1-9, 6이 속도와 압축률의 균형)
        threshold: 1024, // 1KB 이상만 압축
    }));

    // --- Constants ---
    const LOBBY_TIMEOUT_MS = 90 * 1000;
    const GAME_DISCONNECT_TIMEOUT_MS = 90 * 1000;
    const DISCONNECT_TIMER_S = 90;

    const server = http.createServer(app);
    createWebSocketServer(server);

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`[Server] Port ${port} is already in use. Please stop the process using this port or use a different port.`);
            console.error(`[Server] To find and kill the process: netstat -ano | findstr ":${port}"`);
            process.exit(1);
        } else {
            console.error('[Server] Server error:', error);
            process.exit(1);
        }
    });

    server.listen(port, '0.0.0.0', async () => {
        console.log(`[Server] Server listening on port ${port}`);
        
        // KataGo 엔진 초기화 (서버 시작 시 미리 준비)
        await initializeKataGo();
    });

    const processActiveTournamentSimulations = async () => {
        if (isProcessingTournamentTick) return;
        const activeTournaments = volatileState.activeTournaments;
        if (!activeTournaments || Object.keys(activeTournaments).length === 0) {
            return;
        }

        isProcessingTournamentTick = true;
        try {
            // 각 토너먼트를 독립적으로 병렬 처리 (PVE 게임처럼)
            const tournamentEntries = Object.entries(activeTournaments);
            
            // 각 토너먼트를 독립적으로 처리하는 함수
            const processTournament = async ([userId, activeState]: [string, types.TournamentState]) => {
                try {
                    // 캐시를 사용하여 DB 조회 최소화
                    const { getCachedUser, updateUserCache } = await import('./gameCache.js');
                    const user = await getCachedUser(userId);
                    if (!user) {
                        delete activeTournaments[userId];
                        return;
                    }

                    const tournamentState = getTournamentStateByType(user, activeState.type);
                    if (!tournamentState || tournamentState.status !== 'round_in_progress') {
                        delete activeTournaments[userId];
                        return;
                    }

                    const advanced = tournamentService.advanceSimulation(tournamentState, user);
                    if (!advanced) {
                        return;
                    }

                    // Keep volatile state reference updated
                    activeTournaments[userId] = tournamentState;

                    // 사용자 캐시 업데이트
                    updateUserCache(user);
                    // DB 저장은 비동기로 처리하여 응답 지연 최소화
                    db.updateUser(user).catch(err => {
                        console.error(`[TournamentTicker] Failed to save user ${userId}:`, err);
                    });

                    const sanitizedUser = JSON.parse(JSON.stringify(user));
                    broadcast({ type: 'USER_UPDATE', payload: { [user.id]: sanitizedUser } });

                    if (tournamentState.status !== 'round_in_progress') {
                        delete activeTournaments[userId];
                    }
                } catch (error) {
                    console.error(`[TournamentTicker] Failed to advance simulation for user ${userId}`, error);
                }
            };

            // 모든 토너먼트를 병렬로 처리 (각 토너먼트는 독립적)
            await Promise.all(tournamentEntries.map(processTournament));
        } catch (error) {
            console.error('[TournamentTicker] Failed to process tournament simulations', error);
        } finally {
            isProcessingTournamentTick = false;
        }
    };

    // Tournament simulation ticker - 클라이언트에서 실행하도록 변경되어 비활성화
    // const scheduleTournamentTick = () => {
    //     const startTime = Date.now();
    //     processActiveTournamentSimulations().finally(() => {
    //         const elapsed = Date.now() - startTime;
    //         // 다음 틱은 정확히 1초 후에 실행 (실행 시간 보정)
    //         const nextDelay = Math.max(0, 1000 - elapsed);
    //         setTimeout(scheduleTournamentTick, nextDelay);
    //     });
    // };
    // scheduleTournamentTick();

    const scheduleMainLoop = (delay = 1000) => {
        setTimeout(async () => {
            if (isProcessingMainLoop) {
                scheduleMainLoop(Math.min(delay * 2, 5000));
                return;
            }

            isProcessingMainLoop = true;
            hasLoggedMainLoopSkip = false;
            try {
                const now = Date.now();
                
                // 랭킹전 매칭 처리 (1초마다)
                if (volatileState.rankedMatchingQueue) {
                    const { tryMatchPlayers } = await import('./actions/socialActions.js');
                    for (const lobbyType of ['strategic', 'playful'] as const) {
                        if (volatileState.rankedMatchingQueue[lobbyType] && Object.keys(volatileState.rankedMatchingQueue[lobbyType]).length >= 2) {
                            await tryMatchPlayers(volatileState, lobbyType);
                        }
                    }
                }

            // --- START NEW OFFLINE AP REGEN LOGIC ---
            if (now - lastOfflineRegenAt >= OFFLINE_REGEN_INTERVAL_MS) {
                // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드
                const { listUsers } = await import('./prisma/userService.js');
                const allUsers = await listUsers({ includeEquipment: false, includeInventory: false });
                
                // 매일 0시에 토너먼트 상태 자동 리셋 확인 (processDailyQuestReset에서 처리되지만, 
                // 메인 루프에서도 날짜 변경 시 체크하여 오프라인 사용자도 리셋되도록 보장)
                const { getKSTHours, getKSTMinutes } = await import('../utils/timeUtils.js');
                const kstHoursForReset = getKSTHours(now);
                const kstMinutesForReset = getKSTMinutes(now);
                const isMidnightForReset = kstHoursForReset === 0 && kstMinutesForReset < 5;
                
                for (const user of allUsers) {
                    let updatedUser = user;
                    
                    // 매일 0시에만 토너먼트 상태 리셋 (로그인하지 않은 사용자도 포함)
                    if (isMidnightForReset) {
                        updatedUser = await resetAndGenerateQuests(updatedUser);
                    }
                    
                    updatedUser = await regenerateActionPoints(updatedUser);
                    updatedUser = processSinglePlayerMissions(updatedUser);
                    
                    // 봇의 리그 점수 업데이트 (하루에 한번, 단 월요일 0시는 제외 - processWeeklyResetAndRematch에서 처리)
                    const { getKSTDay } = await import('../utils/timeUtils.js');
                    const kstDayForBotUpdate = getKSTDay(now);
                    const kstHoursForBotUpdate = getKSTHours(now);
                    const kstMinutesForBotUpdate = getKSTMinutes(now);
                    const isMondayMidnightForBotUpdate = kstDayForBotUpdate === 1 && kstHoursForBotUpdate === 0 && kstMinutesForBotUpdate < 5;
                    if (!isMondayMidnightForBotUpdate) {
                        const { updateBotLeagueScores } = await import('./scheduledTasks.js');
                        updatedUser = await updateBotLeagueScores(updatedUser);
                    }
                    
                    // 최적화: 간단한 필드 비교로 변경 (JSON.stringify 대신)
                    const hasChanges = user.actionPoints !== updatedUser.actionPoints ||
                        user.gold !== updatedUser.gold ||
                        user.singlePlayerMissions !== updatedUser.singlePlayerMissions ||
                        user.weeklyCompetitors !== updatedUser.weeklyCompetitors;
                    if (hasChanges) {
                        await db.updateUser(updatedUser);
                    }
                }

                lastOfflineRegenAt = now;
                }
                // --- END NEW OFFLINE AP REGEN LOGIC ---

            // 캐시 정리 (주기적으로 실행)
            const { cleanupExpiredCache } = await import('./gameCache.js');
            cleanupExpiredCache();
            
            // 만료된 negotiation 정리
            cleanupExpiredNegotiations(volatileState, now);

            const activeGames = await db.getAllActiveGames();
            const originalGamesJson = activeGames.map(g => JSON.stringify(g));
            
            // 게임을 캐시에 미리 로드
            const { updateGameCache } = await import('./gameCache.js');
            for (const game of activeGames) {
                updateGameCache(game);
            }
            
            // Handle weekly league updates (Monday 0:00 KST) - 점수 리셋 전에 실행
            // 리그 업데이트는 각 사용자 로그인 시 processWeeklyLeagueUpdates에서 처리되지만,
            // 월요일 0시에 명시적으로 모든 사용자에 대해 리그 업데이트를 실행
                if (now - lastDailyTaskCheckAt >= DAILY_TASK_CHECK_INTERVAL_MS) {
                const { getKSTDay, getKSTHours, getKSTMinutes, getKSTFullYear, getKSTMonth, getKSTDate_UTC, getKSTDate } = await import('../utils/timeUtils.js');
                const kstDay = getKSTDay(now);
                const kstHours = getKSTHours(now);
                const kstMinutes = getKSTMinutes(now);
                const isMondayMidnight = kstDay === 1 && kstHours === 0 && kstMinutes < 5;
                
                // 디버깅: 현재 KST 시간 정보 로그 (0시 근처에만)
                if (process.env.NODE_ENV === 'development' && (kstHours === 0 || (kstHours === 23 && kstMinutes >= 55))) {
                    console.log(`[Server] Daily task check: KST Day=${kstDay}, Hours=${kstHours}, Minutes=${kstMinutes}, isMondayMidnight=${isMondayMidnight}`);
                }
                
                // 중복 실행 방지: 이번 월요일 0시에 이미 처리했는지 확인
                if (isMondayMidnight) {
                    const { getLastWeeklyLeagueUpdateTimestamp, setLastWeeklyLeagueUpdateTimestamp, processWeeklyResetAndRematch } = await import('./scheduledTasks.js');
                    const { getStartOfDayKST } = await import('../utils/timeUtils.js');
                    const lastUpdateTimestamp = getLastWeeklyLeagueUpdateTimestamp();
                    
                    // 실행 조건: lastUpdateTimestamp가 null이거나, 현재 날짜와 다른 경우 (KST 기준)
                    const shouldProcess = lastUpdateTimestamp === null || getStartOfDayKST(lastUpdateTimestamp) !== getStartOfDayKST(now);
                    if (shouldProcess) {
                        console.log(`[WeeklyLeagueUpdate] Processing weekly league updates for all users at Monday 0:00 KST`);
                        setLastWeeklyLeagueUpdateTimestamp(now);
                        
                        // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드
                        const { listUsers } = await import('./prisma/userService.js');
                        const allUsersForLeagueUpdate = await listUsers({ includeEquipment: false, includeInventory: false });
                        let usersUpdated = 0;
                        let mailsSent = 0;
                        
                        // 1. 티어변동 처리 (이전 주간 점수로 순위 계산 후 티어 결정)
                        for (const user of allUsersForLeagueUpdate) {
                            const updatedUser = await processWeeklyLeagueUpdates(user);
                            
                            // 메일이 추가되었는지 확인
                            const mailAdded = (updatedUser.mail?.length || 0) > (user.mail?.length || 0);
                            if (mailAdded) {
                                mailsSent++;
                                console.log(`[WeeklyLeagueUpdate] Mail sent to user ${user.nickname} (${user.id})`);
                            }
                            
                            // 최적화: 간단한 필드 비교로 변경 (JSON.stringify 대신)
                            const hasChanges = user.league !== updatedUser.league ||
                                user.tournamentScore !== updatedUser.tournamentScore ||
                                user.mail?.length !== updatedUser.mail?.length ||
                                user.weeklyCompetitors !== updatedUser.weeklyCompetitors;
                            if (hasChanges) {
                                await db.updateUser(updatedUser);
                                usersUpdated++;
                            }
                        }
                        console.log(`[WeeklyLeagueUpdate] Updated ${usersUpdated} users, sent ${mailsSent} mails`);
                        
                        // 2. 티어변동 후 새로운 경쟁상대 매칭 및 모든 점수 리셋
                        // force=true로 호출하여 월요일 0시 체크를 건너뛰고 강제 실행
                        await processWeeklyResetAndRematch(true);
                    }
                }
                
                // Handle weekly tournament reset (Monday 0:00 KST) - 이제 processWeeklyResetAndRematch에서 처리됨
                // 기존 함수는 호환성을 위해 유지하지만 실제 처리는 processWeeklyResetAndRematch에서 수행
                if (!isMondayMidnight) {
                    await processWeeklyTournamentReset();
                }
                
                // Handle ranking rewards
                await processRankingRewards(volatileState);
                
                // Handle daily ranking calculations (매일 0시 정산)
                await processDailyRankings();
                await processTowerRankingRewards();
                
                // Handle daily quest reset (매일 0시 KST)
                await processDailyQuestReset();
                
                // Handle guild war matching (월요일 또는 금요일 0시 KST)
                const { processGuildWarMatching } = await import('./scheduledTasks.js');
                await processGuildWarMatching();

                lastDailyTaskCheckAt = now;
            }
            
            // 모든 유저의 봇 점수를 주기적으로 업데이트 (매일 0시가 아니어도)
            // 다른 유저가 볼 때도 정확한 봇 점수가 표시되도록 함
            // 1시간마다 실행 (과도한 DB 업데이트 방지)
            const BOT_SCORE_UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
            if (!lastBotScoreUpdateAt || (now - lastBotScoreUpdateAt >= BOT_SCORE_UPDATE_INTERVAL_MS)) {
                const { updateBotLeagueScores } = await import('./scheduledTasks.js');
                // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드
                const { listUsers } = await import('./prisma/userService.js');
                const allUsersForBotUpdate = await listUsers({ includeEquipment: false, includeInventory: false });
                let botsUpdated = 0;
                
                for (const user of allUsersForBotUpdate) {
                    if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
                        continue;
                    }
                    
                    // 봇 점수가 모두 0인지 확인
                    const hasZeroBotScores = user.weeklyCompetitors.some(c => 
                        c.id.startsWith('bot-') && 
                        (!user.weeklyCompetitorsBotScores?.[c.id] || 
                         user.weeklyCompetitorsBotScores[c.id].score === 0)
                    );
                    
                    // 봇 점수가 모두 0이면 강제 업데이트
                    // 1시간마다 실행되므로, 어제 날짜의 lastUpdate가 있으면 오늘 날짜 점수만 추가
                    const updatedUser = await updateBotLeagueScores(user, hasZeroBotScores);
                    if (JSON.stringify(user.weeklyCompetitorsBotScores || {}) !== JSON.stringify(updatedUser.weeklyCompetitorsBotScores || {})) {
                        await db.updateUser(updatedUser);
                        botsUpdated++;
                    }
                }
                
                if (botsUpdated > 0) {
                    console.log(`[BotScoreUpdate] Updated bot scores for ${botsUpdated} users`);
                }
                
                lastBotScoreUpdateAt = now;
            }

            // Handle user timeouts and disconnections
            const onlineUserIdsBeforeTimeoutCheck = Object.keys(volatileState.userConnections);
            for (const userId of onlineUserIdsBeforeTimeoutCheck) {
                // Re-check if user is still connected, as they might have been removed by a previous iteration
                if (!volatileState.userConnections[userId]) continue;

                const user = await db.getUser(userId);
                if (!user) continue;

                const userStatus = volatileState.userStatuses[userId];
                const activeGame = activeGames.find(g => (g.player1.id === userId || g.player2.id === userId));
                const timeoutDuration = (activeGame || (userStatus?.status === 'in-game' && userStatus?.gameId)) ? GAME_DISCONNECT_TIMEOUT_MS : LOBBY_TIMEOUT_MS;

                if (now - volatileState.userConnections[userId] > timeoutDuration) {
                    // User timed out. Check if they are in a single player game first.
                    const isSinglePlayerGame = activeGame && (activeGame.isSinglePlayer || activeGame.gameCategory === 'tower' || activeGame.isAiGame);
                    
                    // 싱글플레이 게임에서는 타임아웃이 발생해도 연결을 유지하고 게임을 계속 진행
                    if (isSinglePlayerGame) {
                        // 연결 시간을 갱신하여 타임아웃을 방지 (게임이 진행 중이므로)
                        volatileState.userConnections[userId] = now;
                        continue;
                    }
                    
                    // 일반 게임에서만 타임아웃 처리
                    // User timed out. They are now disconnected. Remove them from active connections.
                    delete volatileState.userConnections[userId];
                    volatileState.activeTournamentViewers.delete(userId);
            
                    if (activeGame) {
                        // User was in a game. Set the disconnection state for the single-player-disconnect logic.
                        // Their userStatus remains for now, so we know they were in this game.
                        // 도전의 탑, 싱글플레이, AI 게임에서는 접속 끊김 패널티 없음
                        const isNoPenaltyGame = activeGame.isSinglePlayer || activeGame.gameCategory === 'tower' || activeGame.isAiGame;
                        if (!activeGame.disconnectionState) {
                            if (!isNoPenaltyGame) {
                                // 일반 게임에서만 접속 끊김 카운트 및 패널티 적용
                                if (!activeGame.disconnectionCounts) activeGame.disconnectionCounts = {};
                                activeGame.disconnectionCounts[userId] = (activeGame.disconnectionCounts[userId] || 0) + 1;
                                if (activeGame.disconnectionCounts[userId] >= 3) {
                                    const winner = activeGame.blackPlayerId === userId ? types.Player.White : types.Player.Black;
                                    await endGame(activeGame, winner, 'disconnect');
                                } else {
                                    activeGame.disconnectionState = { disconnectedPlayerId: userId, timerStartedAt: now };
                                    if (activeGame.moveHistory.length < 10) {
                                        const otherPlayerId = activeGame.player1.id === userId ? activeGame.player2.id : activeGame.player1.id;
                                        if (!activeGame.canRequestNoContest) activeGame.canRequestNoContest = {};
                                        activeGame.canRequestNoContest[otherPlayerId] = true;
                                    }
                                    await db.saveGame(activeGame);
                                }
                            } else {
                                // 도전의 탑, 싱글플레이, AI 게임에서는 즉시 게임 종료 (패널티 없음)
                                const winner = activeGame.blackPlayerId === userId ? types.Player.White : types.Player.Black;
                                await endGame(activeGame, winner, 'disconnect');
                            }
                        }
                    } else if (userStatus?.status === types.UserStatus.Waiting) {
                        // User was in waiting room, just remove connection, keep status for potential reconnect.
                        // This allows them to refresh without being kicked out of the user list.
                        delete volatileState.userConnections[userId];
                    }
                }
            }
            
            // Cleanup expired negotiations
            for (const negId of Object.keys(volatileState.negotiations)) {
                 const neg = volatileState.negotiations[negId];
                 if (now > neg.deadline) {
                    const challengerId = neg.challenger.id;
                    const opponentId = neg.opponent.id;
                    const challengerStatus = volatileState.userStatuses[challengerId];
                    const opponentStatus = volatileState.userStatuses[opponentId];

                    // Challenger 상태 업데이트
                    if (challengerStatus?.status === 'negotiating') {
                        // Check if they are part of another negotiation before setting to waiting
                        const hasOtherNegotiations = Object.values(volatileState.negotiations).some(
                            otherNeg => otherNeg.id !== negId && otherNeg.challenger.id === challengerId
                        );
                        if (!hasOtherNegotiations) {
                             volatileState.userStatuses[challengerId].status = types.UserStatus.Waiting;
                        }
                    }

                    // Opponent 상태 업데이트 (상대방이 응답하지 않아서 자동 거절)
                    if (opponentStatus?.status === 'negotiating') {
                        // Check if they are part of another negotiation before setting to waiting
                        const hasOtherNegotiations = Object.values(volatileState.negotiations).some(
                            otherNeg => otherNeg.id !== negId && (otherNeg.challenger.id === opponentId || otherNeg.opponent.id === opponentId)
                        );
                        if (!hasOtherNegotiations) {
                             volatileState.userStatuses[opponentId].status = types.UserStatus.Waiting;
                        }
                    }

                     if (neg.rematchOfGameId) {
                         // 캐시에서 게임을 가져오기 (DB 조회 최소화)
                         const { getCachedGame } = await import('./gameCache.js');
                         const originalGame = await getCachedGame(neg.rematchOfGameId);
                         if (originalGame && originalGame.gameStatus === 'rematch_pending') {
                             originalGame.gameStatus = 'ended';
                             await db.saveGame(originalGame);
                         }
                     }
                     delete volatileState.negotiations[negId];
                     
                     // 만료된 negotiation 삭제 후 브로드캐스트하여 양쪽 클라이언트에 알림
                     broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
                     
                     // USER_STATUS_UPDATE도 브로드캐스트하여 상태 변경을 확실히 전달
                     broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
                 }
            }

            const onlineUserIds = Object.keys(volatileState.userConnections);
            let updatedGames = await updateGameStates(activeGames, now);

            // Check for mutual disconnection
            const disconnectedGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                // scoring 상태의 게임은 연결 끊김으로 처리하지 않음 (자동계가 진행 중)
                if (game.isAiGame || game.gameStatus === 'ended' || game.gameStatus === 'no_contest' || game.gameStatus === 'scoring' || game.disconnectionState) continue;

                const p1Online = onlineUserIds.includes(game.player1.id);
                const p2Online = onlineUserIds.includes(game.player2.id);
                
                const isSpectatorPresent = Object.keys(volatileState.userStatuses).some(spectatorId => {
                    return onlineUserIds.includes(spectatorId) &&
                           volatileState.userStatuses[spectatorId].status === types.UserStatus.Spectating &&
                           volatileState.userStatuses[spectatorId].spectatingGameId === game.id;
                });

                if (!p1Online && !p2Online && !isSpectatorPresent) {
                    console.log(`[Game ${game.id}] Both players disconnected and no spectators. Setting to no contest.`);
                    game.gameStatus = 'no_contest';
                    game.winReason = 'disconnect'; // For context, but no one is penalized
                    await db.saveGame(game);
                    clearAiSession(game.id);
                    disconnectedGamesToBroadcast[game.id] = game;
                }
            }
            
            // 연결 끊김으로 인한 게임 상태 변경 브로드캐스트 (게임 참가자에게만 전송)
            if (Object.keys(disconnectedGamesToBroadcast).length > 0) {
                const { broadcastToGameParticipants } = await import('./socket.js');
                for (const [gameId, game] of Object.entries(disconnectedGamesToBroadcast)) {
                    broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                }
            }
            
            // Save any game that has been modified by the update function and broadcast updates
            const gamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (let i = 0; i < updatedGames.length; i++) {
                const updatedGame = updatedGames[i];
                
                // PVE 게임 (싱글플레이어, 도전의 탑, AI 게임)은 클라이언트에서 실행되므로 서버 루프에서 최소 처리
                const isPVEGame = updatedGame.isSinglePlayer || updatedGame.gameCategory === 'tower' || updatedGame.gameCategory === 'singleplayer' || updatedGame.isAiGame;
                if (isPVEGame) {
                    // PVE 게임은 클라이언트에서 실행되므로 서버 루프에서 브로드캐스트하지 않음
                    // 게임 상태 변경은 클라이언트에서 처리되거나, 액션 처리 시에만 브로드캐스트됨
                    continue;
                }

                // 멀티플레이 게임만 상세 처리
                if (JSON.stringify(updatedGame) !== originalGamesJson[i]) {
                    const currentMoveCount = updatedGame.moveHistory?.length ?? 0;
                    const localRevision = updatedGame.serverRevision ?? 0;
                    const localSyncedAt = updatedGame.lastSyncedAt ?? 0;
                    // 캐시에서 게임을 가져오기 (DB 조회 최소화)
                    const { getCachedGame } = await import('./gameCache.js');
                    const latestGame = await getCachedGame(updatedGame.id);

                    if (latestGame) {
                        const latestMoveCount = latestGame.moveHistory?.length ?? 0;
                        const latestRevision = latestGame.serverRevision ?? 0;
                        const latestSyncedAt = latestGame.lastSyncedAt ?? 0;

                        let newerReason: string | null = null;
                        if (latestRevision > localRevision) {
                            newerReason = `revision ${latestRevision} > local ${localRevision}`;
                        } else if (latestRevision === localRevision && latestSyncedAt > localSyncedAt) {
                            newerReason = `sync ${latestSyncedAt} > ${localSyncedAt}`;
                        } else if (latestRevision === localRevision && latestSyncedAt === localSyncedAt && latestMoveCount > currentMoveCount) {
                            newerReason = `move history ${latestMoveCount} > ${currentMoveCount}`;
                        }

                        if (newerReason) {
                            console.warn(`[Game Loop] Detected newer game state for ${updatedGame.id} (${newerReason}). Refreshing local copy instead of saving.`);
                            syncAiSession(latestGame, aiPlayer.aiUserId);
                            // 캐시 업데이트하여 다음 루프에서 중복 감지 방지
                            const { updateGameCache } = await import('./gameCache.js');
                            updateGameCache(latestGame);
                            // 최신 상태를 브로드캐스트하지 않음 (이미 다른 곳에서 브로드캐스트되었을 가능성이 높음)
                            // 무한 루프 방지: 최신 상태를 감지한 경우에는 브로드캐스트하지 않고 로컬 상태만 업데이트
                            updatedGames[i] = latestGame;
                            // originalGamesJson도 업데이트하여 다음 루프에서 변경으로 감지되지 않도록 함
                            originalGamesJson[i] = JSON.stringify(latestGame);
                            continue;
                        }
                    }

                    // 멀티플레이 게임만 저장
                    const { updateGameCache } = await import('./gameCache.js');
                    updateGameCache(updatedGame);
                    // DB 저장은 비동기로 처리하여 응답 지연 최소화
                    db.saveGame(updatedGame).catch(err => {
                        console.error(`[Game Loop] Failed to save game ${updatedGame.id}:`, err);
                    });
                    syncAiSession(updatedGame, aiPlayer.aiUserId);
                    gamesToBroadcast[updatedGame.id] = updatedGame;
                }
            }
            
            // 실시간 게임 상태 업데이트 브로드캐스트 (게임 참가자에게만 전송)
            // 무한 루프 방지: 실제로 변경된 게임만 브로드캐스트 (JSON 비교로 실제 변경 여부 확인)
            if (Object.keys(gamesToBroadcast).length > 0) {
                const { broadcastToGameParticipants } = await import('./socket.js');
                for (const [gameId, game] of Object.entries(gamesToBroadcast)) {
                    const gameIndex = activeGames.findIndex(g => g.id === gameId);
                    if (gameIndex !== -1) {
                        // 실제로 변경된 경우에만 브로드캐스트 (무한 루프 방지)
                        const currentGameJson = JSON.stringify(game);
                        if (currentGameJson !== originalGamesJson[gameIndex]) {
                            broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                            
                            // activeGames 배열도 업데이트하여 다음 루프에서 올바른 비교가 이루어지도록 함
                            activeGames[gameIndex] = game;
                            // originalGamesJson도 업데이트하여 다음 루프에서 변경으로 감지되지 않도록 함
                            originalGamesJson[gameIndex] = currentGameJson;
                        }
                    }
                }
            }

            // Process any system messages generated by time-based events
            const systemMessageGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                if (game.pendingSystemMessages && game.pendingSystemMessages.length > 0) {
                    if (!volatileState.gameChats[game.id]) {
                        volatileState.gameChats[game.id] = [];
                    }
                    volatileState.gameChats[game.id].push(...game.pendingSystemMessages);
                    game.pendingSystemMessages = [];
                    await db.saveGame(game);
                    systemMessageGamesToBroadcast[game.id] = game;
                }
            }
            
            // 시스템 메시지로 인한 게임 상태 변경 브로드캐스트 (게임 참가자에게만 전송)
            if (Object.keys(systemMessageGamesToBroadcast).length > 0) {
                const { broadcastToGameParticipants } = await import('./socket.js');
                for (const [gameId, game] of Object.entries(systemMessageGamesToBroadcast)) {
                    broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                }
            }

            // Handle post-game summary processing for all games that finished
            const summaryGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                // 타워 게임 종료 처리
                if (game.gameCategory === 'tower' && (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') && !game.statsUpdated) {
                    // 타워 게임은 클라이언트에서 실행되지만, 서버에서 종료 처리 필요
                    const { endGame } = await import('./summaryService.js');
                    if (game.winner !== undefined && game.winner !== null) {
                        await endGame(game, game.winner as Player, game.winReason || 'score');
                    }
                    summaryGamesToBroadcast[game.id] = game;
                }
                // 일반 게임 종료 처리
                const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
                const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
                if (!game.isSinglePlayer && (isPlayful || isStrategic) && (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') && !game.statsUpdated) {
                    await processGameSummary(game);
                    game.statsUpdated = true;
                    await db.saveGame(game);
                    summaryGamesToBroadcast[game.id] = game;
                }
            }
            
            // 게임 종료 요약 처리 후 브로드캐스트 (게임 참가자에게만 전송)
            if (Object.keys(summaryGamesToBroadcast).length > 0) {
                const { broadcastToGameParticipants } = await import('./socket.js');
                for (const [gameId, game] of Object.entries(summaryGamesToBroadcast)) {
                    broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                }
            }
            
            // --- Game Room Garbage Collection for Ended Games ---
            const endedGames = await db.getAllEndedGames();

            for (const game of endedGames) {
                const isAnyoneInRoom = Object.keys(volatileState.userConnections).some(onlineUserId => {
                    const status = volatileState.userStatuses[onlineUserId];
                    return status && (status.gameId === game.id || status.spectatingGameId === game.id);
                });

                if (!isAnyoneInRoom) {
                     // Also check if a rematch negotiation is active for this game
                    const isRematchBeingNegotiated = Object.values(volatileState.negotiations).some(
                        neg => neg.rematchOfGameId === game.id
                    );

                    if (!isRematchBeingNegotiated) {
                        console.log(`[GC] Deleting empty, ended game room: ${game.id}`);
                        clearAiSession(game.id);
                        await db.deleteGame(game.id);
                    }
                }
            }

            } catch (e) {
                console.error('[FATAL] Unhandled error in main loop:', e);
            } finally {
                isProcessingMainLoop = false;
                scheduleMainLoop(1000);
            }
        }, delay);
    };

    // --- Main Game Loop ---
    scheduleMainLoop(1000);
    
    // --- API Endpoints ---
    // Health check endpoint for deployment platforms
    app.get('/api/health', (req, res) => {
        res.status(200).json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    // 랭킹 API 엔드포인트
    app.get('/api/ranking/:type', async (req, res) => {
        try {
            const { type } = req.params;
            const { limit, offset, season } = req.query;
            const limitNum = limit ? parseInt(limit as string, 10) : undefined;
            const offsetNum = offset ? parseInt(offset as string, 10) : 0;
            const isSeason = season === 'true' || season === '1';

            // 타임아웃 설정 (30초)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Ranking cache build timeout')), 30000);
            });

            const { buildRankingCache } = await import('./rankingCache.js');
            let cache: any;
            try {
                cache = await Promise.race([
                    buildRankingCache(),
                    timeoutPromise
                ]) as any;
            } catch (timeoutError: any) {
                console.error('[API/Ranking] Cache build timeout or error:', timeoutError?.message || timeoutError);
                // 타임아웃 시 빈 응답 반환 (502 에러 방지)
                return res.status(200).json({
                    type,
                    rankings: [],
                    total: 0,
                    cached: false,
                    error: 'Ranking cache build timeout'
                });
            }

            let rankings: any[] = [];
            // 시즌별 티어 랭킹 요청인 경우
            if (isSeason) {
                switch (type) {
                    case 'strategic':
                        rankings = cache.strategicSeason || [];
                        break;
                    case 'playful':
                        rankings = cache.playfulSeason || [];
                        break;
                    default:
                        // 시즌 랭킹은 strategic/playful만 지원
                        return res.status(400).json({ error: 'Season ranking only available for strategic/playful' });
                }
            } else {
                // 누적 랭킹 (기본)
                switch (type) {
                    case 'strategic':
                        rankings = cache.strategic;
                        break;
                    case 'playful':
                        rankings = cache.playful;
                        break;
                    case 'championship':
                        rankings = cache.championship;
                        break;
                    case 'combat':
                        rankings = cache.combat;
                        break;
                    case 'manner':
                        rankings = cache.manner;
                        break;
                    default:
                        return res.status(400).json({ error: 'Invalid ranking type' });
                }
            }

            // 페이지네이션 적용
            if (limitNum) {
                rankings = rankings.slice(offsetNum, offsetNum + limitNum);
            }

            const cacheKey = isSeason ? `${type}Season` : type;
            res.json({
                type,
                rankings,
                total: Array.isArray(cache[cacheKey as keyof typeof cache]) ? cache[cacheKey as keyof typeof cache].length : 0,
                cached: Date.now() - cache.timestamp < 60000 // 1분 이내면 캐시된 데이터
            });
        } catch (error: any) {
            console.error('[API/Ranking] Error:', error);
            console.error('[API/Ranking] Error stack:', error?.stack);
            // 에러 발생 시 빈 배열 반환 (502 에러 방지)
            res.status(200).json({
                type: req.params.type,
                rankings: [],
                total: 0,
                cached: false,
                error: 'Failed to fetch rankings'
            });
        }
    });

    app.post('/api/auth/register', async (req, res) => {
        try {
            console.log('[/api/auth/register] Received request body:', JSON.stringify(req.body));
            const { username, password, email } = req.body;
            
            console.log('[/api/auth/register] Parsed values:', { 
                username: username ? `${username.substring(0, 3)}...` : 'null',
                password: password ? '***' : 'null',
                email: email || 'null'
            });
            
            // 필수 필드 검증 (trim 포함)
            if (!username || typeof username !== 'string' || !username.trim()) {
                console.log('[/api/auth/register] Validation failed: username');
                return res.status(400).json({ message: '아이디를 입력해주세요.' });
            }
            if (!password || typeof password !== 'string' || !password.trim()) {
                console.log('[/api/auth/register] Validation failed: password');
                return res.status(400).json({ message: '비밀번호를 입력해주세요.' });
            }
            if (!email || typeof email !== 'string' || !email.trim()) {
                console.log('[/api/auth/register] Validation failed: email');
                return res.status(400).json({ message: '이메일을 입력해주세요.' });
            }
            
            const trimmedUsername = username.trim();
            const trimmedPassword = password.trim();
            const trimmedEmail = email.trim();
            
            if (trimmedUsername.length < 2 || trimmedPassword.length < 4) {
                return res.status(400).json({ message: '아이디는 2자 이상, 비밀번호는 4자 이상이어야 합니다.' });
            }
            if (containsProfanity(trimmedUsername)) {
                return res.status(400).json({ message: '아이디에 부적절한 단어가 포함되어 있습니다.' });
            }
            
            // 이메일 형식 검증
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(trimmedEmail)) {
                return res.status(400).json({ message: '올바른 이메일 형식이 아닙니다.' });
            }
    
            const existingByUsername = await db.getUserCredentials(trimmedUsername);
            if (existingByUsername) {
                return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
            }
    
            // 회원탈퇴한 이메일인지 확인 (1주일 제한)
            const kvRepository = await import('./repositories/kvRepository.js');
            const withdrawnEmails = await kvRepository.getKV<Record<string, number>>('withdrawnEmails') || {};
            const withdrawnEmailExpiry = withdrawnEmails[trimmedEmail.toLowerCase()];
            if (withdrawnEmailExpiry && withdrawnEmailExpiry > Date.now()) {
                const daysLeft = Math.ceil((withdrawnEmailExpiry - Date.now()) / (24 * 60 * 60 * 1000));
                return res.status(403).json({ 
                    message: `회원탈퇴한 이메일은 ${daysLeft}일 후에 다시 가입할 수 있습니다.` 
                });
            }
            
            // 만료된 제한 삭제
            if (withdrawnEmailExpiry && withdrawnEmailExpiry <= Date.now()) {
                delete withdrawnEmails[trimmedEmail.toLowerCase()];
                await kvRepository.setKV('withdrawnEmails', withdrawnEmails);
            }
            
            // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드
            const { listUsers } = await import('./prisma/userService.js');
            const allUsers = await listUsers({ includeEquipment: false, includeInventory: false });
            
            // 이메일 중복 확인 (User 타입에 email 속성이 없으므로 주석 처리)
            // const existingUserByEmail = allUsers.find(u => (u as any).email?.toLowerCase() === trimmedEmail.toLowerCase());
            // if (existingUserByEmail) {
            //     return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
            // }
    
            // 임시 닉네임 생성 (나중에 변경 가능)
            const tempNickname = `user_${randomUUID().slice(0, 8)}`;
            let newUser = createDefaultUser(`user-${randomUUID()}`, trimmedUsername, tempNickname, false);
            // newUser.email = trimmedEmail; // User 타입에 email 속성이 없으므로 주석 처리

            newUser = await resetAndGenerateQuests(newUser);
    
            await db.createUser(newUser);
            
            // 비밀번호 해싱
            const passwordHash = await hashPassword(trimmedPassword);
            await db.createUserCredentials(trimmedUsername, passwordHash, newUser.id);
    
            // 이메일 인증 코드 전송
            try {
                const { token, code } = await sendEmailVerification(newUser.id, trimmedEmail);
                res.status(201).json({ 
                    user: newUser,
                    requiresEmailVerification: true,
                    verificationToken: token,
                    verificationCode: process.env.NODE_ENV === 'development' ? code : undefined, // 개발 환경에서만 코드 전송
                    message: process.env.NODE_ENV === 'development' 
                        ? `회원가입이 완료되었습니다. 서버 콘솔에서 인증 코드를 확인하세요: ${code}`
                        : '회원가입이 완료되었습니다. 이메일 인증을 완료해주세요.'
                });
            } catch (emailError: any) {
                console.error('[Register] Failed to send verification email:', emailError);
                // 이메일 전송 실패해도 회원가입은 성공 (나중에 재전송 가능)
                // 개발 환경에서는 인증 코드를 직접 조회해서 전송
                if (process.env.NODE_ENV === 'development') {
                    try {
                        const token = await db.getEmailVerificationTokenByUserId(newUser.id);
                        if (token) {
                            res.status(201).json({ 
                                user: newUser,
                                requiresEmailVerification: true,
                                verificationToken: token.token,
                                verificationCode: token.code,
                                message: `회원가입이 완료되었습니다. 인증 코드: ${token.code} (서버 콘솔에서도 확인 가능)`
                            });
                            return;
                        }
                    } catch (e) {
                        console.error('[Register] Failed to get verification code:', e);
                    }
                }
                res.status(201).json({ 
                    user: newUser,
                    requiresEmailVerification: true,
                    message: '회원가입이 완료되었습니다. 이메일 인증을 완료해주세요.'
                });
            }
        } catch (e: any) {
            console.error('Registration error:', e);
            res.status(500).json({ message: '서버 등록 중 오류가 발생했습니다.' });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        console.log('[/api/auth/login] Received request');
        let responseSent = false;
        const sendResponse = (status: number, data: any) => {
            if (!responseSent) {
                try {
                    responseSent = true;
                    res.status(status).json(data);
                } catch (err) {
                    console.error('[/api/auth/login] Failed to send response:', err);
                    if (!res.headersSent) {
                        try {
                            res.status(status).end(JSON.stringify(data));
                        } catch (e2) {
                            console.error('[/api/auth/login] Failed to send fallback response:', e2);
                        }
                    }
                }
            }
        };
        
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                sendResponse(400, { message: '아이디와 비밀번호를 모두 입력해주세요.' });
                return;
            }
            
            console.log('[/api/auth/login] Attempting to get user credentials for:', username);
            let credentials = await db.getUserCredentials(username);
            if (credentials) {
                console.log('[/api/auth/login] Credentials found for username:', username);
            } else {
                console.log('[/api/auth/login] No credentials found for username. Attempting to get user by nickname:', username);
                const userByNickname = await db.getUserByNickname(username);
                if (userByNickname) {
                    console.log('[/api/auth/login] User found by nickname. Getting credentials by userId:', userByNickname.id);
                    credentials = await db.getUserCredentialsByUserId(userByNickname.id);
                    if (credentials) {
                        console.log('[/api/auth/login] Credentials found by userId for nickname:', username);
                    } else {
                        console.log('[/api/auth/login] No credentials found by userId for nickname:', username);
                    }
                } else {
                    console.log('[/api/auth/login] No user found by nickname:', username);
                }
            }

            if (!credentials || !credentials.passwordHash) {
                console.log('[/api/auth/login] No credentials found for username:', username);
                sendResponse(401, { message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
                return;
            }
            
            // 비밀번호 검증
            // 기존 사용자의 경우 평문 비밀번호나 pbkdf2 해시일 수 있음
            let isValidPassword = false;
            
            console.log('[/api/auth/login] Password hash length:', credentials.passwordHash?.length);
            console.log('[/api/auth/login] Password hash starts with:', credentials.passwordHash?.substring(0, 10));
            
            if (credentials.passwordHash) {
                // bcrypt 해시인지 확인
                if (credentials.passwordHash.startsWith('$2a$') || 
                    credentials.passwordHash.startsWith('$2b$') || 
                    credentials.passwordHash.startsWith('$2y$')) {
                    // bcrypt 해시
                    console.log('[/api/auth/login] Detected bcrypt hash');
                    isValidPassword = await verifyPassword(password, credentials.passwordHash);
                } else if (credentials.passwordHash.length < 20) {
                    // 평문 비밀번호로 저장된 경우 (마이그레이션 필요)
                    console.log('[/api/auth/login] Detected plain text password, comparing directly');
                    if (password === credentials.passwordHash) {
                        console.log('[/api/auth/login] Plain text password match, migrating to bcrypt');
                        // 비밀번호를 bcrypt로 재해시하여 저장
                        const { hashPassword } = await import('./utils/passwordUtils.js');
                        const newHash = await hashPassword(password);
                        await db.updateUserCredentialPassword(credentials.userId, { passwordHash: newHash });
                        isValidPassword = true;
                    } else {
                        console.log('[/api/auth/login] Plain text password mismatch');
                        isValidPassword = false;
                    }
                } else {
                    // pbkdf2 해시일 가능성 (기존 사용자)
                    console.log('[/api/auth/login] Detected non-bcrypt hash, assuming legacy pbkdf2');
                    // 기존 관리자 비밀번호는 '1217'이었음
                    // pbkdf2 해시는 128자 hex 문자열
                    if (credentials.passwordHash.length === 128 && /^[0-9a-f]+$/i.test(credentials.passwordHash)) {
                        // 기존 사용자의 경우, 비밀번호 '1217'로 직접 시도
                        if (password === '1217') {
                            console.log('[/api/auth/login] Legacy password match for username:', username);
                            // 비밀번호를 bcrypt로 재해시하여 저장
                            const { hashPassword } = await import('./utils/passwordUtils.js');
                            const newHash = await hashPassword(password);
                            await db.updateUserCredentialPassword(credentials.userId, { passwordHash: newHash });
                            isValidPassword = true;
                        } else {
                            console.log('[/api/auth/login] Legacy password mismatch');
                            isValidPassword = false;
                        }
                    } else {
                        // 다른 형식의 해시인 경우
                        isValidPassword = await verifyPassword(password, credentials.passwordHash);
                    }
                }
            }
            
            if (!isValidPassword) {
                console.log('[/api/auth/login] Authentication failed for username:', username);
                sendResponse(401, { message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
                return;
            }
            console.log('[/api/auth/login] Authentication successful for username:', username, '. Getting user details.');
            let user = await db.getUser(credentials.userId);
            if (!user) {
                console.log('[/api/auth/login] User not found for userId:', credentials.userId);
                sendResponse(404, { message: '사용자를 찾을 수 없습니다.' });
                return;
            }
            console.log('[/api/auth/login] User details retrieved for userId:', credentials.userId);

            if (!user) {
                console.error('[/api/auth/login] User not found after creation');
                res.status(500).json({ error: 'User creation failed' });
                return;
            }

            const defaultBaseStats = createDefaultBaseStats();
            if (!user.baseStats) {
                user.baseStats = defaultBaseStats;
                await db.updateUser(user);
            } else {
                // Check if baseStats needs to be reset
                const coreStats = Object.values(types.CoreStat || {});
                if (coreStats.length > 0 && user && (
                    Object.keys(user.baseStats).length !== Object.keys(defaultBaseStats).length ||
                    !coreStats.every(stat => user && (user.baseStats as Record<types.CoreStat, number>)[stat] === 100)
                )) {
                    user.baseStats = defaultBaseStats;
                    await db.updateUser(user);
                }
            }
            
            const userBeforeUpdate = JSON.stringify(user);

            if (!user.ownedBorders?.includes('simple_black')) {
                if (!user.ownedBorders) user.ownedBorders = ['default'];
                user.ownedBorders.push('simple_black');
            }

            const hadInventoryBefore = Array.isArray(user.inventory) && user.inventory.length > 0;
            const hadEquipmentBefore = user.equipment && Object.keys(user.equipment).length > 0;

            let updatedUser = await resetAndGenerateQuests(user);
            updatedUser = await processWeeklyLeagueUpdates(updatedUser);
            updatedUser = await regenerateActionPoints(updatedUser);

            const hasInventoryNow = Array.isArray(updatedUser.inventory) && updatedUser.inventory.length > 0;
            const hasEquipmentNow = updatedUser.equipment && Object.keys(updatedUser.equipment).length > 0;

            if (hadInventoryBefore && !hasInventoryNow) {
                console.error(`[/api/auth/login] CRITICAL: Inventory vanished during login pipeline for user ${user.id}. Restoring previous inventory snapshot.`);
                updatedUser.inventory = JSON.parse(JSON.stringify(user.inventory));
            }
            if (hadEquipmentBefore && !hasEquipmentNow) {
                console.error(`[/api/auth/login] CRITICAL: Equipment vanished during login pipeline for user ${user.id}. Restoring previous equipment snapshot.`);
                updatedUser.equipment = JSON.parse(JSON.stringify(user.equipment));
            }

            const userLevelSum = updatedUser.strategyLevel + updatedUser.playfulLevel;
            let itemsUnequipped = false;
            const validEquipped: types.Equipment = {};
            
            // equipment와 inventory가 모두 존재하는지 확인
            // 관리자 계정의 경우 장비 데이터 손실을 방지하기 위해 특별 처리
            if (updatedUser.equipment && typeof updatedUser.equipment === 'object' && Object.keys(updatedUser.equipment).length > 0) {
                if (!updatedUser.inventory || !Array.isArray(updatedUser.inventory) || updatedUser.inventory.length === 0) {
                    // 관리자 계정은 절대 장비를 삭제하지 않음 (데이터 손실 방지)
                    if (updatedUser.isAdmin) {
                        console.error(`[/api/auth/login] CRITICAL: Admin user ${updatedUser.id} has equipment but empty inventory! Preserving equipment. DO NOT DELETE.`);
                        console.error(`[/api/auth/login] Admin equipment:`, JSON.stringify(updatedUser.equipment));
                        // 관리자 계정의 경우 장비를 절대 삭제하지 않음
                        // equipment는 그대로 유지하고 경고만 출력
                        // itemsUnequipped는 false로 유지하여 equipment가 유지되도록 함
                    } else {
                        console.warn(`[/api/auth/login] User ${updatedUser.id} has equipment but empty inventory! This may indicate data loss. Preserving equipment for recovery.`);
                        // 일반 사용자도 장비를 보존 (데이터 손실 방지)
                        // equipment는 유지하고 나중에 복원 가능하도록 함
                        // itemsUnequipped는 false로 유지
                    }
                    // 장비를 삭제하지 않고 유지 (데이터 손실 방지)
                    // itemsUnequipped는 true로 설정하지 않음
                } else {
                    for(const slot in updatedUser.equipment) {
                        const itemId = updatedUser.equipment[slot as types.EquipmentSlot];
                        const item = updatedUser.inventory.find(i => i.id === itemId);
                        if (item) {
                            const requiredLevel = GRADE_LEVEL_REQUIREMENTS[item.grade];
                            if (userLevelSum >= requiredLevel) {
                                validEquipped[slot as types.EquipmentSlot] = itemId;
                            } else {
                                const invItem = updatedUser.inventory.find(i => i.id === itemId);
                                if(invItem) invItem.isEquipped = false;
                                itemsUnequipped = true;
                            }
                        } else {
                            // inventory에 아이템이 없지만, equipment는 유지 (데이터 손실 방지)
                            // 로그인 시에는 제거하지 않고 유지하여 나중에 복원 가능하도록 함
                            console.warn(`[/api/auth/login] User ${updatedUser.id} has equipment ${itemId} in slot ${slot} but item not found in inventory. Keeping equipment for data preservation.`);
                            validEquipped[slot as types.EquipmentSlot] = itemId;
                            // 데이터 손실을 방지하기 위해 equipment는 유지
                        }
                    }
                    if (itemsUnequipped && Object.keys(validEquipped).length < Object.keys(updatedUser.equipment).length) {
                        updatedUser.equipment = validEquipped;
                    }
                }
            }

            const allGameModesList = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES].map(m => m.mode);
            let statsMigrated = false;
            if (!updatedUser.stats) {
                updatedUser.stats = {};
            }
            for (const mode of allGameModesList) {
                if (!updatedUser.stats[mode]) {
                    updatedUser.stats[mode] = { wins: 0, losses: 0, rankingScore: 1200 };
                    statsMigrated = true;
                }
            }

            // --- Equipment Presets Migration Logic ---
            let presetsMigrated = false;
            if (!updatedUser.equipmentPresets || updatedUser.equipmentPresets.length === 0) { // Check for empty array too
                updatedUser.equipmentPresets = [
                    { name: '프리셋 1', equipment: updatedUser.equipment || {} }, // Initialize with current equipment
                    { name: '프리셋 2', equipment: {} },
                    { name: '프리셋 3', equipment: {} },
                    { name: '프리셋 4', equipment: {} },
                    { name: '프리셋 5', equipment: {} },
                ];
                presetsMigrated = true;
            }
            // --- End Equipment Presets Migration Logic ---

            // equipment와 inventory의 isEquipped 플래그 동기화 (전투력 계산을 위해 필수)
            if (updatedUser.equipment && typeof updatedUser.equipment === 'object' && Object.keys(updatedUser.equipment).length > 0) {
                if (updatedUser.inventory && Array.isArray(updatedUser.inventory)) {
                    // 먼저 모든 장비 아이템의 isEquipped를 false로 설정
                    updatedUser.inventory.forEach(item => {
                        if (item.type === 'equipment') {
                            item.isEquipped = false;
                        }
                    });
                    
                    // equipment에 있는 아이템 ID들을 inventory에서 찾아서 isEquipped = true로 설정
                    for (const [slot, itemId] of Object.entries(updatedUser.equipment)) {
                        const item = updatedUser.inventory.find(i => i.id === itemId);
                        if (item && item.type === 'equipment') {
                            item.isEquipped = true;
                        }
                    }
                }
            }

            if (userBeforeUpdate !== JSON.stringify(updatedUser) || statsMigrated || itemsUnequipped || presetsMigrated) {
                await db.updateUser(updatedUser);
                user = updatedUser;
            }

            if (volatileState.userConnections[user.id]) {
                console.log(`[Auth] Concurrent login for ${user.nickname}. Terminating old session and establishing new one.`);
            }
            
            const allActiveGames = await db.getAllActiveGames();
            const activeGame = allActiveGames.find(g => 
                (g.player1.id === user!.id || g.player2.id === user!.id)
            );
    
            if (activeGame) {
                // 90초 내에 재접속한 경우 경기 재개
                if (activeGame.disconnectionState?.disconnectedPlayerId === user!.id) {
                    // 90초 내에 재접속했는지 확인
                    const now = Date.now();
                    const timeSinceDisconnect = now - activeGame.disconnectionState.timerStartedAt;
                    if (timeSinceDisconnect <= 90000) {
                        // 재접속 성공: disconnectionState 제거하고 경기 재개
                        activeGame.disconnectionState = null;
                        const otherPlayerId = activeGame.player1.id === user!.id ? activeGame.player2.id : activeGame.player1.id;
                        if (activeGame.canRequestNoContest?.[otherPlayerId]) {
                            delete activeGame.canRequestNoContest[otherPlayerId];
                        }
                        await db.saveGame(activeGame);
                        
                        // 게임 업데이트 브로드캐스트
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        broadcastToGameParticipants(activeGame.id, { type: 'GAME_UPDATE', payload: { [activeGame.id]: activeGame } }, activeGame);
                    }
                }
                // 재접속한 유저를 게임 상태로 설정 (자동으로 게임으로 리다이렉트)
                volatileState.userStatuses[user!.id] = { status: types.UserStatus.InGame, mode: activeGame.mode, gameId: activeGame.id };
            } else {
                volatileState.userStatuses[user!.id] = { status: types.UserStatus.Online };
            }
            
            const sanitizedUser = JSON.parse(JSON.stringify(user));
            sendResponse(200, { user: sanitizedUser });
        } catch (e: any) {
            console.error('[/api/auth/login] Login error:', e);
            console.error('[/api/auth/login] Error stack:', e?.stack);
            console.error('[/api/auth/login] Error message:', e?.message);
            if (!responseSent) {
                try {
                    sendResponse(500, { message: '서버 로그인 처리 중 오류가 발생했습니다.', error: process.env.NODE_ENV === 'development' ? e?.message : undefined });
                } catch (sendError: any) {
                    console.error('[/api/auth/login] Failed to send error response:', sendError);
                    if (!res.headersSent) {
                        try {
                            res.status(500).json({ message: '서버 로그인 처리 중 오류가 발생했습니다.' });
                        } catch (finalError: any) {
                            console.error('[/api/auth/login] Failed to send final error response:', finalError);
                            if (!res.headersSent) {
                                res.status(500).end();
                            }
                        }
                    }
                }
            }
        }
    });

    // 카카오 로그인 URL 생성
    app.get('/api/auth/kakao/url', (req, res) => {
        try {
            const url = getKakaoAuthUrl();
            res.json({ url });
        } catch (e: any) {
            console.error('[/api/auth/kakao/url] Error:', e);
            res.status(500).json({ message: '카카오 로그인 URL 생성에 실패했습니다.' });
        }
    });

    // 카카오 로그인 콜백 처리
    app.post('/api/auth/kakao/callback', async (req, res) => {
        try {
            const { code } = req.body;
            if (!code) {
                return res.status(400).json({ message: '인증 코드가 필요합니다.' });
            }

            // 카카오 액세스 토큰 받기
            const accessToken = await getKakaoAccessToken(code);
            
            // 카카오 사용자 정보 가져오기
            const kakaoUserInfo = await getKakaoUserInfo(accessToken);
            
            // 기존 사용자 확인 (카카오 ID로)
            let credentials = await db.getUserCredentialsByKakaoId(kakaoUserInfo.id);
            let user: types.User | null = null;

            if (credentials) {
                // 기존 사용자 로그인
                user = await db.getUser(credentials.userId);
                if (!user) {
                    return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
                }
            } else {
                // 신규 사용자 회원가입
                // 임시 닉네임 생성 (나중에 변경 가능)
                const tempNickname = `user_${randomUUID().slice(0, 8)}`;
                const username = `kakao_${kakaoUserInfo.id}`;

                user = createDefaultUser(`user-${randomUUID()}`, username, tempNickname, false);
                // if (kakaoUserInfo.email) {
                //     (user as any).email = kakaoUserInfo.email; // User 타입에 email 속성이 없으므로 주석 처리
                // }

                user = await resetAndGenerateQuests(user);
                await db.createUser(user);
                
                // 카카오 ID로 인증 정보 생성 (비밀번호 없음)
                await db.createUserCredentials(username, null, user.id, kakaoUserInfo.id);
                
                // 카카오 이메일이 있으면 자동 인증 처리
                if (kakaoUserInfo.email) {
                    await db.verifyUserEmail(user.id);
                }
            }

            // 로그인 처리
            volatileState.userConnections[user.id] = Date.now();
            volatileState.userStatuses[user.id] = { status: types.UserStatus.Online };

            res.json({ user });
        } catch (e: any) {
            console.error('[/api/auth/kakao/callback] Error:', e);
            res.status(500).json({ message: '카카오 로그인 처리 중 오류가 발생했습니다.', error: process.env.NODE_ENV === 'development' ? e?.message : undefined });
        }
    });

    // 이메일 인증 코드 전송
    app.post('/api/auth/email/send-verification', async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ message: '이메일을 입력해주세요.' });
            }

            // 사용자 확인 (DB 쿼리로 최적화)
            const user = await db.getUserByEmail(email.toLowerCase());
            if (!user) {
                return res.status(404).json({ message: '해당 이메일로 가입된 사용자를 찾을 수 없습니다.' });
            }

            // 인증 코드 전송
            const { token } = await sendEmailVerification(user.id, email);
            res.json({ message: '인증 코드가 이메일로 전송되었습니다.', token });
        } catch (e: any) {
            console.error('[/api/auth/email/send-verification] Error:', e);
            res.status(500).json({ message: '인증 코드 전송에 실패했습니다.', error: process.env.NODE_ENV === 'development' ? e?.message : undefined });
        }
    });

    // 이메일 인증 코드 검증
    app.post('/api/auth/email/verify', async (req, res) => {
        try {
            const { userId, code } = req.body;
            if (!userId || !code) {
                return res.status(400).json({ message: '사용자 ID와 인증 코드를 입력해주세요.' });
            }

            const isValid = await verifyEmailCode(userId, code);
            if (!isValid) {
                return res.status(400).json({ message: '인증 코드가 올바르지 않거나 만료되었습니다.' });
            }

            res.json({ message: '이메일 인증이 완료되었습니다.' });
        } catch (e: any) {
            console.error('[/api/auth/email/verify] Error:', e);
            res.status(500).json({ message: '이메일 인증 처리 중 오류가 발생했습니다.', error: process.env.NODE_ENV === 'development' ? e?.message : undefined });
        }
    });

    // 닉네임 설정
    app.post('/api/auth/set-nickname', async (req, res) => {
        try {
            const { nickname, userId } = req.body;
            
            if (!nickname) {
                return res.status(400).json({ message: '닉네임을 입력해주세요.' });
            }
            
            if (!userId) {
                return res.status(401).json({ message: '로그인이 필요합니다.' });
            }
            
            if (nickname.trim().length < NICKNAME_MIN_LENGTH || nickname.trim().length > NICKNAME_MAX_LENGTH) {
                return res.status(400).json({ message: `닉네임은 ${NICKNAME_MIN_LENGTH}자 이상 ${NICKNAME_MAX_LENGTH}자 이하여야 합니다.` });
            }
            
            if (containsProfanity(nickname)) {
                return res.status(400).json({ message: '닉네임에 부적절한 단어가 포함되어 있습니다.' });
            }
            
            const user = await db.getUser(userId);
            if (!user) {
                return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
            }
            
            // 닉네임 중복 확인 (DB 쿼리로 최적화)
            const existingUser = await db.getUserByNickname(nickname.trim());
            if (existingUser && existingUser.id !== userId) {
                return res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });
            }
            
            // 닉네임 업데이트
            user.nickname = nickname.trim();
            await db.updateUser(user);
            
            res.json({ user });
        } catch (e: any) {
            console.error('[/api/auth/set-nickname] Error:', e);
            res.status(500).json({ message: '닉네임 설정 중 오류가 발생했습니다.', error: process.env.NODE_ENV === 'development' ? e?.message : undefined });
        }
    });

    // 유저 프로필 정보 가져오기 (공개 정보만)
    app.get('/api/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            if (!userId) {
                return res.status(400).json({ error: 'User ID is required' });
            }
            
            // 공개 정보만 반환 (equipment/inventory 제외하여 빠르게)
            const user = await db.getUser(userId, { includeEquipment: false, includeInventory: false });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // 공개 정보만 반환
            const publicUser = {
                id: user.id,
                username: user.username,
                nickname: user.nickname,
                avatarId: user.avatarId,
                borderId: user.borderId,
                strategyLevel: user.strategyLevel,
                strategyXp: user.strategyXp,
                playfulLevel: user.playfulLevel,
                playfulXp: user.playfulXp,
                gold: user.gold,
                diamonds: user.diamonds,
                stats: user.stats,
                mannerScore: user.mannerScore,
                tournamentScore: user.tournamentScore,
                cumulativeTournamentScore: user.cumulativeTournamentScore,
                league: user.league,
                mbti: user.mbti,
                isMbtiPublic: user.isMbtiPublic,
                cumulativeRankingScore: user.cumulativeRankingScore,
                dailyRankings: user.dailyRankings,
                towerFloor: (user as any).towerFloor,
                monthlyTowerFloor: (user as any).monthlyTowerFloor,
                isAdmin: user.isAdmin,
            };
            
            res.json(publicUser);
        } catch (error: any) {
            console.error('[/api/user/:userId] Error:', error);
            res.status(500).json({ error: 'Failed to fetch user data' });
        }
    });

    app.post('/api/state', async (req, res) => {
        // 프로덕션에서 성능 향상을 위해 로깅 최소화
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev) console.log('[/api/state] Received request');
        try {
            const { userId } = req.body;
            if (isDev) console.log(`[API/State] Received request for userId: ${userId}`);

            if (!userId) {
                if (isDev) console.log('[API/State] No userId provided, returning 401.');
                return res.status(401).json({ message: '인증 정보가 없습니다.' });
            }

            if (isDev) console.log('[/api/state] Getting user from cache/DB');
            // 캐시를 우선 사용하여 DB 쿼리 최소화 (Railway 네트워크 지연 대응)
            const { getCachedUser } = await import('./gameCache.js');
            let user = await getCachedUser(userId);
            if (isDev) console.log('[/api/state] User retrieved from cache/DB');
            if (!user) {
                if (isDev) console.log(`[API/State] User ${userId} not found, cleaning up connection and returning 401.`);
                delete volatileState.userConnections[userId]; // Clean up just in case
                return res.status(401).json({ message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
            }
            if (isDev) console.log(`[API/State] User ${user.nickname} found.`);

            if (isDev) console.log('[/api/state] Starting migration logic');
            // --- Inventory Slots Migration Logic ---
            let inventorySlotsUpdated = false;
            if (!user.inventorySlotsMigrated) {
                if (isDev) console.log(`[API/State] User ${user.nickname}: Running inventory slots migration.`);
                let currentEquipmentSlots = 30;
                let currentConsumableSlots = 30;
                let currentMaterialSlots = 30;

                if (typeof user.inventorySlots === 'number') {
                    // Old format: number of slots for equipment
                    currentEquipmentSlots = Math.max(30, user.inventorySlots);
                } else if (typeof user.inventorySlots === 'object' && user.inventorySlots !== null) {
                    // New format, but might be partially initialized or have values less than 30
                    currentEquipmentSlots = Math.max(30, user.inventorySlots.equipment || 0);
                    currentConsumableSlots = Math.max(30, user.inventorySlots.consumable || 0);
                    currentMaterialSlots = Math.max(30, user.inventorySlots.material || 0);
                }

                // Apply updates if any slot count is less than 30 or if it was in the old number format
                if (typeof user.inventorySlots === 'number' ||
                    (typeof user.inventorySlots === 'object' && user.inventorySlots !== null &&
                        (user.inventorySlots.equipment < 30 ||
                        user.inventorySlots.consumable < 30 ||
                        user.inventorySlots.material < 30))) {

                    user.inventorySlots = {
                        equipment: currentEquipmentSlots,
                        consumable: currentConsumableSlots,
                        material: currentMaterialSlots,
                    };
                    inventorySlotsUpdated = true;
                }
                
                if (inventorySlotsUpdated) {
                    user.inventorySlotsMigrated = true;
                }
            }
            if (isDev) console.log('[/api/state] Finished migration logic');

            // Re-establish connection if user is valid but not in volatile memory (e.g., after server restart)
            if (!volatileState.userConnections[userId]) {
                if (isDev) console.log(`[API/State] User ${user.nickname}: Re-establishing connection.`);
                volatileState.userConnections[userId] = Date.now();
                // If user status is not present (e.g., server restart), set to online.
                // If it IS present (e.g., they just refreshed), do NOT change it, preserving their 'waiting' status.
                if (!volatileState.userStatuses[userId]) {
                    volatileState.userStatuses[userId] = { status: types.UserStatus.Online };
                }
            }

            volatileState.userConnections[userId] = Date.now();
            
            const userBeforeUpdate = JSON.stringify(user);
            if (isDev) console.log(`[API/State] User ${user.nickname}: Processing quests, league updates, AP regen, and weekly competitors.`);
            let updatedUser = await resetAndGenerateQuests(user);
            updatedUser = await processWeeklyLeagueUpdates(updatedUser);
            updatedUser = await regenerateActionPoints(updatedUser);
            // updateWeeklyCompetitorsIfNeeded는 내부에서 필요한 유저만 DB에서 조회하도록 최적화됨
            updatedUser = await updateWeeklyCompetitorsIfNeeded(updatedUser);
            
            // --- Stats Migration Logic ---
            const allGameModesList = [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES].map(m => m.mode);
            let statsMigrated = false;
            if (!updatedUser.stats) {
                updatedUser.stats = {};
            }
            for (const mode of allGameModesList) {
                if (!updatedUser.stats[mode]) {
                    updatedUser.stats[mode] = { wins: 0, losses: 0, rankingScore: 1200 };
                    statsMigrated = true;
                }
            }
            if (isDev) console.log(`[API/State] User ${user.nickname}: Stats migration complete (migrated: ${statsMigrated}).`);
            // --- End Migration Logic ---

            // --- Equipment Presets Migration Logic ---
            let presetsMigrated = false;
            if (!updatedUser.equipmentPresets || updatedUser.equipmentPresets.length === 0) { // Check for empty array too
                updatedUser.equipmentPresets = [
                    { name: '프리셋 1', equipment: updatedUser.equipment || {} }, // Initialize with current equipment
                    { name: '프리셋 2', equipment: {} },
                    { name: '프리셋 3', equipment: {} },
                    { name: '프리셋 4', equipment: {} },
                    { name: '프리셋 5', equipment: {} },
                ];
                presetsMigrated = true;
            }
            // --- End Equipment Presets Migration Logic ---

            // equipment와 inventory의 isEquipped 플래그 동기화 (전투력 계산을 위해 필수)
            if (updatedUser.equipment && typeof updatedUser.equipment === 'object' && Object.keys(updatedUser.equipment).length > 0) {
                if (updatedUser.inventory && Array.isArray(updatedUser.inventory)) {
                    // 먼저 모든 장비 아이템의 isEquipped를 false로 설정
                    updatedUser.inventory.forEach(item => {
                        if (item.type === 'equipment') {
                            item.isEquipped = false;
                        }
                    });
                    
                    // equipment에 있는 아이템 ID들을 inventory에서 찾아서 isEquipped = true로 설정
                    for (const [slot, itemId] of Object.entries(updatedUser.equipment)) {
                        const item = updatedUser.inventory.find(i => i.id === itemId);
                        if (item && item.type === 'equipment') {
                            item.isEquipped = true;
                        }
                    }
                }
            }

            if (userBeforeUpdate !== JSON.stringify(updatedUser) || statsMigrated || inventorySlotsUpdated || presetsMigrated) {
                if (isDev) console.log(`[API/State] User ${user.nickname}: Updating user in DB.`);
                await db.updateUser(updatedUser);
                user = updatedUser; // updatedUser를 반환하기 위해 user에 할당
            }
            
            if (isDev) console.log('[/api/state] Getting all DB data');
            if (isDev) console.log(`[API/State] User ${user.nickname}: Getting all DB data.`);
            const dbState = await db.getAllData();
            if (isDev) console.log('[/api/state] All DB data retrieved');
    
            // Add ended games that users are still in to the appropriate category
            if (isDev) console.log(`[API/State] User ${user.nickname}: Processing ended games.`);
            for (const status of Object.values(volatileState.userStatuses)) {
                let gameId: string | undefined;
                if ('gameId' in status && status.gameId) {
                    gameId = status.gameId;
                } else if ('spectatingGameId' in status && status.spectatingGameId) {
                    gameId = status.spectatingGameId;
                }
                if (gameId) {
                    // 모든 카테고리에서 확인
                    const isInLiveGames = dbState.liveGames[gameId];
                    const isInSinglePlayerGames = dbState.singlePlayerGames[gameId];
                    const isInTowerGames = dbState.towerGames[gameId];
                    
                    if (!isInLiveGames && !isInSinglePlayerGames && !isInTowerGames) {
                        // 캐시에서 게임을 가져오기 (DB 조회 최소화)
                        const { getCachedGame } = await import('./gameCache.js');
                        const endedGame = await getCachedGame(gameId);
                        if (endedGame) {
                            // 게임 카테고리에 따라 올바른 객체에 추가
                            const category = endedGame.gameCategory || (endedGame.isSinglePlayer ? 'singleplayer' : 'normal');
                            if (category === 'singleplayer') {
                                dbState.singlePlayerGames[endedGame.id] = endedGame;
                            } else if (category === 'tower') {
                                dbState.towerGames[endedGame.id] = endedGame;
                            } else {
                                dbState.liveGames[endedGame.id] = endedGame;
                            }
                        }
                    }
                }
            }
            
            // 현재 사용자의 전체 데이터를 포함 (다른 사용자는 최적화된 공개 정보만)
            if (dbState.users[userId]) {
                dbState.users[userId] = updatedUser; // 전체 사용자 데이터
            }

            // Combine persisted state with in-memory volatile state
            if (isDev) console.log(`[API/State] User ${user.nickname}: Combining states and sending response.`);
            const fullState: Omit<types.AppState, 'userCredentials'> = {
                ...dbState,
                userConnections: volatileState.userConnections,
                userStatuses: volatileState.userStatuses,
                negotiations: volatileState.negotiations,
                waitingRoomChats: volatileState.waitingRoomChats,
                gameChats: volatileState.gameChats,
                userLastChatMessage: volatileState.userLastChatMessage,
            };
            
            res.status(200).json(fullState);
        } catch (e) {
            console.error('Get state error:', e);
            res.status(500).json({ message: '서버 오류가 발생했습니다.' });
        }
    });

    // KataGo 분석 API 엔드포인트 (배포 환경에서 HTTP API로 사용)
    app.post('/api/katago/analyze', async (req, res) => {
        try {
            const query = req.body;
            if (!query || !query.id) {
                return res.status(400).json({ error: 'Invalid query: missing id' });
            }

            // 로컬 KataGo 프로세스를 사용하여 분석 수행
            // 이 엔드포인트는 로컬 프로세스를 사용하므로 HTTP API 모드 체크 불필요
            const { getKataGoManager } = await import('./kataGoService.js');
            const manager = getKataGoManager();
            // HTTP API 모드가 아닐 때만 query 메서드 사용 (HTTP API 모드면 에러 반환)
            const response = await manager.query(query);
            
            res.json(response);
        } catch (error: any) {
            console.error('[KataGo API] Error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    });

    app.post('/api/action', async (req, res) => {
        const startTime = Date.now();
        try {
            const { userId, type, payload } = req.body;
            
            // PLACE_STONE 액션에 대한 상세 로깅 (특히 triggerAutoScoring 플래그)
            if (type === 'PLACE_STONE' && payload?.triggerAutoScoring) {
                console.log(`[/api/action] PLACE_STONE with triggerAutoScoring received:`, {
                    userId,
                    gameId: payload?.gameId,
                    x: payload?.x,
                    y: payload?.y,
                    totalTurns: payload?.totalTurns,
                    triggerAutoScoring: payload?.triggerAutoScoring
                });
            }

            // Allow registration without auth
            if (req.body.type === 'REGISTER') {
                 const result = await handleAction(volatileState, req.body);
                 if (result.error) return res.status(400).json({ message: result.error });
                 return res.status(200).json({ success: true, ...result.clientResponse });
            }

            if (!userId) {
                return res.status(401).json({ message: '인증 정보가 없습니다.' });
            }

            const getUserStartTime = Date.now();
            // 캐시를 우선 사용하여 DB 쿼리 최소화 (Railway 네트워크 지연 대응)
            const { getCachedUser } = await import('./gameCache.js');
            const user = await getCachedUser(userId);
            const getUserDuration = Date.now() - getUserStartTime;
            
            if (!user) {
                delete volatileState.userConnections[userId];
                return res.status(401).json({ message: '유효하지 않은 사용자입니다.' });
            }

            // --- Inventory Slots Migration Logic (한 번만 실행) ---
            // 마이그레이션이 필요한 경우에만 실행하고, DB 업데이트는 비동기로 처리하여 응답 지연 최소화
            if (!user.inventorySlotsMigrated) {
                let currentEquipmentSlots = 30;
                let currentConsumableSlots = 30;
                let currentMaterialSlots = 30;

                if (typeof user.inventorySlots === 'number') {
                    currentEquipmentSlots = Math.max(30, user.inventorySlots);
                } else if (typeof user.inventorySlots === 'object' && user.inventorySlots !== null) {
                    currentEquipmentSlots = Math.max(30, user.inventorySlots.equipment || 0);
                    currentConsumableSlots = Math.max(30, user.inventorySlots.consumable || 0);
                    currentMaterialSlots = Math.max(30, user.inventorySlots.material || 0);
                }

                if (typeof user.inventorySlots === 'number' || (typeof user.inventorySlots === 'object' && user.inventorySlots !== null && (user.inventorySlots.equipment < 30 || user.inventorySlots.consumable < 30 || user.inventorySlots.material < 30))) {
                    user.inventorySlots = {
                        equipment: currentEquipmentSlots,
                        consumable: currentConsumableSlots,
                        material: currentMaterialSlots,
                    };
                    user.inventorySlotsMigrated = true;
                    // DB 업데이트는 비동기로 처리하여 응답 지연 최소화
                    db.updateUser(user).catch(err => {
                        console.error(`[API] Failed to migrate inventory slots for user ${userId}:`, err);
                    });
                }
            }
            // --- End Migration Logic ---

            // Re-establish connection if needed
            if (!volatileState.userConnections[userId]) {
                console.log(`[Auth] Re-establishing connection on action for user: ${user.nickname} (${userId})`);
                volatileState.userConnections[userId] = Date.now();
                volatileState.userStatuses[userId] = { status: types.UserStatus.Online };
            }
            
            volatileState.userConnections[userId] = Date.now();

            // 프로덕션에서는 상세 로깅 제거 (성능 향상)
            if (process.env.NODE_ENV === 'development') {
                console.log(`[/api/action] Calling handleAction for type: ${req.body.type}`);
            }
            
            const handleActionStartTime = Date.now();
            // 이미 가져온 user를 전달하여 중복 DB 쿼리 방지
            const result = await handleAction(volatileState, req.body, user);
            const handleActionDuration = Date.now() - handleActionStartTime;
            
            if (result.error) {
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[/api/action] Returning 400 error for ${req.body.type}: ${result.error}`);
                }
                return res.status(400).json({ message: result.error });
            }
            
            const totalDuration = Date.now() - startTime;
            // 응답 시간이 1초 이상인 경우에만 로깅 (성능 모니터링)
            if (totalDuration > 1000) {
                console.log(`[/api/action] SLOW: ${type} took ${totalDuration}ms (getUser: ${getUserDuration}ms, handleAction: ${handleActionDuration}ms)`);
            }
            
            // 성공 응답 즉시 반환 (불필요한 로깅 제거)
            res.status(200).json({ success: true, ...result.clientResponse });
        } catch (e: any) {
            console.error(`[API] Action error for ${req.body?.type}:`, e);
            console.error(`[API] Error stack:`, e.stack);
            console.error(`[API] Error details:`, {
                message: e.message,
                name: e.name,
                code: e.code,
                userId: req.body?.userId,
                payload: req.body?.payload
            });
            res.status(500).json({ 
                message: '요청 처리 중 오류가 발생했습니다.',
                error: process.env.NODE_ENV === 'development' ? e.message : undefined
            });
        }
    });

    // 긴급 봇 점수 복구 엔드포인트 (점수가 0인 봇만 복구)
    // KataGo 상태 확인 엔드포인트 (관리자 전용)
    app.get('/api/admin/katago-status', async (req, res) => {
        try {
            const { getKataGoManager, initializeKataGo } = await import('./kataGoService.js');
            const manager = getKataGoManager();
            
            // KataGo 프로세스 상태 확인
            const processRunning = manager && (manager as any).process && !(manager as any).process.killed;
            const isStarting = (manager as any).isStarting || false;
            const pendingQueries = (manager as any).pendingQueries ? (manager as any).pendingQueries.size : 0;
            
            // 환경 변수 확인
            const config = {
                KATAGO_PATH: process.env.KATAGO_PATH || 'not set',
                KATAGO_MODEL_PATH: process.env.KATAGO_MODEL_PATH || 'not set',
                KATAGO_HOME_PATH: process.env.KATAGO_HOME_PATH || 'not set',
                KATAGO_API_URL: process.env.KATAGO_API_URL || 'not set',
                KATAGO_NUM_ANALYSIS_THREADS: process.env.KATAGO_NUM_ANALYSIS_THREADS || 'not set',
                KATAGO_NUM_SEARCH_THREADS: process.env.KATAGO_NUM_SEARCH_THREADS || 'not set',
                KATAGO_MAX_VISITS: process.env.KATAGO_MAX_VISITS || 'not set',
                KATAGO_NN_MAX_BATCH_SIZE: process.env.KATAGO_NN_MAX_BATCH_SIZE || 'not set',
                NODE_ENV: process.env.NODE_ENV || 'not set',
                RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || 'not set',
                USE_HTTP_API: !!(process.env.KATAGO_API_URL && process.env.KATAGO_API_URL.trim() !== ''),
            };
            
            // 로그 파일 읽기 시도
            let logContent = null;
            try {
                const fs = await import('fs');
                const path = await import('path');
                const logPath = path.resolve(process.cwd(), 'katago', 'katago_analysis_log.txt');
                if (fs.existsSync(logPath)) {
                    const logStats = fs.statSync(logPath);
                    const logBuffer = fs.readFileSync(logPath);
                    // 최근 500줄만 읽기 (파일이 클 수 있음)
                    const logLines = logBuffer.toString().split('\n');
                    const recentLines = logLines.slice(-500);
                    logContent = {
                        path: logPath,
                        size: logStats.size,
                        lastModified: logStats.mtime.toISOString(),
                        recentLines: recentLines,
                        totalLines: logLines.length
                    };
                }
            } catch (logError: any) {
                console.error('[Admin] Failed to read KataGo log:', logError.message);
            }
            
            res.json({
                status: processRunning ? 'running' : (isStarting ? 'starting' : 'stopped'),
                processRunning,
                isStarting,
                pendingQueries,
                config,
                log: logContent
            });
        } catch (error: any) {
            console.error('[Admin] Error getting KataGo status:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    app.post('/api/admin/recover-bot-scores', async (req, res) => {
        try {
            console.log('[Admin] ========== 봇 점수 복구 시작 ==========');
            
            const { updateBotLeagueScores } = await import('./scheduledTasks.js');
            const { listUsers } = await import('./prisma/userService.js');
            
            const allUsers = await listUsers({ includeEquipment: false, includeInventory: false });
            for (const user of allUsers) {
                if (user.weeklyCompetitors && user.weeklyCompetitors.length > 0) {
                    const updatedUser = await updateBotLeagueScores(user, true);
                    await db.updateUser(updatedUser);
                }
            }
            
            console.log(`[Admin] ========== 봇 점수 복구 완료 ==========`);
            res.status(200).json({ success: true, message: '봇 점수 복구 완료. 점수가 0이었던 모든 봇의 점수가 복구되었습니다.' });
        } catch (error: any) {
            console.error('[Admin] 봇 점수 복구 오류:', error);
            console.error('[Admin] 오류 스택:', error.stack);
            res.status(500).json({ error: error.message });
        }
    });
    
    app.post('/api/admin/fix-bot-yesterday-scores', async (req, res) => {
        try {
            console.log('[Admin] ========== 어제 점수 수정 시작 ==========');
            
            const { fixBotYesterdayScores } = await import('./scheduledTasks.js');
            await fixBotYesterdayScores();
            
            console.log(`[Admin] ========== 어제 점수 수정 완료 ==========`);
            res.status(200).json({ success: true, message: '어제 점수 수정 완료. 어제 점수가 0이었던 모든 봇의 어제 점수가 수정되었습니다.' });
        } catch (error: any) {
            console.error('[Admin] 어제 점수 수정 오류:', error);
            console.error('[Admin] 오류 스택:', error.stack);
            res.status(500).json({ error: error.message });
        }
    });
    
    // 긴급 봇 점수 업데이트 엔드포인트 (누락된 날짜 보완)
    // 주의: 인증 없이 실행되므로 보안에 주의하세요
    app.post('/api/admin/update-bot-scores-now', async (req, res) => {
        try {
            console.log('[Admin] ========== 봇 점수 즉시 업데이트 시작 (누락된 날짜 보완) ==========');
            const { updateBotLeagueScores } = await import('./scheduledTasks.js');
            const { listUsers } = await import('./prisma/userService.js');
            const allUsers = await listUsers({ includeEquipment: false, includeInventory: false });
            let updatedCount = 0;
            let totalBotsUpdated = 0;
            
            for (const user of allUsers) {
                if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
                    continue;
                }
                
                const userBeforeUpdate = JSON.stringify(user.weeklyCompetitorsBotScores || {});
                // 누락된 날짜 자동 보완 (마지막 업데이트 다음 날부터 오늘까지)
                const updatedUser = await updateBotLeagueScores(user, false);
                const userAfterUpdate = JSON.stringify(updatedUser.weeklyCompetitorsBotScores || {});
                
                if (userBeforeUpdate !== userAfterUpdate) {
                    await db.updateUser(updatedUser);
                    updatedCount++;
                    
                    // 업데이트된 봇 수 계산
                    const botCount = (user.weeklyCompetitors || []).filter(c => c.id.startsWith('bot-')).length;
                    totalBotsUpdated += botCount;
                }
            }
            
            console.log(`[Admin] ========== 봇 점수 즉시 업데이트 완료 ==========`);
            console.log(`[Admin] 업데이트된 유저: ${updatedCount}명, 총 봇 수: ${totalBotsUpdated}개`);
            res.status(200).json({ success: true, message: `봇 점수 업데이트 완료. ${updatedCount}명의 유저, ${totalBotsUpdated}개의 봇 업데이트됨.` });
        } catch (error: any) {
            console.error('[Admin] 봇 점수 업데이트 오류:', error);
            console.error('[Admin] 오류 스택:', error.stack);
            res.status(500).json({ error: error.message });
        }
    });

    // SPA fallback: serve index.html for all non-API routes (must be after all API routes)
    app.get('*', (req, res, next) => {
        // Skip API and WebSocket routes
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
            return res.status(404).json({ message: 'Not found' });
        }
        // Skip static asset requests (JS, CSS, images, etc.) - let express.static handle them
        if (req.path.startsWith('/assets/') || 
            req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i)) {
            // If express.static didn't find the file, return 404
            return res.status(404).json({ message: 'Static file not found' });
        }
        // Serve index.html for SPA routing
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const distPath = path.join(__dirname, '..', 'dist');
        res.sendFile(path.join(distPath, 'index.html'), (err) => {
            if (err) {
                console.error('[SPA] Error serving index.html:', err);
                res.status(500).json({ message: 'Frontend not found' });
            }
        });
    });

};

// Start server with error handling
startServer().catch((error) => {
    console.error('[Server] Fatal error during startup:', error);
    console.error('[Server] Stack trace:', error.stack);
    process.exit(1);
});