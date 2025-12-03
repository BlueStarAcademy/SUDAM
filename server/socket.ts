import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import * as db from './db.js';
import { volatileState } from './state.js';

let wss: WebSocketServer;
// WebSocket 연결과 userId 매핑 (대역폭 최적화를 위해 게임 참가자에게만 전송)
const wsUserIdMap = new Map<WebSocket, string>();

export const getWebSocketServer = (): WebSocketServer | undefined => {
    return wss;
};

export const createWebSocketServer = (server: Server) => {
    // 기존 WebSocketServer가 있으면 먼저 닫기
    if (wss) {
        console.log('[WebSocket] Closing existing WebSocketServer...');
        try {
            wss.clients.forEach(client => {
                try {
                    client.close();
                } catch (e) {
                    // 클라이언트 종료 중 에러는 무시
                }
            });
            wss.close(() => {
                console.log('[WebSocket] Existing WebSocketServer closed');
            });
        } catch (e) {
            console.error('[WebSocket] Error closing existing WebSocketServer:', e);
        }
    }

    // 서버가 이미 리스닝 중이어도 WebSocket 서버를 생성할 수 있도록 수정
    // WebSocketServer는 리스닝 중인 서버에도 연결할 수 있음
    try {
        wss = new WebSocketServer({ 
            server,
            perMessageDeflate: false, // 압축 비활성화로 연결 문제 해결 시도
            clientTracking: true,
            maxPayload: 100 * 1024 * 1024 // 100MB 최대 페이로드
            // maxConnections와 backlog는 ws 라이브러리에서 지원하지 않음
            // 대신 HTTP 서버 레벨에서 제어
        });
        console.log('[WebSocket] WebSocketServer created successfully');
    } catch (error: any) {
        console.error('[WebSocket] Failed to create WebSocketServer:', error);
        console.error('[WebSocket] Error code:', error?.code);
        console.error('[WebSocket] Error message:', error?.message);
        // WebSocket 서버 생성 실패해도 HTTP 서버는 계속 실행
        // Railway 환경에서는 프로세스를 종료하지 않음
        if (!process.env.RAILWAY_ENVIRONMENT) {
            throw error;
        }
        return;
    }

    wss.on('connection', async (ws: WebSocket, req) => {
        // 연결 처리 중 에러가 발생해도 서버가 크래시하지 않도록 보장
        try {
            let isClosed = false;
            
            ws.on('error', (error: Error) => {
                // ECONNABORTED는 일반적으로 클라이언트가 연결을 끊을 때 발생하는 정상적인 에러
                if (error.message && error.message.includes('ECONNABORTED')) {
                    // 조용히 처리 (로깅 생략)
                    isClosed = true;
                    return;
                }
                // 다른 에러는 로깅하지만 서버를 크래시시키지 않음
                console.error('[WebSocket] Connection error:', error.message || error);
                isClosed = true;
            });

        ws.on('close', (code, reason) => {
            // 정상적인 연결 종료는 로깅하지 않음 (코드 1001: Going Away)
            // 비정상적인 종료만 로깅하려면: if (code !== 1001) console.log('[WebSocket] Client disconnected:', { code, reason: reason.toString() });
            // userId 매핑 제거
            const userId = wsUserIdMap.get(ws);
            if (userId) {
                wsUserIdMap.delete(ws);
            }
            isClosed = true;
        });
        
        // 클라이언트로부터 메시지 수신 (userId 설정용)
        ws.on('message', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'AUTH' && message.userId) {
                    wsUserIdMap.set(ws, message.userId);
                }
            } catch (e) {
                // 무시 (다른 메시지 타입)
            }
        });

        // 연결 직후 빈 핑 메시지를 보내서 연결이 활성화되었는지 확인
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'CONNECTION_ESTABLISHED' }));
            }
        } catch (error) {
            console.error('[WebSocket] Error sending connection established:', error);
        }

        // 초기 상태를 비동기로 전송 (연결이 끊어지지 않도록)
        // 타임아웃 추가 (로컬 개발: 10초, 프로덕션: 30초)
        (async () => {
            const timeoutDuration = process.env.NODE_ENV === 'development' ? 10000 : 30000;
            const initTimeout = setTimeout(() => {
                console.warn('[WebSocket] Initial state load timeout');
                isClosed = true;
                clearTimeout(initTimeout);
                // 클라이언트에 타임아웃 에러 전송
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ 
                            type: 'ERROR', 
                            payload: { message: 'Initial state load timeout. Please refresh the page.' } 
                        }));
                    } catch (sendError) {
                        // 에러 전송 실패는 무시
                    }
                }
            }, timeoutDuration);
            
            try {
                // 연결 상태를 더 자주 체크하기 위한 헬퍼 함수
                const checkConnection = () => {
                    return !isClosed && ws.readyState === WebSocket.OPEN;
                };
                
                if (!checkConnection()) {
                    clearTimeout(initTimeout);
                    // 연결이 이미 끊어진 경우 조용히 반환
                    return;
                }
                
                // 초기 상태 로드 시작 로그 (로컬 개발 환경에서만)
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[WebSocket] Starting initial state load (timeout: ${timeoutDuration}ms)`);
                }
                
                // 성능 최적화: 온라인 사용자만 로드 (1000명 동시 사용자 대응)
                const onlineUserIds = Object.keys(volatileState.userStatuses);
                const onlineUsersData: Record<string, any> = {};
                
                // 1000명 동시 사용자 대응: 온라인 사용자만 개별 조회 (전체 조회 대신)
                // 최대 1000명까지 처리 가능하도록 증가
                const maxOnlineUsers = 1000;
                const limitedOnlineUserIds = onlineUserIds.slice(0, maxOnlineUsers);
                
                // 배치 처리로 최적화: 한 번에 50명씩 처리하여 데이터베이스 부하 분산
                const batchSize = 50;
                const batches: string[][] = [];
                for (let i = 0; i < limitedOnlineUserIds.length; i += batchSize) {
                    batches.push(limitedOnlineUserIds.slice(i, i + batchSize));
                }
                
                // 배치별로 순차 처리 (데이터베이스 연결 풀 부하 방지)
                for (const batch of batches) {
                    if (!checkConnection()) {
                        clearTimeout(initTimeout);
                        break; // 연결이 끊어지면 중단
                    }
                    
                    // 각 배치 내에서는 병렬 처리
                    const userLoadPromises = batch.map(async (userId) => {
                        try {
                            const userTimeout = new Promise((resolve, reject) => {
                                setTimeout(() => reject(new Error('getUser timeout')), 2000); // 2초로 증가
                            });
                            const user = await Promise.race([
                                db.getUser(userId, { includeEquipment: false, includeInventory: false }),
                                userTimeout
                            ]) as any;
                            
                            if (user) {
                                const nickname = user.nickname && user.nickname.trim().length > 0 ? user.nickname : user.username;
                                onlineUsersData[user.id] = {
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
                                    towerFloor: user.towerFloor,
                                    monthlyTowerFloor: (user as any).monthlyTowerFloor ?? 0
                                };
                            }
                        } catch (error) {
                            // 개별 사용자 조회 실패는 조용히 처리 (다음 사용자 계속 처리)
                            // 타임아웃이나 에러는 로깅하지 않음 (너무 많은 로그 방지)
                        }
                    });
                    
                    // 배치 내 병렬 처리
                    await Promise.allSettled(userLoadPromises);
                }
                
                // 데이터 로드 후 연결 상태 재확인
                if (!checkConnection()) {
                    // 연결이 끊어진 것은 정상적인 재연결 흐름의 일부이므로 조용히 처리
                    clearTimeout(initTimeout);
                    return;
                }
                
                const onlineUsers = onlineUserIds.map(userId => {
                    const user = onlineUsersData[userId];
                    const status = volatileState.userStatuses[userId];
                    return user ? { ...user, ...status } : undefined;
                }).filter(Boolean);
                
                // 게임 데이터만 로드 (1000명 동시 사용자 대응: 최대 200개 게임까지 로드)
                // 타임아웃 추가 (10초로 증가)
                let allGames: any[] = [];
                try {
                    const gamesTimeout = new Promise<any[]>((resolve) => {
                        setTimeout(() => resolve([]), 10000); // 10초로 증가
                    });
                    allGames = await Promise.race([
                        db.getAllActiveGames(),
                        gamesTimeout
                    ]);
                } catch (error) {
                    console.warn('[WebSocket] Failed to load games:', error);
                    allGames = [];
                }
                
                const liveGames: Record<string, any> = {};
                const singlePlayerGames: Record<string, any> = {};
                const towerGames: Record<string, any> = {};
                
                // 최대 200개 게임까지 처리 (1000명 동시 사용자 대응)
                const maxGames = 200;
                const limitedGames = allGames.slice(0, maxGames);
                
                for (const game of limitedGames) {
                    try {
                        const category = game.gameCategory || (game.isSinglePlayer ? 'singleplayer' : 'normal');
                        const optimizedGame = { ...game };
                        delete (optimizedGame as any).boardState; // 대역폭 절약
                        delete (optimizedGame as any).moveHistory; // 대역폭 절약 (100명 동시 사용자 대응)
                        
                        if (category === 'singleplayer') {
                            singlePlayerGames[game.id] = optimizedGame;
                        } else if (category === 'tower') {
                            towerGames[game.id] = optimizedGame;
                        } else {
                            liveGames[game.id] = optimizedGame;
                        }
                    } catch (error) {
                        // 개별 게임 처리 실패는 무시
                    }
                }
                
                // 나머지 데이터 로드 (KV store) - 타임아웃 추가 (5초로 증가)
                let adminLogs: any[] = [];
                let announcements: any[] = [];
                let globalOverrideAnnouncement: any = null;
                let gameModeAvailability: Record<string, boolean> = {};
                let announcementInterval = 3;
                let homeBoardPosts: any[] = [];
                let guilds: Record<string, any> = {};
                
                try {
                    const kvTimeout = new Promise((resolve) => {
                        setTimeout(() => resolve(null), 5000); // 5초로 증가
                    });
                    
                    const kvRepository = await import('./repositories/kvRepository.ts');
                    const kvPromises = [
                        kvRepository.getKV<any[]>('adminLogs').catch(() => []),
                        kvRepository.getKV<any[]>('announcements').catch(() => []),
                        kvRepository.getKV<any>('globalOverrideAnnouncement').catch(() => null),
                        kvRepository.getKV<Record<string, boolean>>('gameModeAvailability').catch(() => ({})),
                        kvRepository.getKV<number>('announcementInterval').catch(() => 3),
                        (await import('./db.js')).getAllHomeBoardPosts().catch(() => []),
                        kvRepository.getKV<Record<string, any>>('guilds').catch(() => ({}))
                    ];
                    
                    const kvResults = await Promise.race([
                        Promise.allSettled(kvPromises),
                        kvTimeout
                    ]) as any;
                    
                    if (kvResults && Array.isArray(kvResults)) {
                        adminLogs = kvResults[0]?.status === 'fulfilled' ? (kvResults[0].value || []) : [];
                        announcements = kvResults[1]?.status === 'fulfilled' ? (kvResults[1].value || []) : [];
                        globalOverrideAnnouncement = kvResults[2]?.status === 'fulfilled' ? kvResults[2].value : null;
                        gameModeAvailability = kvResults[3]?.status === 'fulfilled' ? (kvResults[3].value || {}) : {};
                        announcementInterval = kvResults[4]?.status === 'fulfilled' ? (kvResults[4].value || 3) : 3;
                        homeBoardPosts = kvResults[5]?.status === 'fulfilled' ? (kvResults[5].value || []) : [];
                        guilds = kvResults[6]?.status === 'fulfilled' ? (kvResults[6].value || {}) : {};
                    }
                } catch (error) {
                    console.warn('[WebSocket] Failed to load KV data:', error);
                    // 기본값 사용
                }
                
                const allData = {
                    users: onlineUsersData, // 온라인 사용자만 포함 (랭킹은 /api/ranking 엔드포인트 사용)
                    liveGames,
                    singlePlayerGames,
                    towerGames,
                    adminLogs,
                    announcements,
                    globalOverrideAnnouncement,
                    gameModeAvailability,
                    announcementInterval,
                    homeBoardPosts,
                    guilds
                };
                
                // 전송 전 최종 연결 상태 확인
                if (!checkConnection()) {
                    // 연결이 끊어진 경우 조용히 반환
                    clearTimeout(initTimeout);
                    return;
                }
                
                // 연결이 여전히 열려있는지 확인 후 전송
                if (!checkConnection()) {
                    clearTimeout(initTimeout);
                    return;
                }
                
                // INITIAL_STATE 최적화: 게임 데이터에서 boardState 제외하여 대역폭 절약
                const optimizedLiveGames: Record<string, any> = {};
                for (const [gameId, game] of Object.entries(allData.liveGames || {})) {
                    const optimizedGame = { ...game };
                    // boardState는 클라이언트에서 필요할 때만 요청하도록 제외
                    delete (optimizedGame as any).boardState;
                    optimizedLiveGames[gameId] = optimizedGame;
                }
                
                const optimizedSinglePlayerGames: Record<string, any> = {};
                for (const [gameId, game] of Object.entries(allData.singlePlayerGames || {})) {
                    const optimizedGame = { ...game };
                    delete (optimizedGame as any).boardState;
                    optimizedSinglePlayerGames[gameId] = optimizedGame;
                }
                
                const optimizedTowerGames: Record<string, any> = {};
                for (const [gameId, game] of Object.entries(allData.towerGames || {})) {
                    const optimizedGame = { ...game };
                    delete (optimizedGame as any).boardState;
                    optimizedTowerGames[gameId] = optimizedGame;
                }
                
                const payload = { 
                    ...allData,
                    liveGames: optimizedLiveGames,
                    singlePlayerGames: optimizedSinglePlayerGames,
                    towerGames: optimizedTowerGames,
                    onlineUsers,
                    negotiations: volatileState.negotiations,
                    waitingRoomChats: volatileState.waitingRoomChats,
                    gameChats: volatileState.gameChats,
                    userConnections: volatileState.userConnections,
                    userStatuses: volatileState.userStatuses,
                    userLastChatMessage: volatileState.userLastChatMessage,
                    guilds: allData.guilds || {}
                };
                
                try {
                    ws.send(JSON.stringify({ type: 'INITIAL_STATE', payload }));
                    // 성공적으로 전송했으므로 타임아웃 정리
                    clearTimeout(initTimeout);
                } catch (sendError) {
                    console.error('[WebSocket] Error sending message:', sendError);
                    isClosed = true;
                    clearTimeout(initTimeout);
                }
            } catch (error) {
                console.error('[WebSocket] Error sending initial state:', error);
                if (!isClosed && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Failed to load initial state' } }));
                    } catch (sendError) {
                        // 에러 메시지 전송 실패는 무시 (연결이 끊어진 경우)
                        isClosed = true;
                    }
                }
                clearTimeout(initTimeout);
            }
        })();
        } catch (connectionError: any) {
            // 연결 처리 중 에러가 발생해도 서버가 크래시하지 않도록 보장
            console.error('[WebSocket] Error in connection handler:', connectionError?.message || connectionError);
            console.error('[WebSocket] Error stack:', connectionError?.stack);
            console.error('[WebSocket] Error code:', connectionError?.code);
            
            // 메모리 부족 에러인 경우 프로세스 종료 (Railway가 재시작)
            if (connectionError?.code === 'ENOMEM' || connectionError?.message?.includes('out of memory')) {
                console.error('[WebSocket] Out of memory error detected. Exiting for Railway restart.');
                if (process.env.RAILWAY_ENVIRONMENT) {
                    process.exit(1);
                }
            }
            
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1011, 'Internal server error');
                }
            } catch (closeError) {
                // 연결 종료 실패는 무시
            }
        }
    });

    wss.on('error', (error) => {
        console.error('[WebSocket] Server error:', error);
    });

    console.log('[WebSocket] Server created');
};

// 게임 참가자에게만 GAME_UPDATE 전송 (대역폭 최적화)
export const broadcastToGameParticipants = (gameId: string, message: any, game: any) => {
    if (!wss || !game) return;
    const participantIds = new Set<string>();
    if (game.player1?.id) participantIds.add(game.player1.id);
    if (game.player2?.id) participantIds.add(game.player2.id);
    if (game.blackPlayerId) participantIds.add(game.blackPlayerId);
    if (game.whitePlayerId) participantIds.add(game.whitePlayerId);
    
    // 관전자도 포함 (userStatuses에서 spectating 상태인 사용자)
    Object.entries(volatileState.userStatuses).forEach(([userId, status]) => {
        if (status.status === 'spectating' && status.spectatingGameId === gameId) {
            participantIds.add(userId);
        }
    });
    
    // 최적화: 메시지 직렬화를 한 번만 수행
    const messageString = JSON.stringify(message);
    let sentCount = 0;
    let errorCount = 0;
    
    // 최적화: Array.from 대신 직접 순회 (메모리 효율)
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                const userId = wsUserIdMap.get(client);
                if (userId && participantIds.has(userId)) {
                    client.send(messageString, (err) => {
                        if (err) {
                            errorCount++;
                            console.error(`[WebSocket] Error sending to user ${userId}:`, err);
                        }
                    });
                    sentCount++;
                }
            } catch (error) {
                errorCount++;
                console.error('[WebSocket] Error in broadcastToGameParticipants:', error);
            }
        }
    }
    
    // 개발 환경에서만 로깅 (프로덕션 성능 향상)
    if (process.env.NODE_ENV === 'development' && sentCount > 0) {
        console.log(`[WebSocket] Sent GAME_UPDATE to ${sentCount} participants for game ${gameId}${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
    }
};

export const broadcast = (message: any) => {
    if (!wss) return;
    // 최적화: 메시지 직렬화를 한 번만 수행
    const messageString = JSON.stringify(message);
    let errorCount = 0;
    
    // 최적화: Array.from 대신 직접 순회 (메모리 효율)
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(messageString, (err) => {
                    if (err) {
                        errorCount++;
                        // 에러는 조용히 처리 (너무 많은 로그 방지)
                    }
                });
            } catch (error) {
                errorCount++;
            }
        }
    }
    
    // 에러가 많이 발생한 경우에만 로깅
    if (errorCount > 10 && process.env.NODE_ENV === 'development') {
        console.warn(`[WebSocket] Broadcast had ${errorCount} errors`);
    }
};

// 특정 사용자에게만 메시지를 보내는 함수
export const sendToUser = (userId: string, message: any) => {
    if (!wss) return;
    // 최적화: 메시지 직렬화를 한 번만 수행
    const messageString = JSON.stringify({ ...message, targetUserId: userId });
    
    // 최적화: Array.from 대신 직접 순회 (메모리 효율)
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                const clientUserId = wsUserIdMap.get(client);
                if (clientUserId === userId) {
                    client.send(messageString);
                    return; // 사용자 찾으면 즉시 반환 (불필요한 순회 방지)
                }
            } catch (error) {
                // 에러는 조용히 처리
            }
        }
    }
};

// USER_UPDATE 최적화: 변경된 필드만 전송 (대역폭 절약)
export const broadcastUserUpdate = (user: any, changedFields?: string[]) => {
    if (!wss) return;
    
    // 변경된 필드만 포함하는 최적화된 사용자 객체 생성
    const optimizedUser: any = {
        id: user.id,
        nickname: user.nickname,
        avatarId: user.avatarId,
        borderId: user.borderId,
        league: user.league,
        gold: user.gold,
        diamonds: user.diamonds,
        actionPoints: user.actionPoints,
        strategyLevel: user.strategyLevel,
        playfulLevel: user.playfulLevel,
        tournamentScore: user.tournamentScore,
    };
    
    // 변경된 필드가 지정된 경우에만 추가 필드 포함
    if (changedFields) {
        changedFields.forEach(field => {
            if (user[field] !== undefined) {
                // inventory는 크기가 클 수 있으므로 최적화
                if (field === 'inventory' && Array.isArray(user[field])) {
                    // inventory는 최대 50개 항목만 전송 (100명 동시 사용자 대응)
                    optimizedUser[field] = user[field].slice(0, 50);
                } else {
                    optimizedUser[field] = user[field];
                }
            }
        });
    } else {
        // 기본적으로 필요한 필드만 포함 (inventory, equipment, quests 등은 제외)
        if (user.stats) optimizedUser.stats = user.stats;
        if (user.baseStats) optimizedUser.baseStats = user.baseStats;
    }
    
    const message = { type: 'USER_UPDATE', payload: { [user.id]: optimizedUser } };
    // 최적화: 메시지 직렬화를 한 번만 수행
    const messageString = JSON.stringify(message);
    let sentCount = 0;
    let errorCount = 0;
    
    // 최적화: Array.from 대신 직접 순회 (메모리 효율)
    // 100명 동시 사용자 대응: 연결된 클라이언트만 전송
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(messageString, (err) => {
                    if (err) errorCount++;
                });
                sentCount++;
            } catch (error) {
                errorCount++;
            }
        }
    }
    
    // 에러가 많이 발생한 경우에만 로깅 (프로덕션에서는 조용히 처리)
    if (errorCount > 10 && process.env.NODE_ENV === 'development') {
        console.warn(`[WebSocket] broadcastUserUpdate had ${errorCount} errors (sent to ${sentCount} clients)`);
    }
};