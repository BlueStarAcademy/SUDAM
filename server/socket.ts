import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import * as db from './db.js';
import { volatileState } from './state.js';

let wss: WebSocketServer;
// WebSocket 연결과 userId 매핑 (대역폭 최적화를 위해 게임 참가자에게만 전송)
const wsUserIdMap = new Map<WebSocket, string>();

export const createWebSocketServer = (server: Server) => {
    // 기존 WebSocketServer가 있으면 먼저 닫기
    if (wss) {
        console.log('[WebSocket] Closing existing WebSocketServer...');
        wss.clients.forEach(client => {
            client.close();
        });
        wss.close(() => {
            console.log('[WebSocket] Existing WebSocketServer closed');
        });
    }

    // 서버가 이미 리스닝 중인지 확인
    if (server.listening) {
        console.error('[WebSocket] Cannot create WebSocketServer: HTTP server is already listening');
        return;
    }

    try {
        wss = new WebSocketServer({ 
            server,
            perMessageDeflate: false // 압축 비활성화로 연결 문제 해결 시도
        });
    } catch (error) {
        console.error('[WebSocket] Failed to create WebSocketServer:', error);
        throw error;
    }

    wss.on('connection', async (ws: WebSocket, req) => {
        
        let isClosed = false;
        
        ws.on('error', (error: Error) => {
            // ECONNABORTED는 일반적으로 클라이언트가 연결을 끊을 때 발생하는 정상적인 에러
            if (error.message && error.message.includes('ECONNABORTED')) {
                // 조용히 처리 (로깅 생략)
                isClosed = true;
                return;
            }
            console.error('[WebSocket] Connection error:', error);
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
        (async () => {
            try {
                // 연결 상태를 더 자주 체크하기 위한 헬퍼 함수
                const checkConnection = () => {
                    return !isClosed && ws.readyState === WebSocket.OPEN;
                };
                
                if (!checkConnection()) {
                    // 연결이 이미 끊어진 경우 조용히 반환
                    return;
                }
                
                // 성능 최적화: 전체 사용자 한 번에 로드 (캐시 활용, 개별 조회보다 빠름)
                const allUsers = await db.getAllUsers({ includeEquipment: false, includeInventory: false });
                const onlineUserIds = Object.keys(volatileState.userStatuses);
                const onlineUsersData: Record<string, any> = {};
                
                // 온라인 사용자만 필터링
                for (const user of allUsers) {
                    if (onlineUserIds.includes(user.id)) {
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
                }
                
                // 데이터 로드 후 연결 상태 재확인
                if (!checkConnection()) {
                    // 연결이 끊어진 것은 정상적인 재연결 흐름의 일부이므로 조용히 처리
                    return;
                }
                
                const onlineUsers = onlineUserIds.map(userId => {
                    const user = onlineUsersData[userId];
                    const status = volatileState.userStatuses[userId];
                    return user ? { ...user, ...status } : undefined;
                }).filter(Boolean);
                
                // 게임 데이터만 로드 (PVE 게임은 메모리에만 있으므로 DB 조회 최소화)
                const allGames = await db.getAllActiveGames();
                const liveGames: Record<string, any> = {};
                const singlePlayerGames: Record<string, any> = {};
                const towerGames: Record<string, any> = {};
                
                for (const game of allGames) {
                    const category = game.gameCategory || (game.isSinglePlayer ? 'singleplayer' : 'normal');
                    const optimizedGame = { ...game };
                    delete (optimizedGame as any).boardState; // 대역폭 절약
                    
                    if (category === 'singleplayer') {
                        singlePlayerGames[game.id] = optimizedGame;
                    } else if (category === 'tower') {
                        towerGames[game.id] = optimizedGame;
                    } else {
                        liveGames[game.id] = optimizedGame;
                    }
                }
                
                // 나머지 데이터 로드 (KV store)
                const kvRepository = await import('./repositories/kvRepository.ts');
                const adminLogs = await kvRepository.getKV<any[]>('adminLogs') || [];
                const announcements = await kvRepository.getKV<any[]>('announcements') || [];
                const globalOverrideAnnouncement = await kvRepository.getKV<any>('globalOverrideAnnouncement');
                const gameModeAvailability = await kvRepository.getKV<Record<string, boolean>>('gameModeAvailability') || {};
                const announcementInterval = await kvRepository.getKV<number>('announcementInterval') || 3;
                const homeBoardPosts = await (await import('./db.js')).getAllHomeBoardPosts();
                const guilds = await kvRepository.getKV<Record<string, any>>('guilds') || {};
                
                const allData = {
                    users: onlineUsersData, // 온라인 사용자만 포함
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
                    return;
                }
                
                // 연결이 여전히 열려있는지 확인 후 전송
                if (!checkConnection()) {
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
                } catch (sendError) {
                    console.error('[WebSocket] Error sending message:', sendError);
                    isClosed = true;
                }
            } catch (error) {
                console.error('[WebSocket] Error sending initial state:', error);
                if (!isClosed && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Failed to load initial state' } }));
                    } catch (sendError) {
                        console.error('[WebSocket] Error sending error message:', sendError);
                        isClosed = true;
                    }
                }
            }
        })();
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
    
    const messageString = JSON.stringify(message);
    let sentCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const userId = wsUserIdMap.get(client);
            if (userId && participantIds.has(userId)) {
                client.send(messageString);
                sentCount++;
            }
        }
    });
    if (sentCount > 0) {
        console.log(`[WebSocket] Sent GAME_UPDATE to ${sentCount} participants for game ${gameId}`);
    }
};

export const broadcast = (message: any) => {
    if (!wss) return;
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
};

// 특정 사용자에게만 메시지를 보내는 함수
export const sendToUser = (userId: string, message: any) => {
    if (!wss) return;
    const messageString = JSON.stringify({ ...message, targetUserId: userId });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const clientUserId = wsUserIdMap.get(client);
            if (clientUserId === userId) {
                client.send(messageString);
            }
        }
    });
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
                optimizedUser[field] = user[field];
            }
        });
    } else {
        // 기본적으로 필요한 필드만 포함 (inventory, equipment, quests 등은 제외)
        if (user.stats) optimizedUser.stats = user.stats;
        if (user.baseStats) optimizedUser.baseStats = user.baseStats;
    }
    
    const message = { type: 'USER_UPDATE', payload: { [user.id]: optimizedUser } };
    const messageString = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
};