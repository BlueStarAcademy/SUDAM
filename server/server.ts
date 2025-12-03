import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import process from 'process';
import http from 'http';
import { createWebSocketServer, broadcast } from './socket.js';

// Railway 환경 자동 감지
// Railway는 RAILWAY_ENVIRONMENT_NAME, RAILWAY_SERVICE_NAME 등을 제공하지만
// RAILWAY_ENVIRONMENT는 자동으로 설정되지 않으므로 수동으로 설정
if (!process.env.RAILWAY_ENVIRONMENT && 
    (process.env.RAILWAY_ENVIRONMENT_NAME || 
     process.env.RAILWAY_SERVICE_NAME || 
     process.env.RAILWAY_PROJECT_NAME ||
     process.env.DATABASE_URL?.includes('railway'))) {
    process.env.RAILWAY_ENVIRONMENT = 'true';
    console.log('[Server] Railway environment auto-detected');
}
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


// 타임아웃 상수 정의 (startServer 함수 밖에서도 사용 가능하도록)
const LOBBY_TIMEOUT_MS = 90 * 1000;
const GAME_DISCONNECT_TIMEOUT_MS = 90 * 1000;

const startServer = async () => {
    // 서버 리스닝을 최우선으로 하기 위해 데이터베이스 초기화를 비동기로 처리
    // 타임아웃 추가 (5초) - 서버 시작 속도 향상
    let dbInitialized = false;
    const dbInitPromise = (async () => {
        // --- Debug: Check DATABASE_URL ---
        const dbUrl = process.env.DATABASE_URL;
        console.log(`[Server Startup] DATABASE_URL check: ${dbUrl ? `Set (length: ${dbUrl.length}, starts with: ${dbUrl.substring(0, 20)}...)` : 'NOT SET'}`);
        if (!dbUrl) {
            console.error("[Server Startup] DATABASE_URL is not set! Please check Railway Variables.");
            console.error("[Server Startup] All environment variables:", Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES')).join(', '));
        } else {
            // Railway 환경에서 내부 네트워크 사용 권장
            const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.DATABASE_URL?.includes('railway');
            if (isRailway && !dbUrl.includes('postgres.railway.internal')) {
                console.warn("[Server Startup] WARNING: DATABASE_URL is not using Railway internal network.");
                console.warn("[Server Startup] For better performance and reliability, consider using: postgres.railway.internal:5432");
                console.warn("[Server Startup] Current URL uses:", dbUrl.includes('railway.app') ? 'public Railway URL' : 'external URL');
            } else if (isRailway && dbUrl.includes('postgres.railway.internal')) {
                console.log("[Server Startup] Using Railway internal network (recommended)");
            }
        }
        
        // 데이터베이스 연결 상태 주기적 확인 및 로깅
        setInterval(async () => {
            const connected = await db.isDatabaseConnected();
            if (!connected) {
                console.warn(`[Server Startup] Database connection status: DISCONNECTED (will retry in background)`);
            } else {
                console.log(`[Server Startup] Database connection status: CONNECTED`);
            }
        }, 30000); // 30초마다 확인
        
        // --- Initialize Database on Start ---
        try {
            const dbTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Database initialization timeout')), 5000);
            });
            await Promise.race([db.initializeDatabase(), dbTimeout]);
            dbInitialized = true;
            console.log('[Server Startup] Database initialized successfully');
        } catch (err: any) {
            console.error("Error during server startup:", err);
            
            // 데이터베이스 연결 오류인 경우 더 자세한 안내
            if (err.code === 'P1001' || err.message?.includes("Can't reach database server") || 
                err.message?.includes('connection') || err.code?.startsWith('P') || err.message?.includes('timeout')) {
                console.error("\n[Server] Database connection failed or timed out!");
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
            
            // Railway 환경에서는 데이터베이스 연결 실패해도 서버를 계속 실행
            // 헬스체크에서 데이터베이스 상태를 확인하고, 백그라운드에서 재시도
            if (process.env.RAILWAY_ENVIRONMENT) {
                console.error("[Server] Railway environment detected. Continuing server startup despite database error.");
                console.error("[Server] Server will continue running and retry database connection in background.");
                console.error("[Server] Health check will report database status.");
                
                // 백그라운드에서 데이터베이스 연결 재시도
                (async () => {
                    let retries = 10;
                    while (retries > 0 && !dbInitialized) {
                        await new Promise(resolve => setTimeout(resolve, 10000)); // 10초 대기
                        try {
                            await db.initializeDatabase();
                            dbInitialized = true;
                            console.log("[Server] Database connection established after retry!");
                        } catch (retryError: any) {
                            retries--;
                            console.warn(`[Server] Database retry failed (${10 - retries}/10):`, retryError.message);
                        }
                    }
                })();
            } else {
                // 로컬 환경에서는 즉시 종료하지 않고 경고만 출력
                // 서버가 시작되지 않으면 헬스체크가 실패하므로 Railway가 재시작할 수 있음
                console.error("[Server] Local environment: Database connection failed. Server will start but may not function correctly.");
                console.error("[Server] Please check DATABASE_URL and ensure database is running.");
            }
        }
    })();
    
    // 데이터베이스 초기화를 기다리지 않고 서버 시작 (서버 리스닝 최우선)
    // 데이터베이스 초기화는 백그라운드에서 계속 진행

    // Fetch all users from DB (optimized: without equipment/inventory to reduce memory usage)
    // 데이터베이스 초기화 완료 후 비동기로 처리 (서버 리스닝 시작 후 실행)
    // 서버 리스닝을 최우선으로 하기 위해 데이터베이스 초기화 완료를 기다리지 않음
    dbInitPromise.then(() => {
        // 데이터베이스 초기화 완료 후 사용자 업데이트 실행
        setImmediate(() => {
            (async () => {
                try {
                    const { listUsers } = await import('./prisma/userService.js');
                    // 타임아웃 추가 (30초)
                    const usersTimeout = new Promise<types.User[]>((resolve) => {
                        setTimeout(() => resolve([]), 30000);
                    });
                    const allDbUsers = await Promise.race([
                        listUsers({ includeEquipment: false, includeInventory: false }),
                        usersTimeout
                    ]);
                    
                    if (allDbUsers.length === 0) {
                        console.warn('[Server Startup] No users found for base stats update, skipping...');
                        return;
                    }
                    
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
                } catch (error: any) {
                    console.error('[Server Startup] Failed to fetch/update users:', error?.message || error);
                    console.error('[Server Startup] Continuing server startup despite user update error...');
                }
            })().catch((outerError: any) => {
                // async 함수 자체가 실패한 경우
                console.error('[Server Startup] Critical error in base stats update wrapper:', outerError);
                // 프로세스를 종료하지 않음
            });
        });
    }).catch(() => {
        console.warn('[Server Startup] Database not initialized. Skipping user updates. Will retry when database is available.');
    });

    // --- 1회성 작업들 (환경 변수로 제어) ---
    // 필요시에만 주석을 해제하여 실행하세요.
    // 서버 시작 속도를 위해 비동기로 처리 (서버 리스닝 시작 후 실행)
    
    // --- 1회성 챔피언십 점수 초기화 ---
    // await resetAllTournamentScores();
    
    // --- 1회성: 모든 유저의 리그 점수를 0으로 초기화 ---
    // await resetAllUsersLeagueScoresForNewWeek();
    
    // --- 1회성: 모든 유저의 챔피언십 점수를 0으로 초기화 ---
    // await resetAllChampionshipScoresToZero();
    
    // --- 1회성: 어제 점수가 0으로 되어있는 봇 점수 수정 (서버 시작 후 5분 지연 실행) ---
    // 서버가 안정화된 후 실행하여 크래시 방지
    // 절대 실패하지 않도록 다중 보호
    setTimeout(() => {
        (async () => {
            try {
                console.log(`[Server Startup] Fixing bot yesterday scores (delayed execution)...`);
                const scheduledTasks = await import('./scheduledTasks.js');
                if (scheduledTasks.fixBotYesterdayScores && typeof scheduledTasks.fixBotYesterdayScores === 'function') {
                    // 타임아웃 추가 (2분) - 배치 처리로 변경되어 더 오래 걸릴 수 있음
                    const timeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('fixBotYesterdayScores timeout')), 120000);
                    });
                    await Promise.race([
                        scheduledTasks.fixBotYesterdayScores(),
                        timeout
                    ]);
                } else {
                    console.warn('[Server Startup] fixBotYesterdayScores function not found, skipping...');
                }
            } catch (error: any) {
                console.error('[Server Startup] Failed to fix bot yesterday scores:', error?.message || error);
                // 서버 시작을 계속 진행 (치명적 오류가 아님)
            }
        })().catch((outerError: any) => {
            // async 함수 자체가 실패한 경우
            console.error('[Server Startup] Critical error in fixBotYesterdayScores wrapper:', outerError);
            // 프로세스를 종료하지 않음
        });
    }, 5 * 60 * 1000); // 5분 지연
    
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
    
    // 포트 검증 및 설정
    const portEnv = process.env.PORT;
    let port: number;
    if (portEnv) {
        port = parseInt(portEnv, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.error(`[Server] Invalid PORT environment variable: ${portEnv}. Using default port 4000.`);
            port = 4000;
        } else {
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Server] Using PORT from environment: ${port}`);
            }
        }
    } else {
        port = 4000;
        if (process.env.NODE_ENV === 'development') {
            console.log(`[Server] PORT not set, using default: ${port}`);
        }
    }
    
    // Railway는 PORT 환경 변수를 자동으로 설정함
    // Railway의 경우 process.env.PORT를 사용해야 함
    if (process.env.NODE_ENV === 'development') {
        console.log(`[Server] process.env.PORT: ${process.env.PORT || 'not set (using default 4000)'}`);
        console.log(`[Server] Server will listen on port: ${port}`);
    }

    // CORS 설정 - 프로덕션에서는 특정 origin만 허용
    const corsOptions: cors.CorsOptions = {
        origin: process.env.NODE_ENV === 'production' 
            ? [
                process.env.FRONTEND_URL,
                /\.railway\.app$/,
                /\.up\.railway\.app$/
              ].filter((origin): origin is string | RegExp => origin !== undefined && origin !== null) as (string | RegExp)[]
            : true,
        credentials: true
    };
    app.use(cors(corsOptions));
    
    // Ignore development tooling noise such as Vite/Esbuild status pings
    // This route should be early in the middleware stack to avoid unnecessary processing
    // Only needed in development when Vite dev server is running
    if (process.env.NODE_ENV === 'development') {
        app.use('/@esbuild', (_req, res) => {
            res.status(204).end();
        });
    }
    
    app.use(express.json({ limit: '10mb' }) as any);
    
    // 전역 에러 핸들러 미들웨어 (모든 라우트 이후에 추가)
    // 이 핸들러는 모든 라우트 정의 후에 추가됩니다

    // Serve static files from public directory with optimized caching
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, '..', 'public');
    
    // 이미지 파일 서빙 (1년 캐싱, 압축 지원)
    app.use('/images', express.static(path.join(publicPath, 'images'), {
        maxAge: '1y',
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
            // 이미지 파일에 대한 캐싱 헤더
            if (filePath.match(/\.(png|jpg|jpeg|gif|ico|svg|webp)$/i)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                res.setHeader('Vary', 'Accept-Encoding');
            }
        }
    }));
    
    // 사운드 파일 서빙 (1년 캐싱)
    app.use('/sounds', express.static(path.join(publicPath, 'sounds'), {
        maxAge: '1y',
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }));
    
    // Serve frontend build files (CSS, JS, assets)
    const distPath = path.join(__dirname, '..', 'dist');
    
    // dist 디렉토리 존재 여부 확인 및 로깅
    const fs = await import('fs');
    const distExists = fs.existsSync(distPath);
    if (!distExists) {
        console.warn(`[Server] WARNING: dist directory not found at ${distPath}. Frontend files may not be available.`);
    } else {
        const distFiles = fs.readdirSync(distPath);
        console.log(`[Server] dist directory found with ${distFiles.length} files/directories`);
    }
    
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
        },
        // 404 에러를 조용히 처리 (SPA fallback으로 넘어가도록)
        fallthrough: true
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
    const DISCONNECT_TIMER_S = 90;

    // 요청 타임아웃 설정 (1000명 동시 접속 대응: 2분으로 증가)
    const server = http.createServer((req, res) => {
        // 타임아웃 설정 (2분으로 증가 - 대용량 데이터 처리 시간 고려)
        req.setTimeout(120000, () => {
            if (!res.headersSent) {
                res.writeHead(408, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Request timeout' }));
            }
        });
        
        app(req, res);
    });
    
    // 서버 타임아웃 설정 (1000명 동시 접속 대응)
    server.timeout = 120000; // 2분으로 증가 (1000명 처리 시간 고려)
    server.keepAliveTimeout = 120000; // 2분으로 증가
    server.headersTimeout = 130000; // 2분 10초로 증가
    // maxConnections는 Node.js http.Server에서 직접 지원하지 않음
    // 대신 연결 관리는 운영체제 레벨에서 처리됨
    
    // WebSocket 서버 생성 (실패해도 HTTP 서버는 계속 실행)
    try {
        createWebSocketServer(server);
        console.log('[Server] WebSocket server initialization attempted');
    } catch (wsError: any) {
        console.error('[Server] Failed to create WebSocket server:', wsError);
        console.error('[Server] HTTP server will continue without WebSocket support');
        // WebSocket 서버 생성 실패해도 HTTP 서버는 계속 실행
    }

    // 서버 리스닝 상태를 전역으로 저장 (헬스체크용)
    let isServerReady = false;
    
    // Health check endpoint (server 생성 직후 정의하여 클로저로 접근 가능)
    // Railway 크래시 루프 방지를 위해 항상 200 반환
    // 서버가 리스닝 중이면 healthy로 간주
    app.get('/api/health', async (req, res) => {
        // Health Check 로그 (간소화하여 성능 영향 최소화)
        const startTime = Date.now();
        
        try {
            // 데이터베이스 연결 상태 확인 (비동기, 타임아웃 2초)
            let dbStatus = 'unknown';
            try {
                const dbCheckPromise = (async () => {
                    const prismaClient = (await import('./prismaClient.js')).default;
                    await prismaClient.$queryRaw`SELECT 1`;
                    return 'connected';
                })();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('timeout')), 2000)
                );
                await Promise.race([dbCheckPromise, timeoutPromise]);
                dbStatus = 'connected';
            } catch (dbError) {
                dbStatus = 'disconnected';
            }
            
            // 서버가 완전히 준비되지 않았어도 헬스체크는 성공으로 반환
            // Railway가 헬스체크 실패로 인해 무한 재시작하는 것을 방지
            const serverStatus = {
                status: server && server.listening ? 'ok' : 'starting',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                listening: server?.listening || false,
                ready: isServerReady,
                database: dbStatus,
                pid: process.pid,
                memory: process.env.RAILWAY_ENVIRONMENT ? {
                    rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
                    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
                } : undefined
            };
            
            // 서버가 리스닝 중이면 항상 200 반환 (Railway 재시작 방지)
            // 서버가 시작 중이어도 재시작하지 않도록 함
            if (server && server.listening) {
                res.status(200).json(serverStatus);
            } else {
                // 서버가 아직 리스닝하지 않았어도 200 반환 (시작 중)
                res.status(200).json(serverStatus);
            }
            
            // Health Check 로그 (첫 번째 요청과 느린 요청만 출력)
            const elapsed = Date.now() - startTime;
            const isFirstCheck = !(global as any).healthCheckCount;
            (global as any).healthCheckCount = ((global as any).healthCheckCount || 0) + 1;
            
            if (isFirstCheck || elapsed > 100 || !serverStatus.listening || dbStatus === 'disconnected' || (global as any).healthCheckCount % 10 === 0) {
                console.log(`[Health Check] ${serverStatus.status} (${elapsed}ms, listening: ${serverStatus.listening}, ready: ${serverStatus.ready}, db: ${dbStatus}, count: ${(global as any).healthCheckCount})`);
            }
        } catch (error) {
            console.error('[Health Check] Error:', error);
            // 에러가 발생해도 200 반환하여 재시작 방지
            if (!res.headersSent) {
                res.status(200).json({ 
                    status: 'error', 
                    message: 'Health check error but server is running',
                    timestamp: new Date().toISOString(),
                    pid: process.pid
                });
            }
        }
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`[Server] Port ${port} is already in use. Please stop the process using this port or use a different port.`);
            console.error(`[Server] To find and kill the process: netstat -ano | findstr ":${port}"`);
            // Railway 환경에서는 포트 충돌 시에도 프로세스를 종료하지 않음
            // Railway가 자동으로 재시작하는 것을 방지
            if (!process.env.RAILWAY_ENVIRONMENT) {
                process.exit(1);
            }
        } else {
            console.error('[Server] Server error:', error);
            console.error('[Server] Server error code:', error.code);
            console.error('[Server] Server error message:', error.message);
            // Railway 환경에서는 즉시 종료하지 않고 로그만 남김
            // 서버가 계속 실행되도록 보장
            if (!process.env.RAILWAY_ENVIRONMENT) {
                process.exit(1);
            }
        }
    });

    // Graceful shutdown 함수
    const gracefulShutdown = async (server: http.Server) => {
        console.log('[Server] Initiating graceful shutdown...');
        isServerReady = false;
        
        // 30초 내에 종료되지 않으면 강제 종료
        const shutdownTimeout = setTimeout(() => {
            console.error('[Server] Graceful shutdown timeout. Forcing exit...');
            process.exit(1);
        }, 30000);
        
        server.close(() => {
            clearTimeout(shutdownTimeout);
            console.log('[Server] HTTP server closed.');
            process.exit(0);
        });
        
        // WebSocket 서버 종료
        try {
            const socketModule = await import('./socket.js') as any;
            if (socketModule.getWebSocketServer) {
                const wss = socketModule.getWebSocketServer();
                if (wss) {
                    wss.close(() => {
                        console.log('[Server] WebSocket server closed.');
                    });
                }
            }
        } catch (error) {
            console.error('[Server] Error closing WebSocket server:', error);
        }
    };

    // SIGTERM, SIGINT 시그널 처리 (Railway에서 컨테이너 종료 시)
    process.on('SIGTERM', () => {
        console.log('[Server] SIGTERM received. Initiating graceful shutdown...');
        gracefulShutdown(server).catch(err => {
            console.error('[Server] Error during graceful shutdown:', err);
            process.exit(1);
        });
    });

    process.on('SIGINT', () => {
        console.log('[Server] SIGINT received. Initiating graceful shutdown...');
        gracefulShutdown(server).catch(err => {
            console.error('[Server] Error during graceful shutdown:', err);
            process.exit(1);
        });
    });

    // 서버 리스닝 시작 (에러가 발생해도 반드시 리스닝을 시작하도록 보장)
    try {
        server.listen(port, '0.0.0.0', async () => {
            console.log(`[Server] ========================================`);
            console.log(`[Server] Server listening on port ${port}`);
            console.log(`[Server] Process PID: ${process.pid}`);
            console.log(`[Server] Node version: ${process.version}`);
            console.log(`[Server] Railway environment: ${process.env.RAILWAY_ENVIRONMENT || 'not set'}`);
            
            // 즉시 메모리 사용량 로그 출력 (크래시 진단용)
            const initialMemUsage = process.memoryUsage();
            const initialMemMB = {
                rss: Math.round(initialMemUsage.rss / 1024 / 1024),
                heapTotal: Math.round(initialMemUsage.heapTotal / 1024 / 1024),
                heapUsed: Math.round(initialMemUsage.heapUsed / 1024 / 1024),
                external: Math.round(initialMemUsage.external / 1024 / 1024)
            };
            console.log(`[Server] Initial memory usage: RSS=${initialMemMB.rss}MB, Heap=${initialMemMB.heapUsed}/${initialMemMB.heapTotal}MB, External=${initialMemMB.external}MB`);
            
            isServerReady = true;
            console.log('[Server] Server is ready and accepting connections');
            console.log('[Server] Health check endpoint is available at /api/health');
            console.log(`[Server] ========================================`);
            
            // Keep-alive: 주기적으로 로그를 출력하여 프로세스가 살아있음을 확인
            // Railway가 프로세스를 종료하지 않도록 하기 위함
            setInterval(() => {
                console.log(`[Server] Keep-alive: Server is running (uptime: ${Math.round(process.uptime())}s, PID: ${process.pid})`);
            }, 300000); // 5분마다
            
            // Health check를 즉시 응답할 수 있도록 서버 리스닝 상태 확인
            // Railway는 서버가 리스닝을 시작하면 health check를 수행하므로,
            // 무거운 초기화 작업은 비동기로 지연 처리
            
            // KataGo 엔진 초기화 (서버 시작 후 비동기로 처리, 블로킹 방지)
            setImmediate(() => {
                (async () => {
                    try {
                        // 타임아웃 추가 (60초)
                        const timeout = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('KataGo initialization timeout')), 60000);
                        });
                        await Promise.race([
                            initializeKataGo(),
                            timeout
                        ]);
                    } catch (error: any) {
                        console.error('[Server] Failed to initialize KataGo during server startup:', error?.message || error);
                        console.error('[Server] Server will continue without KataGo pre-initialization');
                        // 서버는 계속 실행 (KataGo 초기화 실패는 치명적이지 않음)
                    }
                })().catch((outerError: any) => {
                    // async 함수 자체가 실패한 경우
                    console.error('[Server] Critical error in KataGo initialization wrapper:', outerError);
                    // 프로세스를 종료하지 않음
                });
            });
        });
    } catch (listenError: any) {
        console.error('[Server] Failed to start listening:', listenError);
        console.error('[Server] Listen error code:', listenError?.code);
        console.error('[Server] Listen error message:', listenError?.message);
        // 리스닝 실패 시에도 프로세스를 종료하지 않음
        // Railway가 자동으로 재시작하는 것을 방지
        console.error('[Server] Server will continue running despite listen error');
    }

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

                    const advanced = await tournamentService.advanceSimulation(tournamentState, user);
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
        // 절대 실패하지 않도록 보호
        try {
            setTimeout(() => {
                // setTimeout 내부도 보호
                (async () => {
                    try {
                        if (isProcessingMainLoop) {
                            scheduleMainLoop(Math.min(delay * 2, 5000));
                            return;
                        }

                        isProcessingMainLoop = true;
                        hasLoggedMainLoopSkip = false;
                        try {
                            const now = Date.now();
                
                // 랭킹전 매칭 처리 (1초마다) - 에러 핸들링 추가
                if (volatileState.rankedMatchingQueue) {
                    try {
                        const { tryMatchPlayers } = await import('./actions/socialActions.js');
                        for (const lobbyType of ['strategic', 'playful'] as const) {
                            if (volatileState.rankedMatchingQueue[lobbyType] && Object.keys(volatileState.rankedMatchingQueue[lobbyType]).length >= 2) {
                                try {
                                    await tryMatchPlayers(volatileState, lobbyType);
                                } catch (matchError: any) {
                                    console.warn(`[MainLoop] Error matching players for ${lobbyType}:`, matchError?.message);
                                }
                            }
                        }
                    } catch (matchingError: any) {
                        console.error('[MainLoop] Error in ranked matching:', matchingError?.message);
                    }
                }

            // --- START NEW OFFLINE AP REGEN LOGIC ---
            if (now - lastOfflineRegenAt >= OFFLINE_REGEN_INTERVAL_MS) {
                try {
                    // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드 (타임아웃 추가)
                    const { listUsers } = await import('./prisma/userService.js');
                    const usersTimeout = new Promise<types.User[]>((resolve) => {
                        setTimeout(() => resolve([]), 5000); // 5초 타임아웃
                    });
                    const allUsers = await Promise.race([
                        listUsers({ includeEquipment: false, includeInventory: false }),
                        usersTimeout
                    ]);
                    
                    if (allUsers.length === 0) {
                        console.warn('[MainLoop] No users loaded for offline regen, skipping...');
                        lastOfflineRegenAt = now;
                        return;
                    }
                    
                    // 매일 0시에 토너먼트 상태 자동 리셋 확인 (processDailyQuestReset에서 처리되지만, 
                    // 메인 루프에서도 날짜 변경 시 체크하여 오프라인 사용자도 리셋되도록 보장)
                    const { getKSTHours, getKSTMinutes } = await import('../utils/timeUtils.js');
                    const kstHoursForReset = getKSTHours(now);
                    const kstMinutesForReset = getKSTMinutes(now);
                    const isMidnightForReset = kstHoursForReset === 0 && kstMinutesForReset < 5;
                    
                    // 배치 처리로 최적화 (한 번에 50명씩 처리)
                    const batchSize = 50;
                    for (let i = 0; i < allUsers.length; i += batchSize) {
                        const batch = allUsers.slice(i, i + batchSize);
                        await Promise.allSettled(batch.map(async (user) => {
                            try {
                                let updatedUser = user;
                                
                                // 매일 0시에만 토너먼트 상태 리셋 (로그인하지 않은 사용자도 포함)
                                if (isMidnightForReset) {
                                    updatedUser = await resetAndGenerateQuests(updatedUser);
                                }
                                
                                updatedUser = await regenerateActionPoints(updatedUser);
                                updatedUser = processSinglePlayerMissions(updatedUser);
                                
                                // 봇 점수 업데이트 제거됨 - 던전 시스템으로 변경
                                // const { updateBotLeagueScores } = await import('./scheduledTasks.js');
                                // updatedUser = await updateBotLeagueScores(updatedUser);
                                
                                // 최적화: 간단한 필드 비교로 변경 (JSON.stringify 대신)
                                const hasChanges = user.actionPoints !== updatedUser.actionPoints ||
                                    user.gold !== updatedUser.gold ||
                                    user.singlePlayerMissions !== updatedUser.singlePlayerMissions;
                                    // user.weeklyCompetitors 제거됨 - 던전 시스템으로 변경
                                if (hasChanges) {
                                    await db.updateUser(updatedUser);
                                }
                            } catch (userError: any) {
                                // 개별 사용자 처리 실패는 조용히 무시 (다음 사용자 계속 처리)
                                console.warn(`[MainLoop] Failed to process user ${user.id} for offline regen:`, userError?.message);
                            }
                        }));
                    }

                    lastOfflineRegenAt = now;
                } catch (regenError: any) {
                    console.error('[MainLoop] Error in offline regen logic:', regenError?.message || regenError);
                    // 오프라인 리젠 실패해도 서버는 계속 실행
                    lastOfflineRegenAt = now; // 다음 시도 방지
                }
            }
            // --- END NEW OFFLINE AP REGEN LOGIC ---

            // 캐시 정리 (주기적으로 실행) - 에러 핸들링 추가
            try {
                const { cleanupExpiredCache } = await import('./gameCache.js');
                cleanupExpiredCache();
            } catch (cacheError: any) {
                console.error('[MainLoop] Error in cache cleanup:', cacheError?.message);
            }
            
            // 만료된 negotiation 정리 - 에러 핸들링 추가
            try {
                cleanupExpiredNegotiations(volatileState, now);
            } catch (negError: any) {
                console.error('[MainLoop] Error in negotiation cleanup:', negError?.message);
            }
            
            // 만료된 메일 정리 (5일 지난 메일 자동 삭제)
            if (now - (lastDailyTaskCheckAt || 0) >= DAILY_TASK_CHECK_INTERVAL_MS) {
                const { deleteExpiredMails } = await import('./prisma/mailRepository.js');
                try {
                    const deletedCount = await deleteExpiredMails();
                    if (deletedCount > 0) {
                        console.log(`[MainLoop] Deleted ${deletedCount} expired mails`);
                    }
                } catch (error) {
                    console.error('[MainLoop] Error deleting expired mails:', error);
                }
            }
            
            // 메모리 사용량 모니터링 (Railway 환경에서만, 5분마다)
            if (process.env.RAILWAY_ENVIRONMENT) {
                const memCheckInterval = 5 * 60 * 1000; // 5분
                const lastMemCheck = (global as any).lastMemCheck || 0;
                if (now - lastMemCheck >= memCheckInterval) {
                    (global as any).lastMemCheck = now;
                    const memUsage = process.memoryUsage();
                    const memUsageMB = {
                        rss: Math.round(memUsage.rss / 1024 / 1024),
                        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                        external: Math.round(memUsage.external / 1024 / 1024)
                    };
                    console.log(`[Memory] RSS: ${memUsageMB.rss}MB, Heap: ${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB, External: ${memUsageMB.external}MB`);
                    
                    // 메모리 사용량이 300MB를 초과하면 경고 및 캐시 정리
                    if (memUsageMB.rss > 300) {
                        console.warn(`[Memory] High memory usage detected: ${memUsageMB.rss}MB RSS`);
                        // 메모리 사용량이 350MB를 초과하면 강제 캐시 정리
                        if (memUsageMB.rss > 350) {
                            console.warn(`[Memory] Forcing aggressive cache cleanup due to high memory usage (${memUsageMB.rss}MB)`);
                            const { cleanupExpiredCache } = await import('./gameCache.js');
                            cleanupExpiredCache();
                            
                            // 추가 메모리 정리: 가비지 컬렉션 힌트 (Node.js가 GC를 실행하도록 유도)
                            if (global.gc) {
                                global.gc();
                                console.log('[Memory] Manual garbage collection triggered');
                            }
                        }
                    }
                }
            }

            // 게임 로드에 타임아웃 추가 (10초)
            let activeGames: types.LiveGameSession[] = [];
            try {
                const gamesTimeout = new Promise<types.LiveGameSession[]>((resolve) => {
                    setTimeout(() => resolve([]), 10000);
                });
                activeGames = await Promise.race([
                    db.getAllActiveGames(),
                    gamesTimeout
                ]);
            } catch (error: any) {
                console.error('[MainLoop] Failed to load active games:', error?.message || error);
                activeGames = [];
            }
            
            const originalGamesJson = activeGames.map(g => JSON.stringify(g));
            
            // 게임을 캐시에 미리 로드
            const { updateGameCache } = await import('./gameCache.js');
            for (const game of activeGames) {
                updateGameCache(game);
            }
            
                // Handle weekly league updates (Monday 0:00 KST) - 점수 리셋 전에 실행
                // 리그 업데이트는 각 사용자 로그인 시 processWeeklyLeagueUpdates에서 처리되지만,
                // 월요일 0시에 명시적으로 모든 사용자에 대해 리그 업데이트를 실행
                if (now - (lastDailyTaskCheckAt || 0) >= DAILY_TASK_CHECK_INTERVAL_MS) {
                try {
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
                        
                        // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드 (타임아웃 추가)
                        const { listUsers } = await import('./prisma/userService.js');
                        const leagueUsersTimeout = new Promise<types.User[]>((resolve) => {
                            setTimeout(() => resolve([]), 10000); // 10초 타임아웃
                        });
                        const allUsersForLeagueUpdate = await Promise.race([
                            listUsers({ includeEquipment: false, includeInventory: false }),
                            leagueUsersTimeout
                        ]);
                        
                        if (allUsersForLeagueUpdate.length === 0) {
                            console.warn('[WeeklyLeagueUpdate] No users loaded, skipping...');
                        } else {
                            let usersUpdated = 0;
                            let mailsSent = 0;
                            
                            // 배치 처리로 최적화 (한 번에 50명씩 처리)
                            const batchSize = 50;
                            for (let i = 0; i < allUsersForLeagueUpdate.length; i += batchSize) {
                                const batch = allUsersForLeagueUpdate.slice(i, i + batchSize);
                                await Promise.allSettled(batch.map(async (user) => {
                                    try {
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
                                    } catch (userError: any) {
                                        console.warn(`[WeeklyLeagueUpdate] Failed to update user ${user.id}:`, userError?.message);
                                    }
                                }));
                            }
                            console.log(`[WeeklyLeagueUpdate] Updated ${usersUpdated} users, sent ${mailsSent} mails`);
                        }
                        
                        // 2. 티어변동 후 새로운 경쟁상대 매칭 및 모든 점수 리셋
                        // force=true로 호출하여 월요일 0시 체크를 건너뛰고 강제 실행
                        await processWeeklyResetAndRematch(true);
                    }
                }
                
                    // Handle weekly tournament reset (Monday 0:00 KST) - 이제 processWeeklyResetAndRematch에서 처리됨
                    // 기존 함수는 호환성을 위해 유지하지만 실제 처리는 processWeeklyResetAndRematch에서 수행
                    if (!isMondayMidnight) {
                        try {
                            await processWeeklyTournamentReset();
                        } catch (error: any) {
                            console.error('[MainLoop] Error in processWeeklyTournamentReset:', error?.message);
                        }
                    }
                    
                    // Handle ranking rewards
                    try {
                        await processRankingRewards(volatileState);
                    } catch (error: any) {
                        console.error('[MainLoop] Error in processRankingRewards:', error?.message);
                    }
                    
                    // Handle daily ranking calculations (매일 0시 정산)
                    try {
                        await processDailyRankings();
                    } catch (error: any) {
                        console.error('[MainLoop] Error in processDailyRankings:', error?.message);
                    }
                    
                    try {
                        await processTowerRankingRewards();
                    } catch (error: any) {
                        console.error('[MainLoop] Error in processTowerRankingRewards:', error?.message);
                    }
                    
                    // Handle daily quest reset (매일 0시 KST)
                    try {
                        await processDailyQuestReset();
                    } catch (error: any) {
                        console.error('[MainLoop] Error in processDailyQuestReset:', error?.message);
                    }
                    
                    // Handle guild war matching (월요일 또는 금요일 0시 KST)
                    try {
                        const { processGuildWarMatching } = await import('./scheduledTasks.js');
                        await processGuildWarMatching();
                    } catch (error: any) {
                        console.error('[MainLoop] Error in processGuildWarMatching:', error?.message);
                    }

                    lastDailyTaskCheckAt = now;
                } catch (dailyTaskError: any) {
                    console.error('[MainLoop] Error in daily task check:', dailyTaskError?.message);
                    // 일일 작업 실패해도 서버는 계속 실행
                    lastDailyTaskCheckAt = now; // 다음 시도 방지
                }
            }
            
            // 봇 점수 업데이트 제거됨 - 던전 시스템으로 변경
            // 모든 유저의 봇 점수를 주기적으로 업데이트하는 로직 제거
            // 던전 시스템에서는 더 이상 주간 경쟁상대 봇 점수가 필요 없음
            /*
            const BOT_SCORE_UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
            if (!lastBotScoreUpdateAt || (now - lastBotScoreUpdateAt >= BOT_SCORE_UPDATE_INTERVAL_MS)) {
                try {
                    // 메모리 사용량 확인 (Railway 환경에서 중요)
                    const memUsage = process.memoryUsage();
                    const memUsageMB = {
                        rss: Math.round(memUsage.rss / 1024 / 1024),
                        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
                    };
                    
                    // 메모리 사용량이 너무 높으면 스킵 (Railway 메모리 제한 고려)
                    if (memUsageMB.rss > 400) { // 400MB 이상이면 스킵
                        console.warn(`[BotScoreUpdate] Memory usage too high (${memUsageMB.rss}MB RSS), skipping update to prevent crash`);
                        lastBotScoreUpdateAt = now;
                        return;
                    }
                    
                    const { updateBotLeagueScores } = await import('./scheduledTasks.js');
                    // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드 (타임아웃 추가)
                    const { listUsers } = await import('./prisma/userService.js');
                    const botUsersTimeout = new Promise<types.User[]>((resolve) => {
                        setTimeout(() => resolve([]), 10000); // 10초 타임아웃
                    });
                    const allUsersForBotUpdate = await Promise.race([
                        listUsers({ includeEquipment: false, includeInventory: false }),
                        botUsersTimeout
                    ]);
                    
                    if (allUsersForBotUpdate.length === 0) {
                        console.warn('[BotScoreUpdate] No users loaded, skipping...');
                        lastBotScoreUpdateAt = now;
                    } else {
                        let botsUpdated = 0;
                        
                        // 배치 처리로 최적화 (한 번에 50명씩 처리)
                        const batchSize = 50;
                        for (let i = 0; i < allUsersForBotUpdate.length; i += batchSize) {
                            const batch = allUsersForBotUpdate.slice(i, i + batchSize);
                            await Promise.allSettled(batch.map(async (user) => {
                                try {
                                    if (!user.weeklyCompetitors || user.weeklyCompetitors.length === 0) {
                                        return;
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
                                } catch (userError: any) {
                                    console.warn(`[BotScoreUpdate] Failed to update bot scores for user ${user.id}:`, userError?.message);
                                }
                            }));
                            
                            // 배치 간 짧은 대기 (메모리 정리 시간 확보)
                            if (i + batchSize < allUsersForBotUpdate.length) {
                                await new Promise(resolve => setTimeout(resolve, 50));
                            }
                        }
                        
                        if (botsUpdated > 0) {
                            console.log(`[BotScoreUpdate] Updated bot scores for ${botsUpdated} users (Memory: ${memUsageMB.rss}MB RSS, ${memUsageMB.heapUsed}MB Heap)`);
                        }
                        
                        lastBotScoreUpdateAt = now;
                    }
                } catch (botScoreError: any) {
                    console.error('[MainLoop] Error in bot score update:', botScoreError?.message);
                    // 봇 점수 업데이트 실패해도 서버는 계속 실행
                    lastBotScoreUpdateAt = now; // 다음 시도 방지
                }
            }
            */

            // Handle user timeouts and disconnections (타임아웃 추가)
            const onlineUserIdsBeforeTimeoutCheck = Object.keys(volatileState.userConnections);
            for (const userId of onlineUserIdsBeforeTimeoutCheck) {
                try {
                    // Re-check if user is still connected, as they might have been removed by a previous iteration
                    if (!volatileState.userConnections[userId]) continue;

                    // 사용자 조회에 타임아웃 추가 (2초)
                    const userTimeout = new Promise<null>((resolve) => {
                        setTimeout(() => resolve(null), 2000);
                    });
                    const user = await Promise.race([
                        db.getUser(userId),
                        userTimeout
                    ]) as types.User | null;
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
                                    // 도전의 탑, 싱글플레이, AI 게임에서는 연결 끊김 시 게임 삭제
                                    const isAiGame = activeGame.isSinglePlayer || activeGame.gameCategory === 'tower' || activeGame.isAiGame;
                                    if (isAiGame) {
                                        console.log(`[Disconnect] Deleting AI game ${activeGame.id} for user ${userId} due to disconnect`);
                                        
                                        // 사용자 상태에서 gameId 제거
                                        if (volatileState.userStatuses[userId]) {
                                            delete volatileState.userStatuses[userId].gameId;
                                            volatileState.userStatuses[userId].status = types.UserStatus.Waiting;
                                        }
                                        
                                        // AI 세션 정리
                                        clearAiSession(activeGame.id);
                                        
                                        // 게임 삭제
                                        await db.deleteGame(activeGame.id);
                                        
                                        // 게임 삭제 브로드캐스트
                                        broadcast({ type: 'GAME_DELETED', payload: { gameId: activeGame.id } });
                                    } else {
                                        // 일반 AI 게임은 종료만 처리
                                        const winner = activeGame.blackPlayerId === userId ? types.Player.White : types.Player.Black;
                                        await endGame(activeGame, winner, 'disconnect');
                                    }
                                }
                            }
                        } else if (userStatus?.status === types.UserStatus.Waiting) {
                            // User was in waiting room, just remove connection, keep status for potential reconnect.
                            // This allows them to refresh without being kicked out of the user list.
                            delete volatileState.userConnections[userId];
                        }
                    }
                } catch (timeoutError: any) {
                    // 개별 사용자 타임아웃 처리 실패는 조용히 무시
                    console.warn(`[MainLoop] Timeout processing user ${userId} for timeout check:`, timeoutError?.message);
                }
            }
            
            // Cleanup expired negotiations - 에러 핸들링 추가
            try {
                for (const negId of Object.keys(volatileState.negotiations)) {
                    try {
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
                            try {
                                broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
                            } catch (broadcastError: any) {
                                console.warn(`[MainLoop] Error broadcasting negotiation update:`, broadcastError?.message);
                            }
                            
                            // USER_STATUS_UPDATE도 브로드캐스트하여 상태 변경을 확실히 전달
                            try {
                                broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
                            } catch (broadcastError: any) {
                                console.warn(`[MainLoop] Error broadcasting user status update:`, broadcastError?.message);
                            }
                        }
                    } catch (negError: any) {
                        console.warn(`[MainLoop] Error processing negotiation ${negId}:`, negError?.message);
                    }
                }
            } catch (negotiationCleanupError: any) {
                console.error('[MainLoop] Error in negotiation cleanup loop:', negotiationCleanupError?.message);
            }

            const onlineUserIds = Object.keys(volatileState.userConnections);
            let updatedGames: types.LiveGameSession[] = [];
            try {
                const updateGamesTimeout = new Promise<types.LiveGameSession[]>((resolve) => {
                    setTimeout(() => resolve(activeGames), 10000); // 10초 타임아웃
                });
                updatedGames = await Promise.race([
                    updateGameStates(activeGames, now),
                    updateGamesTimeout
                ]);
            } catch (error: any) {
                console.error('[MainLoop] Error in updateGameStates:', error?.message || error);
                updatedGames = activeGames; // 에러 발생 시 원본 게임 상태 유지
            }

            // Check for mutual disconnection - 에러 핸들링 추가
            const disconnectedGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                try {
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
                        try {
                            await db.saveGame(game);
                            clearAiSession(game.id);
                            disconnectedGamesToBroadcast[game.id] = game;
                        } catch (saveError: any) {
                            console.error(`[MainLoop] Failed to save disconnected game ${game.id}:`, saveError?.message);
                        }
                    }
                } catch (disconnectError: any) {
                    console.warn(`[MainLoop] Error checking disconnection for game ${game.id}:`, disconnectError?.message);
                }
            }
            
            // 연결 끊김으로 인한 게임 상태 변경 브로드캐스트 (게임 참가자에게만 전송) - 에러 핸들링 추가
            if (Object.keys(disconnectedGamesToBroadcast).length > 0) {
                try {
                    const { broadcastToGameParticipants } = await import('./socket.js');
                    for (const [gameId, game] of Object.entries(disconnectedGamesToBroadcast)) {
                        try {
                            broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                        } catch (broadcastError: any) {
                            console.warn(`[MainLoop] Error broadcasting disconnected game ${gameId}:`, broadcastError?.message);
                        }
                    }
                } catch (broadcastError: any) {
                    console.error('[MainLoop] Error in disconnected games broadcast:', broadcastError?.message);
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
            
            // 실시간 게임 상태 업데이트 브로드캐스트 (게임 참가자에게만 전송) - 에러 핸들링 추가
            // 무한 루프 방지: 실제로 변경된 게임만 브로드캐스트 (JSON 비교로 실제 변경 여부 확인)
            if (Object.keys(gamesToBroadcast).length > 0) {
                try {
                    const { broadcastToGameParticipants } = await import('./socket.js');
                    for (const [gameId, game] of Object.entries(gamesToBroadcast)) {
                        try {
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
                        } catch (gameBroadcastError: any) {
                            console.warn(`[MainLoop] Error broadcasting game ${gameId}:`, gameBroadcastError?.message);
                        }
                    }
                } catch (broadcastError: any) {
                    console.error('[MainLoop] Error in games broadcast:', broadcastError?.message);
                }
            }

            // Process any system messages generated by time-based events - 에러 핸들링 추가
            const systemMessageGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                try {
                    if (game.pendingSystemMessages && game.pendingSystemMessages.length > 0) {
                        if (!volatileState.gameChats[game.id]) {
                            volatileState.gameChats[game.id] = [];
                        }
                        volatileState.gameChats[game.id].push(...game.pendingSystemMessages);
                        game.pendingSystemMessages = [];
                        try {
                            await db.saveGame(game);
                            systemMessageGamesToBroadcast[game.id] = game;
                        } catch (saveError: any) {
                            console.warn(`[MainLoop] Failed to save game ${game.id} for system messages:`, saveError?.message);
                        }
                    }
                } catch (systemMsgError: any) {
                    console.warn(`[MainLoop] Error processing system messages for game ${game.id}:`, systemMsgError?.message);
                }
            }
            
            // 시스템 메시지로 인한 게임 상태 변경 브로드캐스트 (게임 참가자에게만 전송) - 에러 핸들링 추가
            if (Object.keys(systemMessageGamesToBroadcast).length > 0) {
                try {
                    const { broadcastToGameParticipants } = await import('./socket.js');
                    for (const [gameId, game] of Object.entries(systemMessageGamesToBroadcast)) {
                        try {
                            broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                        } catch (broadcastError: any) {
                            console.warn(`[MainLoop] Error broadcasting system message for game ${gameId}:`, broadcastError?.message);
                        }
                    }
                } catch (broadcastError: any) {
                    console.error('[MainLoop] Error in system message broadcast:', broadcastError?.message);
                }
            }

            // Handle post-game summary processing for all games that finished - 에러 핸들링 추가
            const summaryGamesToBroadcast: Record<string, types.LiveGameSession> = {};
            for (const game of updatedGames) {
                try {
                    // 타워 게임 종료 처리
                    if (game.gameCategory === 'tower' && (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') && !game.statsUpdated) {
                        try {
                            // 타워 게임은 클라이언트에서 실행되지만, 서버에서 종료 처리 필요
                            const { endGame } = await import('./summaryService.js');
                            if (game.winner !== undefined && game.winner !== null) {
                                await endGame(game, game.winner as Player, game.winReason || 'score');
                            }
                            summaryGamesToBroadcast[game.id] = game;
                        } catch (towerError: any) {
                            console.error(`[MainLoop] Error processing tower game summary for ${game.id}:`, towerError?.message);
                        }
                    }
                    // 일반 게임 종료 처리
                    const isPlayful = PLAYFUL_GAME_MODES.some(m => m.mode === game.mode);
                    const isStrategic = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
                    if (!game.isSinglePlayer && (isPlayful || isStrategic) && (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') && !game.statsUpdated) {
                        try {
                            await processGameSummary(game);
                            game.statsUpdated = true;
                            await db.saveGame(game);
                            summaryGamesToBroadcast[game.id] = game;
                        } catch (summaryError: any) {
                            console.error(`[MainLoop] Error processing game summary for ${game.id}:`, summaryError?.message);
                        }
                    }
                } catch (gameError: any) {
                    console.warn(`[MainLoop] Error processing game ${game.id} for summary:`, gameError?.message);
                }
            }
            
            // 게임 종료 요약 처리 후 브로드캐스트 (게임 참가자에게만 전송) - 에러 핸들링 추가
            if (Object.keys(summaryGamesToBroadcast).length > 0) {
                try {
                    const { broadcastToGameParticipants } = await import('./socket.js');
                    for (const [gameId, game] of Object.entries(summaryGamesToBroadcast)) {
                        try {
                            broadcastToGameParticipants(gameId, { type: 'GAME_UPDATE', payload: { [gameId]: game } }, game);
                        } catch (broadcastError: any) {
                            console.warn(`[MainLoop] Error broadcasting summary for game ${gameId}:`, broadcastError?.message);
                        }
                    }
                } catch (broadcastError: any) {
                    console.error('[MainLoop] Error in summary broadcast:', broadcastError?.message);
                }
            }
            
            // --- Game Room Garbage Collection for Ended Games ---
            let endedGames: types.LiveGameSession[] = [];
            try {
                const endedGamesTimeout = new Promise<types.LiveGameSession[]>((resolve) => {
                    setTimeout(() => resolve([]), 5000); // 5초 타임아웃
                });
                endedGames = await Promise.race([
                    db.getAllEndedGames(),
                    endedGamesTimeout
                ]);
            } catch (error: any) {
                console.error('[MainLoop] Failed to load ended games:', error?.message || error);
                endedGames = [];
            }

            for (const game of endedGames) {
                try {
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
                } catch (gcError: any) {
                    // 개별 게임 GC 실패는 조용히 무시
                    console.warn(`[MainLoop] Failed to GC game ${game.id}:`, gcError?.message);
                }
            }

                            } catch (e: any) {
                                console.error('[FATAL] Unhandled error in main loop:', e);
                                console.error('[FATAL] Error stack:', e?.stack);
                                console.error('[FATAL] Error details:', {
                                    message: e?.message,
                                    name: e?.name,
                                    code: e?.code
                                });
                                
                                // 메모리 부족 에러인 경우에만 프로세스 종료 (Railway가 재시작)
                                // 하지만 메인 루프는 계속 실행되도록 보장
                                if (e?.code === 'ENOMEM' || e?.message?.includes('out of memory')) {
                                    console.error('[FATAL] Out of memory error detected.');
                                    // 메모리 정리 시도
                                    try {
                                        const { cleanupExpiredCache } = await import('./gameCache.js');
                                        cleanupExpiredCache();
                                        if (global.gc) {
                                            global.gc();
                                        }
                                        console.log('[FATAL] Attempted memory cleanup after ENOMEM');
                                    } catch (cleanupError: any) {
                                        console.error('[FATAL] Failed to cleanup memory:', cleanupError);
                                    }
                                    
                                    // Railway 환경에서만 프로세스 종료 (재시작을 위해)
                                    // 하지만 메인 루프는 계속 실행되도록 보장
                                    if (process.env.RAILWAY_ENVIRONMENT) {
                                        // 프로세스 종료 전에 메인 루프가 계속 실행되도록 보장
                                        console.error('[FATAL] Exiting for Railway restart after memory cleanup.');
                                        // 약간의 지연 후 종료하여 로그가 기록되도록 함
                                        setTimeout(() => {
                                            process.exit(1);
                                        }, 1000);
                                    }
                                }
                                
                                // 다른 모든 에러는 치명적이지 않음 - 서버는 계속 실행
                                // Railway의 health check가 실패하면 자동 재시작됨
                            } finally {
                                isProcessingMainLoop = false;
                                // 에러 발생 시에도 다음 루프를 스케줄링 (서버가 계속 실행되도록)
                                // 에러 발생 시 지연 시간을 늘려서 서버 부하 감소
                                const nextDelay = 2000; // 2초로 증가
                                // 절대 실패하지 않도록 보호
                                try {
                                    scheduleMainLoop(nextDelay);
                                } catch (scheduleError: any) {
                                    console.error('[FATAL] Failed to schedule next main loop:', scheduleError);
                                    // 최후의 수단: 5초 후 다시 시도
                                    setTimeout(() => {
                                        try {
                                            scheduleMainLoop(1000);
                                        } catch (retryError: any) {
                                            console.error('[FATAL] Failed to retry schedule main loop:', retryError);
                                            // 계속 재시도
                                            setTimeout(() => scheduleMainLoop(1000), 5000);
                                        }
                                    }, 5000);
                                }
                            }
                    } catch (outerError: any) {
                        // 메인 루프 전체가 실패한 경우
                        console.error('[FATAL] Critical error in main loop wrapper:', outerError);
                        isProcessingMainLoop = false;
                        // 5초 후 재시도
                        setTimeout(() => {
                            try {
                                scheduleMainLoop(1000);
                            } catch (retryError: any) {
                                console.error('[FATAL] Failed to retry main loop after critical error:', retryError);
                                // 계속 재시도
                                setTimeout(() => scheduleMainLoop(1000), 5000);
                            }
                        }, 5000);
                    }
                })().catch((asyncError: any) => {
                    // async 함수 자체가 실패한 경우
                    console.error('[FATAL] Async wrapper failed in main loop:', asyncError);
                    isProcessingMainLoop = false;
                    // 5초 후 재시도
                    setTimeout(() => {
                        try {
                            scheduleMainLoop(1000);
                        } catch (retryError: any) {
                            console.error('[FATAL] Failed to retry main loop after async error:', retryError);
                            // 계속 재시도
                            setTimeout(() => scheduleMainLoop(1000), 5000);
                        }
                    }, 5000);
                });
            }, delay);
        } catch (scheduleError: any) {
            // setTimeout 자체가 실패한 경우 (거의 불가능하지만)
            console.error('[FATAL] Failed to schedule main loop:', scheduleError);
            // 5초 후 재시도
            setTimeout(() => {
                try {
                    scheduleMainLoop(1000);
                } catch (retryError: any) {
                    console.error('[FATAL] Failed to retry schedule after setTimeout error:', retryError);
                    // 계속 재시도
                    setTimeout(() => scheduleMainLoop(1000), 5000);
                }
            }, 5000);
        }
    };

    // --- Main Game Loop ---
    // 절대 실패하지 않도록 보호
    try {
        scheduleMainLoop(1000);
        console.log('[Server] Main game loop scheduled successfully');
    } catch (error: any) {
        console.error('[Server] CRITICAL: Failed to schedule main loop:', error);
        // 5초 후 재시도
        setTimeout(() => {
            try {
                scheduleMainLoop(1000);
                console.log('[Server] Main game loop scheduled successfully (retry)');
            } catch (retryError: any) {
                console.error('[Server] CRITICAL: Failed to schedule main loop (retry):', retryError);
                // 계속 재시도
                setInterval(() => {
                    try {
                        scheduleMainLoop(1000);
                    } catch (e: any) {
                        console.error('[Server] CRITICAL: Failed to schedule main loop (continuous retry):', e);
                    }
                }, 10000);
            }
        }, 5000);
    }
    
    // 서버가 리스닝을 시작한 후 메인 루프 시작
    console.log('[Server] Starting main game loop...');
    try {
        scheduleMainLoop(1000);
        console.log('[Server] Main game loop scheduled successfully');
    } catch (error) {
        console.error('[Server] Failed to start main game loop:', error);
        // 메인 루프 시작 실패는 치명적이지 않음 (서버는 계속 실행)
    }
    
    // --- API Endpoints ---
    // Health check endpoint는 server 생성 직후에 정의됨 (위 참조)

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
                
                // cache가 null이거나 undefined인 경우 빈 캐시로 초기화
                if (!cache) {
                    console.warn('[API/Ranking] Cache is null or undefined, using empty cache');
                    cache = {
                        strategic: [],
                        playful: [],
                        championship: [],
                        combat: [],
                        manner: [],
                        strategicSeason: [],
                        playfulSeason: [],
                        timestamp: Date.now()
                    };
                }
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
                        rankings = Array.isArray(cache?.strategicSeason) ? cache.strategicSeason : [];
                        break;
                    case 'playful':
                        rankings = Array.isArray(cache?.playfulSeason) ? cache.playfulSeason : [];
                        break;
                    default:
                        // 시즌 랭킹은 strategic/playful만 지원
                        return res.status(400).json({ error: 'Season ranking only available for strategic/playful' });
                }
            } else {
                // 누적 랭킹 (기본)
                switch (type) {
                    case 'strategic':
                        rankings = Array.isArray(cache?.strategic) ? cache.strategic : [];
                        break;
                    case 'playful':
                        rankings = Array.isArray(cache?.playful) ? cache.playful : [];
                        break;
                    case 'championship':
                        rankings = Array.isArray(cache?.championship) ? cache.championship : [];
                        break;
                    case 'combat':
                        rankings = Array.isArray(cache?.combat) ? cache.combat : [];
                        break;
                    case 'manner':
                        rankings = Array.isArray(cache?.manner) ? cache.manner : [];
                        break;
                    default:
                        return res.status(400).json({ error: 'Invalid ranking type' });
                }
            }

            // 페이지네이션 적용
            if (limitNum && Array.isArray(rankings)) {
                rankings = rankings.slice(offsetNum, offsetNum + limitNum);
            }

            const cacheKey = isSeason ? `${type}Season` : type;
            const cacheValue = cache?.[cacheKey as keyof typeof cache];
            const total = Array.isArray(cacheValue) ? cacheValue.length : (Array.isArray(rankings) ? rankings.length : 0);
            const cached = cache?.timestamp && (Date.now() - (cache.timestamp || 0) < 60000); // 1분 이내면 캐시된 데이터
            
            res.json({
                type,
                rankings,
                total,
                cached: cached || false
            });
        } catch (error: any) {
            console.error('[API/Ranking] Error:', error);
            console.error('[API/Ranking] Error stack:', error?.stack);
            // 에러 발생 시 빈 배열 반환 (500 에러 방지)
            const { type } = req.params;
            return res.status(200).json({
                type,
                rankings: [],
                total: 0,
                cached: false,
                error: error?.message || 'Unknown error'
            });
            res.status(200).json({
                type: req.params.type,
                rankings: [],
                total: 0,
                cached: false,
                error: 'Failed to fetch rankings'
            });
        }
    });

    // 도전의 탑 랭킹 API
    app.get('/api/ranking/tower', async (req, res) => {
        try {
            const allUsers = await db.getAllUsers({ includeEquipment: false, includeInventory: false });
            
            // 1층 이상 클리어한 사람만 필터링
            const eligibleUsers = allUsers
                .filter(user => {
                    const towerFloor = (user as any).towerFloor ?? 0;
                    return towerFloor > 0;
                })
                .map(user => ({
                    id: user.id,
                    nickname: user.nickname,
                    avatarId: user.avatarId,
                    borderId: user.borderId,
                    towerFloor: (user as any).towerFloor ?? 0,
                    lastTowerClearTime: (user as any).lastTowerClearTime ?? Infinity
                }));
            
            // 정렬: 층수 높은 순, 같은 층이면 먼저 클리어한 순 (lastTowerClearTime이 작을수록 먼저)
            const sortedUsers = eligibleUsers.sort((a, b) => {
                if (a.towerFloor !== b.towerFloor) {
                    return b.towerFloor - a.towerFloor; // 층수 높은 순
                }
                // 같은 층이면 먼저 클리어한 순
                return a.lastTowerClearTime - b.lastTowerClearTime;
            });
            
            // 랭킹 추가
            const rankings = sortedUsers.map((user, index) => ({
                ...user,
                rank: index + 1
            }));
            
            res.json({
                type: 'tower',
                rankings,
                total: rankings.length,
                cached: false
            });
        } catch (error: any) {
            console.error('[API/Ranking/Tower] Error:', error);
            res.status(200).json({
                type: 'tower',
                rankings: [],
                total: 0,
                cached: false,
                error: 'Failed to fetch tower rankings'
            });
        }
    });

    app.post('/api/auth/register', async (req, res) => {
        try {
            // 데이터베이스 연결 상태 확인
            const dbConnected = await db.isDatabaseConnected();
            if (!dbConnected) {
                console.error('[/api/auth/register] Database not connected');
                return res.status(503).json({ 
                    message: '데이터베이스 연결이 되지 않았습니다. 잠시 후 다시 시도해주세요.' 
                });
            }
            
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
    
            // UserCredential 테이블에서 username 중복 확인
            const existingByUsername = await db.getUserCredentials(trimmedUsername);
            if (existingByUsername) {
                return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
            }
            
            // User 테이블에서 username 필드로 직접 확인 (Prisma에서 username은 unique)
            // Railway 최적화: equipment/inventory 없이 사용자 목록만 로드
            try {
                const { listUsers } = await import('./prisma/userService.js');
                const allUsers = await listUsers({ includeEquipment: false, includeInventory: false });
                const existingUserByUsername = allUsers.find(u => u.username === trimmedUsername);
                if (existingUserByUsername) {
                    return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
                }
            } catch (checkError: any) {
                // 체크 실패해도 계속 진행 (Prisma UNIQUE 제약조건이 나중에 잡아줄 것)
                console.warn('[/api/auth/register] Failed to check username in User table:', checkError?.message);
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
            console.log('[/api/auth/register] Creating default user...');
            let newUser = createDefaultUser(`user-${randomUUID()}`, trimmedUsername, tempNickname, false);
            // newUser.email = trimmedEmail; // User 타입에 email 속성이 없으므로 주석 처리

            console.log('[/api/auth/register] Resetting and generating quests...');
            newUser = await resetAndGenerateQuests(newUser);
    
            console.log('[/api/auth/register] Creating user in database...');
            try {
                await db.createUser(newUser);
                console.log('[/api/auth/register] User created successfully:', newUser.id);
            } catch (createUserError: any) {
                console.error('[/api/auth/register] Failed to create user:', createUserError);
                console.error('[/api/auth/register] Create user error details:', {
                    message: createUserError?.message,
                    code: createUserError?.code,
                    stack: createUserError?.stack
                });
                
                // Prisma UNIQUE 제약조건 위반 에러 처리 (P2002)
                if (createUserError?.code === 'P2002') {
                    const target = createUserError?.meta?.target;
                    if (Array.isArray(target) && target.includes('username')) {
                        return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
                    }
                    if (Array.isArray(target) && target.includes('nickname')) {
                        return res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });
                    }
                    if (Array.isArray(target) && target.includes('email')) {
                        return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
                    }
                    return res.status(409).json({ message: '이미 사용 중인 정보가 있습니다.' });
                }
                
                throw createUserError;
            }
            
            // 비밀번호 해싱
            console.log('[/api/auth/register] Hashing password...');
            const passwordHash = await hashPassword(trimmedPassword);
            console.log('[/api/auth/register] Creating user credentials...');
            try {
                await db.createUserCredentials(trimmedUsername, passwordHash, newUser.id);
                console.log('[/api/auth/register] User credentials created successfully');
            } catch (createCredsError: any) {
                console.error('[/api/auth/register] Failed to create user credentials:', createCredsError);
                console.error('[/api/auth/register] Create credentials error details:', {
                    message: createCredsError?.message,
                    code: createCredsError?.code,
                    stack: createCredsError?.stack
                });
                // 사용자는 생성되었지만 인증 정보 생성 실패 - 사용자 삭제 시도
                try {
                    await db.deleteUser(newUser.id);
                    console.log('[/api/auth/register] Rolled back: deleted user after credentials creation failure');
                } catch (rollbackError: any) {
                    console.error('[/api/auth/register] Failed to rollback user creation:', rollbackError);
                }
                throw createCredsError;
            }
    
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
            console.error('[/api/auth/register] Registration error:', e);
            console.error('[/api/auth/register] Error message:', e?.message);
            console.error('[/api/auth/register] Error stack:', e?.stack);
            console.error('[/api/auth/register] Error code:', e?.code);
            console.error('[/api/auth/register] Error details:', {
                name: e?.name,
                message: e?.message,
                code: e?.code,
                cause: e?.cause
            });
            
            // 개발 환경에서는 더 자세한 에러 정보 제공
            const errorMessage = process.env.NODE_ENV === 'development' 
                ? `서버 등록 중 오류가 발생했습니다: ${e?.message || 'Unknown error'}`
                : '서버 등록 중 오류가 발생했습니다.';
            
            res.status(500).json({ 
                message: errorMessage,
                error: process.env.NODE_ENV === 'development' ? {
                    name: e?.name,
                    message: e?.message,
                    code: e?.code
                } : undefined
            });
        }
    });

    app.post('/api/auth/login', async (req, res, next) => {
        console.log('[/api/auth/login] Received request');
        console.log('[/api/auth/login] Request body type:', typeof req.body, req.body ? '(present)' : '(missing)');
        let responseSent = false;
        
        // 데이터베이스 연결 상태 확인
        try {
            const dbConnected = await db.isDatabaseConnected();
            if (!dbConnected) {
                console.error('[/api/auth/login] Database not connected');
                console.error('[/api/auth/login] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
                if (!responseSent && !res.headersSent) {
                    responseSent = true;
                    return res.status(503).json({ 
                        message: '데이터베이스 연결이 되지 않았습니다. 잠시 후 다시 시도해주세요.',
                        error: process.env.NODE_ENV === 'development' ? 'Database connection check failed' : undefined
                    });
                }
                return;
            }
        } catch (dbCheckError: any) {
            console.error('[/api/auth/login] Database connection check failed:', dbCheckError);
            console.error('[/api/auth/login] Error details:', {
                message: dbCheckError?.message,
                code: dbCheckError?.code,
                stack: dbCheckError?.stack?.split('\n').slice(0, 3).join('\n')
            });
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                return res.status(503).json({ 
                    message: '데이터베이스 연결 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                    error: process.env.NODE_ENV === 'development' ? dbCheckError?.message : undefined
                });
            }
            return;
        }
        
        // 요청 타임아웃 설정 (30초)
        const requestTimeout = setTimeout(() => {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                console.error('[/api/auth/login] Request timeout after 30 seconds');
                try {
                    res.status(504).json({ message: '로그인 요청이 시간 초과되었습니다. 다시 시도해주세요.' });
                } catch (err) {
                    console.error('[/api/auth/login] Failed to send timeout response:', err);
                    if (!res.headersSent) {
                        res.status(504).end();
                    }
                }
            }
        }, 30000); // 30초 타임아웃
        
        // 요청이 종료되면 타임아웃 정리
        req.on('close', () => {
            clearTimeout(requestTimeout);
        });
        
        const sendResponse = (status: number, data: any) => {
            clearTimeout(requestTimeout);
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
            // Request body validation
            if (!req.body || typeof req.body !== 'object') {
                console.error('[/api/auth/login] Invalid request body:', req.body);
                console.error('[/api/auth/login] Request headers:', req.headers['content-type']);
                sendResponse(400, { message: '잘못된 요청 형식입니다.' });
                return;
            }
            
            const { username, password } = req.body;
            if (!username || !password) {
                console.error('[/api/auth/login] Missing username or password:', { username: !!username, password: !!password });
                sendResponse(400, { message: '아이디와 비밀번호를 모두 입력해주세요.' });
                return;
            }
            
            console.log('[/api/auth/login] Attempting to get user credentials for:', username);
            // 데이터베이스 조회에 타임아웃 추가 (3초)
            let credentials: { username: string; passwordHash: string; userId: string } | null = null;
            try {
                const credentialsTimeout = new Promise<null>((_, reject) => 
                    setTimeout(() => reject(new Error('getUserCredentials timeout')), 3000)
                );
                credentials = await Promise.race([
                    db.getUserCredentials(username),
                    credentialsTimeout
                ]);
                
                if (credentials) {
                    console.log('[/api/auth/login] Credentials found for username:', username);
                } else {
                    console.log('[/api/auth/login] No credentials found for username. Attempting to get user by nickname:', username);
                    const nicknameTimeout = new Promise<null>((_, reject) => 
                        setTimeout(() => reject(new Error('getUserByNickname timeout')), 3000)
                    );
                    const userByNickname = await Promise.race([
                        db.getUserByNickname(username),
                        nicknameTimeout
                    ]) as any;
                    
                    if (userByNickname) {
                        console.log('[/api/auth/login] User found by nickname. Getting credentials by userId:', userByNickname.id);
                        const userIdTimeout = new Promise<null>((_, reject) => 
                            setTimeout(() => reject(new Error('getUserCredentialsByUserId timeout')), 3000)
                        );
                        credentials = await Promise.race([
                            db.getUserCredentialsByUserId(userByNickname.id),
                            userIdTimeout
                        ]);
                        
                        if (credentials) {
                            console.log('[/api/auth/login] Credentials found by userId for nickname:', username);
                        } else {
                            console.log('[/api/auth/login] No credentials found by userId for nickname:', username);
                        }
                    } else {
                        console.log('[/api/auth/login] No user found by nickname:', username);
                    }
                }
            } catch (dbError: any) {
                console.error('[/api/auth/login] Database query failed or timed out:', dbError?.message);
                // 데이터베이스 조회 실패 시 인증 실패로 처리
                sendResponse(500, { message: '데이터베이스 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
                return;
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
            // 사용자 조회에 타임아웃 추가 (10초 - 데이터베이스 연결이 느릴 수 있음)
            // equipment/inventory는 제외하여 빠르게 조회
            // 재시도 로직 추가 (데이터베이스 연결이 불안정할 수 있음)
            let user: types.User | null = null;
            let getUserAttempts = 0;
            const maxGetUserAttempts = 3;
            let getUserError: any = null;
            
            while (getUserAttempts < maxGetUserAttempts) {
                try {
                    getUserAttempts++;
                    if (getUserAttempts > 1) {
                        console.log(`[/api/auth/login] Retrying getUser (attempt ${getUserAttempts}/${maxGetUserAttempts})...`);
                        // 재시도 전 짧은 대기 (지수 백오프)
                        await new Promise(resolve => setTimeout(resolve, 500 * getUserAttempts));
                    }
                    
                    const getUserTimeout = new Promise<null>((_, reject) => 
                        setTimeout(() => reject(new Error('getUser timeout')), 10000)
                    );
                    const fetchedUser = await Promise.race([
                        db.getUser(credentials.userId, { includeEquipment: false, includeInventory: false }),
                        getUserTimeout
                    ]) as types.User | null;
                    
                    if (!fetchedUser) {
                        console.log('[/api/auth/login] User not found for userId:', credentials.userId);
                        sendResponse(404, { message: '사용자를 찾을 수 없습니다.' });
                        return;
                    }
                    user = fetchedUser;
                    console.log('[/api/auth/login] User details retrieved for userId:', credentials.userId);
                    getUserError = null; // 성공 시 에러 초기화
                    break; // 성공 시 루프 종료
                } catch (err: any) {
                    getUserError = err;
                    console.warn(`[/api/auth/login] getUser attempt ${getUserAttempts} failed:`, err?.message);
                    if (getUserAttempts >= maxGetUserAttempts) {
                        // 마지막 시도 실패
                        console.error('[/api/auth/login] getUser failed after all retries:', getUserError?.message);
                        sendResponse(500, { message: '사용자 정보 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
                        return;
                    }
                    // 다음 시도 계속
                }
            }
            
            if (getUserError || !user) {
                console.error('[/api/auth/login] getUser failed after retries:', getUserError?.message);
                sendResponse(500, { message: '사용자 정보 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
                return;
            }
            
            // TypeScript가 user가 null이 아님을 인식하도록 타입 단언
            // (위의 체크에서 이미 null이 아님을 확인했으므로 안전함)
            let userForLogin: types.User = user;

            const defaultBaseStats = createDefaultBaseStats();
            if (!userForLogin.baseStats) {
                userForLogin.baseStats = defaultBaseStats;
                await db.updateUser(userForLogin);
            } else {
                // Check if baseStats needs to be reset
                const coreStats = Object.values(types.CoreStat || {});
                if (coreStats.length > 0 && userForLogin && (
                    Object.keys(userForLogin.baseStats).length !== Object.keys(defaultBaseStats).length ||
                    !coreStats.every(stat => userForLogin && (userForLogin.baseStats as Record<types.CoreStat, number>)[stat] === 100)
                )) {
                    userForLogin.baseStats = defaultBaseStats;
                    await db.updateUser(userForLogin);
                }
            }
            
            const userBeforeUpdate = JSON.stringify(userForLogin);

            if (!userForLogin.ownedBorders?.includes('simple_black')) {
                if (!userForLogin.ownedBorders) userForLogin.ownedBorders = ['default'];
                userForLogin.ownedBorders.push('simple_black');
            }

            const hadInventoryBefore = Array.isArray(userForLogin.inventory) && userForLogin.inventory.length > 0;
            const hadEquipmentBefore = userForLogin.equipment && Object.keys(userForLogin.equipment).length > 0;

            // 무거운 작업들에 타임아웃 추가 (각 5초)
            let updatedUser = userForLogin;
            try {
                const questTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('resetAndGenerateQuests timeout')), 5000)
                );
                updatedUser = await Promise.race([
                    resetAndGenerateQuests(user),
                    questTimeout
                ]) as typeof user;
            } catch (questError: any) {
                console.warn('[/api/auth/login] resetAndGenerateQuests failed or timed out:', questError?.message);
                // 퀘스트 재설정 실패해도 로그인은 계속 진행
            }

            try {
                const leagueTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('processWeeklyLeagueUpdates timeout')), 5000)
                );
                updatedUser = await Promise.race([
                    processWeeklyLeagueUpdates(updatedUser),
                    leagueTimeout
                ]) as typeof updatedUser;
            } catch (leagueError: any) {
                console.warn('[/api/auth/login] processWeeklyLeagueUpdates failed or timed out:', leagueError?.message);
                // 리그 업데이트 실패해도 로그인은 계속 진행
            }

            try {
                const actionPointTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('regenerateActionPoints timeout')), 5000)
                );
                updatedUser = await Promise.race([
                    regenerateActionPoints(updatedUser),
                    actionPointTimeout
                ]) as typeof updatedUser;
            } catch (actionPointError: any) {
                console.warn('[/api/auth/login] regenerateActionPoints failed or timed out:', actionPointError?.message);
                // 액션 포인트 재생성 실패해도 로그인은 계속 진행
            }

            const hasInventoryNow = Array.isArray(updatedUser.inventory) && updatedUser.inventory.length > 0;
            const hasEquipmentNow = updatedUser.equipment && Object.keys(updatedUser.equipment).length > 0;

            if (hadInventoryBefore && !hasInventoryNow) {
                console.error(`[/api/auth/login] CRITICAL: Inventory vanished during login pipeline for user ${userForLogin.id}. Restoring previous inventory snapshot.`);
                updatedUser.inventory = JSON.parse(JSON.stringify(userForLogin.inventory));
            }
            if (hadEquipmentBefore && !hasEquipmentNow) {
                console.error(`[/api/auth/login] CRITICAL: Equipment vanished during login pipeline for user ${userForLogin.id}. Restoring previous equipment snapshot.`);
                updatedUser.equipment = JSON.parse(JSON.stringify(userForLogin.equipment));
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

            // 사용자 업데이트에 타임아웃 추가 (5초)
            if (userBeforeUpdate !== JSON.stringify(updatedUser) || statsMigrated || itemsUnequipped || presetsMigrated) {
                try {
                    const updateTimeout = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('updateUser timeout')), 5000)
                    );
                    await Promise.race([
                        db.updateUser(updatedUser),
                        updateTimeout
                    ]);
                    userForLogin = updatedUser;
                } catch (updateError: any) {
                    console.warn('[/api/auth/login] updateUser failed or timed out:', updateError?.message);
                    // 사용자 업데이트 실패해도 로그인은 계속 진행 (기존 userForLogin 사용)
                }
            }

            if (volatileState.userConnections[userForLogin.id]) {
                console.log(`[Auth] Concurrent login for ${userForLogin.nickname}. Terminating old session and establishing new one.`);
            }
            
            // 최적화: 사용자가 참여한 게임만 찾기 (전체 게임 목록 조회 대신)
            // volatileState에서 먼저 확인하고, 없으면 캐시 또는 DB에서 조회
            // 게임 조회에 타임아웃 추가 (3초)
            let activeGame: types.LiveGameSession | null = null;
            try {
                const gameTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('getActiveGame timeout')), 3000)
                );
                
                const gamePromise = (async () => {
                    const userStatus = volatileState.userStatuses[userForLogin.id];
                    if (userStatus?.gameId) {
                        // 캐시에서 먼저 확인
                        const { getCachedGame } = await import('./gameCache.js');
                        let game = await getCachedGame(userStatus.gameId);
                        
                        // 캐시에 없으면 DB에서 직접 조회
                        if (!game) {
                            const { getLiveGame } = await import('./db.js');
                            game = await getLiveGame(userStatus.gameId);
                        }
                        return game;
                    } else {
                        // volatileState에 게임 ID가 없으면 DB에서 사용자 ID로 검색 (최적화: 최대 100개만)
                        const { getLiveGameByPlayerId } = await import('./prisma/gameService.js');
                        return await getLiveGameByPlayerId(userForLogin.id);
                    }
                })();
                
                activeGame = await Promise.race([gamePromise, gameTimeout]) as types.LiveGameSession | null;
            } catch (gameError: any) {
                console.warn('[/api/auth/login] Failed to get active game for user:', gameError?.message);
                // 게임 조회 실패는 치명적이지 않으므로 계속 진행
            }
    
            // 게임 상태 업데이트에 타임아웃 추가 (3초)
            try {
                const gameStateTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('gameStateUpdate timeout')), 3000)
                );
                
                const gameStatePromise = (async () => {
                    if (activeGame) {
                        // 90초 내에 재접속한 경우 경기 재개
                        if (activeGame.disconnectionState?.disconnectedPlayerId === userForLogin.id) {
                            // 90초 내에 재접속했는지 확인
                            const now = Date.now();
                            const timeSinceDisconnect = now - activeGame.disconnectionState.timerStartedAt;
                            if (timeSinceDisconnect <= 90000) {
                                // 재접속 성공: disconnectionState 제거하고 경기 재개
                                activeGame.disconnectionState = null;
                                const otherPlayerId = activeGame.player1.id === userForLogin.id ? activeGame.player2.id : activeGame.player1.id;
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
                        volatileState.userStatuses[userForLogin.id] = { status: types.UserStatus.InGame, mode: activeGame.mode, gameId: activeGame.id };
                    } else {
                        volatileState.userStatuses[userForLogin.id] = { status: types.UserStatus.Online };
                    }
                })();
                
                await Promise.race([gameStatePromise, gameStateTimeout]);
            } catch (gameStateError: any) {
                console.warn('[/api/auth/login] Failed to update game state:', gameStateError?.message);
                // 게임 상태 업데이트 실패해도 기본 상태로 설정
                volatileState.userStatuses[userForLogin.id] = { status: types.UserStatus.Online };
            }
            
            const sanitizedUser = JSON.parse(JSON.stringify(userForLogin));
            sendResponse(200, { user: sanitizedUser });
        } catch (e: any) {
            clearTimeout(requestTimeout);
            console.error('[/api/auth/login] Login error:', e);
            console.error('[/api/auth/login] Error stack:', e?.stack);
            console.error('[/api/auth/login] Error message:', e?.message);
            console.error('[/api/auth/login] Error code:', e?.code);
            console.error('[/api/auth/login] Error name:', e?.name);
            
            // 데이터베이스 연결 오류인 경우 더 명확한 메시지
            const isDbError = e?.code?.startsWith('P') || 
                            e?.message?.includes('database') || 
                            e?.message?.includes('connection') || 
                            e?.message?.includes('timeout') ||
                            e?.code === 'ECONNREFUSED';
            
            if (!responseSent && !res.headersSent) {
                try {
                    const errorMessage = isDbError 
                        ? '데이터베이스 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
                        : '서버 로그인 처리 중 오류가 발생했습니다.';
                    
                    responseSent = true;
                    res.status(500).json({ 
                        message: errorMessage,
                        error: process.env.NODE_ENV === 'development' ? e?.message : undefined,
                        errorCode: process.env.NODE_ENV === 'development' ? e?.code : undefined
                    });
                } catch (sendError: any) {
                    console.error('[/api/auth/login] Failed to send error response:', sendError);
                    // Express 전역 에러 핸들러로 전달
                    if (!res.headersSent) {
                        next(e);
                    }
                }
            } else {
                console.error('[/api/auth/login] Response already sent, cannot send error response');
                // Express 전역 에러 핸들러로 전달
                if (!res.headersSent) {
                    next(e);
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
            
            // 공개 정보 반환 (장비 정보 포함, 인벤토리는 제외하여 빠르게)
            // 장비 정보는 작은 데이터(약 1-2KB)이므로 포함해도 데이터 사용량 증가가 미미함
            const user = await db.getUser(userId, { includeEquipment: true, includeInventory: false });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // 공개 정보 반환 (장비 정보 포함)
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
                equipment: user.equipment || {}, // 장비 정보 포함
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

    // KataGo 분석 API 엔드포인트 (로컬 프로세스를 사용)
    app.post('/api/katago/analyze', async (req, res) => {
        try {
            const query = req.body;
            if (!query || !query.id) {
                return res.status(400).json({ error: 'Invalid query: missing id' });
            }

            // HTTP API 모드일 때는 이 엔드포인트를 사용하지 않음 (순환 참조 방지)
            const useHttpApi = !!(process.env.KATAGO_API_URL && process.env.KATAGO_API_URL.trim() !== '');
            if (useHttpApi) {
                const errorMsg = 'This server is configured to use HTTP API mode. Please use the external KataGo API instead of the local process endpoint.';
                console.error(`[KataGo API] ${errorMsg}`);
                return res.status(503).json({ error: errorMsg });
            }

            // 로컬 KataGo 프로세스를 사용하여 분석 수행
            const { getKataGoManager } = await import('./kataGoService.js');
            const manager = getKataGoManager();
            const response = await manager.query(query);
            
            res.json(response);
        } catch (error: any) {
            console.error('[KataGo API] Error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    });

    app.post('/api/action', async (req, res) => {
        const startTime = Date.now();
        // 요청 타임아웃 설정 (25초)
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                console.error(`[/api/action] Request timeout after 25s:`, { userId: req.body?.userId, type: req.body?.type });
                res.status(504).json({ error: 'Request timeout' });
            }
        }, 25000);
        
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
                 clearTimeout(timeout);
                 if (result.error) return res.status(400).json({ message: result.error });
                 return res.status(200).json({ success: true, ...result.clientResponse });
            }

            if (!userId) {
                clearTimeout(timeout);
                return res.status(401).json({ message: '인증 정보가 없습니다.' });
            }

            const getUserStartTime = Date.now();
            // 캐시를 우선 사용하여 DB 쿼리 최소화 (Railway 네트워크 지연 대응)
            const { getCachedUser } = await import('./gameCache.js');
            const user = await getCachedUser(userId);
            const getUserDuration = Date.now() - getUserStartTime;
            
            if (!user) {
                delete volatileState.userConnections[userId];
                clearTimeout(timeout);
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
                clearTimeout(timeout);
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
            clearTimeout(timeout);
            res.status(200).json({ success: true, ...result.clientResponse });
        } catch (e: any) {
            clearTimeout(timeout);
            console.error(`[API] Action error for ${req.body?.type}:`, e);
            console.error(`[API] Error stack:`, e.stack);
            console.error(`[API] Error details:`, {
                message: e.message,
                name: e.name,
                code: e.code,
                userId: req.body?.userId,
                payload: req.body?.payload
            });
            if (!res.headersSent) {
                res.status(500).json({ 
                    message: '요청 처리 중 오류가 발생했습니다.',
                    error: process.env.NODE_ENV === 'development' ? e.message : undefined
                });
            }
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
    
    // 관리자용 사용자 목록 조회 엔드포인트
    app.get('/api/admin/users', async (req, res) => {
        try {
            // 세션 확인 (기존 로그인 엔드포인트와 동일한 방식 사용)
            const sessionId = req.cookies?.sessionId;
            if (!sessionId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            
            // 세션 ID에서 사용자 ID 추출 (세션 ID 형식: userId-timestamp-random)
            // 또는 userConnections에서 역으로 찾기
            let userId: string | null = null;
            
            // 세션 ID가 userId를 포함하는 형식인 경우
            if (sessionId.includes('-')) {
                const parts = sessionId.split('-');
                if (parts.length >= 1) {
                    userId = parts[0];
                }
            } else {
                // 세션 ID가 직접 userId인 경우
                userId = sessionId;
            }
            
            // userConnections에서 확인
            if (!userId || !volatileState.userConnections[userId]) {
                // 세션 ID가 userId가 아닌 경우, userConnections를 순회하여 찾기
                // (일반적으로는 세션 ID가 userId를 포함하므로 이 경우는 드뭄)
                for (const [uid, connectionCount] of Object.entries(volatileState.userConnections)) {
                    if (connectionCount > 0) {
                        // 간단한 검증: 세션 ID에 userId가 포함되어 있는지 확인
                        if (sessionId.includes(uid)) {
                            userId = uid;
                            break;
                        }
                    }
                }
            }
            
            if (!userId) {
                return res.status(401).json({ error: 'Invalid session' });
            }
            
            const user = await db.getUser(userId);
            if (!user || !user.isAdmin) {
                return res.status(403).json({ error: 'Forbidden: Admin access required' });
            }
            
            // 사용자 목록 조회 (equipment/inventory 제외하여 빠르게)
            const users = await db.getAllUsers({ includeEquipment: false, includeInventory: false });
            
            res.json({ 
                users,
                count: users.length
            });
        } catch (error: any) {
            console.error('[Admin] Error getting users list:', error);
            res.status(500).json({ error: error.message });
        }
    });
    
    // KataGo 시작 엔드포인트 (관리자 전용)
    app.post('/api/admin/katago-start', async (req, res) => {
        try {
            const { getKataGoManager, initializeKataGo } = await import('./kataGoService.js');
            const manager = getKataGoManager();
            
            // HTTP API 모드인 경우 시작 불가
            const USE_HTTP_API = !!(process.env.KATAGO_API_URL && process.env.KATAGO_API_URL.trim() !== '');
            if (USE_HTTP_API) {
                return res.status(400).json({ 
                    error: 'KataGo is configured to use HTTP API mode. Local process cannot be started.',
                    message: 'HTTP API 모드에서는 로컬 KataGo 프로세스를 시작할 수 없습니다.'
                });
            }
            
            // 이미 실행 중이면 에러 반환
            const processRunning = manager && (manager as any).process && !(manager as any).process.killed;
            if (processRunning) {
                return res.status(400).json({ 
                    error: 'KataGo is already running.',
                    message: 'KataGo가 이미 실행 중입니다.'
                });
            }
            
            // 시작 중이면 에러 반환
            const isStarting = (manager as any).isStarting || false;
            if (isStarting) {
                return res.status(400).json({ 
                    error: 'KataGo is already starting.',
                    message: 'KataGo가 이미 시작 중입니다.'
                });
            }
            
            console.log('[Admin] Starting KataGo engine...');
            
            // KataGo 초기화 시작 (비동기로 처리)
            initializeKataGo().then(() => {
                console.log('[Admin] KataGo engine started successfully');
            }).catch((error: any) => {
                console.error('[Admin] Failed to start KataGo engine:', error);
            });
            
            res.json({ 
                success: true,
                message: 'KataGo 엔진 시작을 요청했습니다. 상태를 확인하려면 새로고침 버튼을 클릭하세요.'
            });
        } catch (error: any) {
            console.error('[Admin] Error starting KataGo:', error);
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
        
        // 정적 파일 요청인 경우 404를 조용히 처리 (로깅 최소화)
        if (req.path.startsWith('/assets/') || 
            req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i)) {
            // express.static이 이미 처리했지만 파일이 없는 경우
            // 개발 환경에서만 로깅 (프로덕션에서는 로그 스팸 방지)
            if (process.env.NODE_ENV === 'development') {
                console.warn(`[Static] File not found: ${req.path}`);
            }
            return res.status(404).json({ message: 'Static file not found' });
        }
        
        // Serve index.html for SPA routing
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const distPath = path.join(__dirname, '..', 'dist');
        const indexPath = path.join(distPath, 'index.html');
        
        // index.html 존재 여부 확인
        const fs = require('fs');
        if (!fs.existsSync(indexPath)) {
            console.error(`[SPA] index.html not found at ${indexPath}`);
            return res.status(500).json({ message: 'Frontend not found. Please rebuild the application.' });
        }
        
        res.sendFile(indexPath, (err) => {
            if (err) {
                console.error('[SPA] Error serving index.html:', err);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Frontend not found' });
                }
            }
        });
    });

    // Express 전역 에러 핸들러 (모든 라우트 정의 후에 추가)
    // 처리되지 않은 에러를 잡아서 500 응답 반환
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('[Express Error Handler] Unhandled error:', err);
        console.error('[Express Error Handler] Request path:', req.path);
        console.error('[Express Error Handler] Request method:', req.method);
        console.error('[Express Error Handler] Error stack:', err?.stack);
        
        // 응답이 이미 전송된 경우 next() 호출
        if (res.headersSent) {
            return next(err);
        }
        
        // 데이터베이스 연결 오류인 경우
        const isDbError = err?.code?.startsWith('P') || 
                         err?.message?.includes('database') || 
                         err?.message?.includes('connection') || 
                         err?.message?.includes('timeout') ||
                         err?.code === 'ECONNREFUSED';
        
        const statusCode = err?.statusCode || err?.status || 500;
        const errorMessage = isDbError 
            ? '데이터베이스 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
            : (err?.message || '서버 오류가 발생했습니다.');
        
        res.status(statusCode).json({
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? err?.message : undefined,
            errorCode: process.env.NODE_ENV === 'development' ? err?.code : undefined
        });
    });

    // 404 핸들러 (모든 라우트와 에러 핸들러 이후)
    app.use((req: express.Request, res: express.Response) => {
        // API 요청인 경우 JSON 응답
        if (req.path.startsWith('/api/')) {
            res.status(404).json({ message: 'API endpoint not found' });
        } else {
            // 정적 파일 요청은 위의 SPA 핸들러에서 처리됨
            res.status(404).json({ message: 'Not found' });
        }
    });

};

// 전역 에러 핸들러 추가 (처리되지 않은 Promise rejection 및 예외 처리)
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('[Server] Unhandled Rejection at:', promise);
    console.error('[Server] Reason:', reason);
    if (reason instanceof Error) {
        console.error('[Server] Error stack:', reason.stack);
    }
    
    // 메모리 부족 에러인 경우 프로세스 종료 (Railway가 재시작)
    if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 'ENOMEM') {
        console.error('[Server] Out of memory error detected. Exiting for Railway restart.');
        process.exit(1);
    }
    
    // 데이터베이스 연결 에러는 치명적이지 않음 (서버는 계속 실행)
    const isDbError = reason?.code?.startsWith('P') || 
                     reason?.message?.includes('database') || 
                     reason?.message?.includes('connection');
    
    if (isDbError) {
        console.warn('[Server] Database error in unhandled rejection (non-fatal):', reason?.message);
        return; // 서버는 계속 실행
    }
    
    // Railway 환경에서는 프로세스를 종료하지 않고 로그만 남김
    // 메모리 부족 에러는 이미 위에서 처리됨
    if (process.env.RAILWAY_ENVIRONMENT) {
        // Railway에서는 자동 재시작되므로, 메모리 부족이 아닌 경우에는 계속 실행
        console.warn('[Server] Unhandled rejection in Railway environment (non-fatal). Server will continue.');
        // 프로세스를 종료하지 않음 - 서버는 계속 실행되어야 함
    } else {
        // 로컬 환경에서도 치명적이지 않은 에러는 계속 실행
        console.warn('[Server] Unhandled rejection (non-fatal). Server will continue.');
    }
});

process.on('uncaughtException', (error: Error) => {
    console.error('[Server] Uncaught Exception:', error);
    console.error('[Server] Stack trace:', error.stack);
    console.error('[Server] Error message:', error.message);
    console.error('[Server] Error name:', error.name);
    
    // 메모리 부족 에러인 경우 프로세스 종료 (Railway가 재시작)
    if ((error as any)?.code === 'ENOMEM' || error.message?.includes('out of memory')) {
        console.error('[Server] Out of memory error detected. Exiting for Railway restart.');
        process.exit(1);
    }
    
    // 데이터베이스 연결 에러는 치명적이지 않음
    const isDbError = (error as any)?.code?.startsWith('P') || 
                     error.message?.includes('database') || 
                     error.message?.includes('connection');
    
    if (isDbError) {
        console.warn('[Server] Database error in uncaught exception (non-fatal). Server will continue.');
        return; // 서버는 계속 실행
    }
    
    // Railway 환경에서는 치명적이지 않은 에러는 로깅만 하고 계속 실행
    // 프로세스를 종료하지 않음 (Railway가 재시작하는 것을 방지)
    if (process.env.RAILWAY_ENVIRONMENT) {
        console.error('[Server] Railway environment detected. Attempting to continue despite error...');
        // 프로세스를 종료하지 않음 - 서버는 계속 실행되어야 함
    } else {
        // 로컬 환경에서도 치명적이지 않은 에러는 계속 실행
        console.error('[Server] Attempting to continue despite error...');
    }
});

// 프로세스 종료 감지 및 로깅
process.on('exit', (code) => {
    console.error(`[Server] Process exiting with code: ${code}`);
    console.error(`[Server] Exit time: ${new Date().toISOString()}`);
});

process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received. This is normal for Railway deployments.');
});

process.on('SIGINT', () => {
    console.log('[Server] SIGINT received. This is normal for Railway deployments.');
});

// beforeExit 핸들러 제거 - 이 핸들러는 프로세스 종료를 방해할 수 있음
// Railway는 정상적인 종료 시그널(SIGTERM)을 보내므로 beforeExit 핸들러가 필요 없음

// 메모리 사용량 모니터링 (주기적으로 로그) - 프로덕션에서는 간격 증가
if (process.env.RAILWAY_ENVIRONMENT) {
    const memCheckInterval = process.env.NODE_ENV === 'production' ? 300000 : 60000; // 프로덕션: 5분, 개발: 1분
    setInterval(() => {
        const memUsage = process.memoryUsage();
        const memUsageMB = {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
        };
        // 프로덕션에서는 메모리 사용량이 높을 때만 로깅
        if (process.env.NODE_ENV === 'production') {
            if (memUsageMB.rss > 300) {
                console.log(`[Server] Memory usage: RSS=${memUsageMB.rss}MB, Heap=${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB`);
            }
        } else {
            console.log(`[Server] Memory usage: RSS=${memUsageMB.rss}MB, Heap=${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB`);
        }
        
        // 메모리 사용량이 너무 높으면 경고
        if (memUsageMB.rss > 500) {
            console.warn(`[Server] WARNING: High memory usage detected: ${memUsageMB.rss}MB`);
        }
    }, memCheckInterval);
}
// 메모리 사용량 모니터링은 메인 루프에서도 처리됨 (중복 방지)

// Start server with error handling
// 서버가 반드시 리스닝을 시작하도록 보장
// 실패해도 재시도
(async () => {
    let retryCount = 0;
    const maxRetries = 5;
    
    while (retryCount < maxRetries) {
        try {
            await startServer();
            console.log('[Server] Server started successfully');
            break; // 성공하면 루프 종료
        } catch (error: any) {
            retryCount++;
            console.error(`[Server] Fatal error during startup (attempt ${retryCount}/${maxRetries}):`, error);
            console.error('[Server] Stack trace:', error?.stack);
            console.error('[Server] Error message:', error?.message);
            console.error('[Server] Error code:', error?.code);
            
            // Railway 환경에서는 프로세스를 종료하지 않고 재시도
            if (process.env.RAILWAY_ENVIRONMENT) {
                if (retryCount < maxRetries) {
                    const retryDelay = Math.min(10000 * retryCount, 30000); // 최대 30초
                    console.error(`[Server] Railway environment detected. Will retry in ${retryDelay}ms (${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue; // 재시도
                } else {
                    console.error('[Server] Max retries reached. Server will continue running despite startup errors.');
                    // 프로세스를 종료하지 않음 - 서버는 계속 실행되어야 함
                    break;
                }
            } else {
                // 로컬 환경에서는 재시도 후 종료
                if (retryCount < maxRetries) {
                    const retryDelay = Math.min(10000 * retryCount, 30000); // 최대 30초
                    console.error(`[Server] Will retry in ${retryDelay}ms (${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue; // 재시도
                } else {
                    console.error('[Server] Max retries reached. Exiting...');
                    process.exit(1);
                }
            }
        }
    }
    
    // 서버가 시작되지 않았어도 프로세스는 계속 실행
    // Railway 환경에서는 헬스체크가 실패하면 자동 재시작됨
    console.log('[Server] Startup wrapper completed. Process will continue running.');
})();

// Keep-alive는 startServer 내부의 server.listen 콜백에서 이미 처리됨
// 여기서는 추가 keep-alive가 필요 없음