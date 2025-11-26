import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, ChatMessage, UserStatus, type Negotiation, TournamentType, GameMode } from '../../types/index.js';
import * as types from '../../types/index.js';
import { updateQuestProgress } from './../questService.js';
import { containsProfanity } from '../../profanity.js';
import * as tournamentService from '../tournamentService.js';
import * as summaryService from '../summaryService.js';
import { broadcast } from '../socket.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../../constants/index.js';
import { clearAiSession } from '../aiSessionManager.js';
import { getSelectiveUserUpdate } from '../utils/userUpdateHelper.js';


type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

const GREETINGS = ['안녕', '하이', '헬로', 'hi', 'hello', '반가', '잘 부탁', '잘부탁'];

export const handleSocialAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    const now = Date.now();

    switch (type) {
        case 'LOGOUT': {
            const activeTournament = volatileState.activeTournaments?.[user.id];
            if (activeTournament) {
                console.log(`[Logout] User ${user.nickname} has an active tournament. Forfeiting.`);
                tournamentService.forfeitTournament(activeTournament, user.id);
                
                let stateKey: keyof User;
                switch (activeTournament.type) {
                    case 'neighborhood': stateKey = 'lastNeighborhoodTournament'; break;
                    case 'national': stateKey = 'lastNationalTournament'; break;
                    case 'world': stateKey = 'lastWorldTournament'; break;
                    default:
                        console.error(`[Logout] Unknown tournament type found in active tournament: ${activeTournament.type}`);
                        // Don't save if type is unknown to prevent corruption
                        if (volatileState.activeTournaments) {
                            delete volatileState.activeTournaments[user.id];
                        }
                        delete volatileState.userConnections[user.id];
                        delete volatileState.userStatuses[user.id];
                        return { error: 'Unknown tournament type.' };
                }
                (user as any)[stateKey] = activeTournament;
                
                // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
                db.updateUser(user).catch(err => {
                    console.error(`[LEAVE_TOURNAMENT_VIEW] Failed to save user ${user.id}:`, err);
                });

                if (volatileState.activeTournaments) {
                    delete volatileState.activeTournaments[user.id];
                }
            }
            
            const userStatus = volatileState.userStatuses[user.id];
            const activeGameId = userStatus?.gameId;
            if (userStatus?.status === 'in-game' && activeGameId) {
                const game = await db.getLiveGame(activeGameId);
                // scoring 상태의 게임은 연결 끊김으로 처리하지 않음 (자동계가 진행 중)
                if (game && game.gameStatus !== 'ended' && game.gameStatus !== 'no_contest' && game.gameStatus !== 'scoring') {
                    // 도전의 탑, 싱글플레이, AI 게임에서는 접속 끊김 패널티 없음
                    const isNoPenaltyGame = game.isSinglePlayer || game.gameCategory === 'tower' || game.isAiGame;
                    if (!game.disconnectionState) {
                        if (!isNoPenaltyGame) {
                            // 일반 게임에서만 접속 끊김 카운트 및 패널티 적용
                            game.disconnectionCounts[user.id] = (game.disconnectionCounts[user.id] || 0) + 1;
                            if (game.disconnectionCounts[user.id] >= 3) {
                                // 3번째 접속이 끊어지면 바로 "접속장애패" 처리
                                const winner = game.blackPlayerId === user.id ? types.Player.White : types.Player.Black;
                                await summaryService.endGame(game, winner, 'disconnect');
                            } else {
                                game.disconnectionState = { disconnectedPlayerId: user.id, timerStartedAt: now };
                                // 20수 이내 접속 끊김 시 무효처리 요청 가능
                                if (game.moveHistory.length < 20) {
                                    const otherPlayerId = game.player1.id === user.id ? game.player2.id : game.player1.id;
                                    if (!game.canRequestNoContest) game.canRequestNoContest = {};
                                    game.canRequestNoContest[otherPlayerId] = true;
                                }
                                await db.saveGame(game);
                                
                                // 접속 끊김 상태 브로드캐스트
                                const { broadcastToGameParticipants } = await import('../socket.js');
                                broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                            }
                        } else {
                            // 도전의 탑, 싱글플레이, AI 게임에서는 즉시 게임 종료 (패널티 없음)
                            const winner = game.blackPlayerId === user.id ? types.Player.White : types.Player.Black;
                            await summaryService.endGame(game, winner, 'disconnect');
                        }
                    }
                } else if (game && game.gameStatus === 'scoring') {
                    // scoring 상태의 게임은 연결 끊김으로 처리하지 않고 조용히 무시
                    console.log(`[SocialAction] Ignoring disconnect for scoring game: ${activeGameId}`);
                }
            }
            
            delete volatileState.userConnections[user.id];
            delete volatileState.userStatuses[user.id];
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            return {};
        }
        case 'SEND_CHAT_MESSAGE': {
            if (user.chatBanUntil && user.chatBanUntil > now) {
                const timeLeft = Math.ceil((user.chatBanUntil - now) / 1000 / 60);
                return { error: `채팅이 금지되었습니다. (${timeLeft}분 남음)` };
            }
            const lastMessageTime = volatileState.userLastChatMessage[user.id] || 0;
            if (now - lastMessageTime < 5000 && !user.isAdmin) { // Admin can bypass spam check
                return { error: '메시지를 너무 자주 보낼 수 없습니다.' };
            }
        
            const { channel, text, emoji, location } = payload;
            if (!channel || (!text && !emoji)) return { error: 'Invalid chat message.' };

            if (text && containsProfanity(text)) {
                return { error: '메시지에 부적절한 단어가 포함되어 있습니다.' };
            }

            const messageContent = text || emoji || '';
            if (messageContent) {
                if (!volatileState.userConsecutiveChatMessages) volatileState.userConsecutiveChatMessages = {};
                const consecutive = volatileState.userConsecutiveChatMessages[user.id];
                if (consecutive && consecutive.content === messageContent) {
                    consecutive.count++;
                } else {
                    volatileState.userConsecutiveChatMessages[user.id] = { content: messageContent, count: 1 };
                }

                if (volatileState.userConsecutiveChatMessages[user.id].count >= 3 && !user.isAdmin) {
                    const banDurationMinutes = 3;
                    user.chatBanUntil = now + banDurationMinutes * 60 * 1000;
                    
                    // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
                    db.updateUser(user).catch(err => {
                        console.error(`[SEND_CHAT_MESSAGE] Failed to save user ${user.id}:`, err);
                    });
                    
                    delete volatileState.userConsecutiveChatMessages[user.id];

                    const banMessage: ChatMessage = {
                        id: `msg-${randomUUID()}`,
                        user: { id: 'ai-security-guard', nickname: 'AI 보안관봇' },
                        text: `${user.nickname}님, 동일한 메시지를 반복적으로 전송하여 ${banDurationMinutes}분간 채팅이 금지되었습니다.`,
                        system: true,
                        timestamp: now,
                    };
                    if (!volatileState.waitingRoomChats[channel]) volatileState.waitingRoomChats[channel] = [];
                    volatileState.waitingRoomChats[channel].push(banMessage);
                    
                    // 금지 메시지도 브로드캐스트
                    broadcast({ 
                        type: 'WAITING_ROOM_CHAT_UPDATE', 
                        payload: { 
                            [channel]: volatileState.waitingRoomChats[channel] 
                        } 
                    });
                    
                    return { error: `동일한 메시지를 반복하여 ${banDurationMinutes}분간 채팅이 금지되었습니다.` };
                }
            }
        
            const message: ChatMessage = {
                id: `msg-${randomUUID()}`,
                user: { id: user.id, nickname: user.nickname },
                text, emoji, system: false, timestamp: now,
                location
            };
            
            if (!volatileState.waitingRoomChats[channel]) volatileState.waitingRoomChats[channel] = [];
            volatileState.waitingRoomChats[channel].push(message);
            if (volatileState.waitingRoomChats[channel].length > 100) {
                volatileState.waitingRoomChats[channel].shift();
            }
            volatileState.userLastChatMessage[user.id] = now;

            if (text && GREETINGS.some(g => text.toLowerCase().includes(g))) {
                updateQuestProgress(user, 'chat_greeting');
                
                // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
                db.updateUser(user).catch(err => {
                    console.error(`[SEND_CHAT_MESSAGE] Failed to save user ${user.id}:`, err);
                });

                // WebSocket으로 사용자 업데이트 브로드캐스트 (최적화된 함수 사용)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['quests']);
            }

            // 채팅 메시지를 모든 클라이언트에 브로드캐스트
            broadcast({ 
                type: 'WAITING_ROOM_CHAT_UPDATE', 
                payload: { 
                    [channel]: volatileState.waitingRoomChats[channel] 
                } 
            });

            return {};
        }
        case 'SET_USER_STATUS': {
            const { status } = payload as { status: UserStatus };
            if (status !== UserStatus.Waiting && status !== 'resting') {
                return { error: 'Invalid status for waiting room.' };
            }
            const currentUserStatus = volatileState.userStatuses[user.id];
            if (currentUserStatus && (currentUserStatus.status === UserStatus.Waiting || currentUserStatus.status === 'resting')) {
                currentUserStatus.status = status;
                broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            } else {
                return { error: 'Cannot change status while in-game or negotiating.' };
            }
            return {};
        }
        case 'ENTER_WAITING_ROOM': {
            const { mode } = payload;
            const currentStatus = volatileState.userStatuses[user.id];
            
            // 이미 같은 상태로 대기실에 있으면 중복 요청 무시
            if (currentStatus && 
                (currentStatus.status === UserStatus.Waiting || currentStatus.status === UserStatus.Resting)) {
                if (mode === 'strategic' || mode === 'playful') {
                    // strategic/playful 모드는 mode가 없거나 해당 모드 그룹에 속하면 중복
                    if (!currentStatus.mode || 
                        (mode === 'strategic' && SPECIAL_GAME_MODES.some(m => m.mode === currentStatus.mode)) ||
                        (mode === 'playful' && PLAYFUL_GAME_MODES.some(m => m.mode === currentStatus.mode))) {
                        return {}; // 이미 올바른 대기실에 있음
                    }
                } else if (currentStatus.mode === mode) {
                    return {}; // 이미 같은 모드 대기실에 있음
                }
            }
            
            // strategic/playful은 GameMode가 아니므로 mode를 undefined로 설정
            if (mode === 'strategic' || mode === 'playful') {
                volatileState.userStatuses[user.id] = { status: UserStatus.Waiting };
            } else {
                volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode: mode as GameMode };
            }
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            return {};
        }
        case 'LEAVE_WAITING_ROOM': {
            const userStatus = volatileState.userStatuses[user.id];
            if (userStatus && (userStatus.status === UserStatus.Waiting || userStatus.status === UserStatus.Resting)) {
                userStatus.status = UserStatus.Online;
                delete userStatus.mode; // 대기실 모드 정보 제거
            }
            
            // 사용자가 보낸 negotiation 정리
            const userNegotiations = Object.keys(volatileState.negotiations).filter(negId => {
                const neg = volatileState.negotiations[negId];
                return neg.challenger.id === user.id && neg.status === 'pending';
            });
            
            for (const negId of userNegotiations) {
                const neg = volatileState.negotiations[negId];
                // opponent 상태 복구
                if (volatileState.userStatuses[neg.opponent.id]?.status === UserStatus.Negotiating) {
                    volatileState.userStatuses[neg.opponent.id].status = UserStatus.Waiting;
                }
                delete volatileState.negotiations[negId];
            }
            
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            if (userNegotiations.length > 0) {
                broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            }
            return {};
        }
        case 'ENTER_TOURNAMENT_VIEW': {
            if (!volatileState.activeTournamentViewers) {
                volatileState.activeTournamentViewers = new Set();
            }
            volatileState.activeTournamentViewers.add(user.id);
            return {};
        }
        case 'LEAVE_TOURNAMENT_VIEW': {
            if (volatileState.activeTournamentViewers) {
                volatileState.activeTournamentViewers.delete(user.id);
            }
            return {};
        }
        case 'LEAVE_GAME_ROOM': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) return { error: 'Game not found.' };

            if (volatileState.userStatuses[user.id]) {
                // 싱글플레이 게임이 아닌 경우, 게임 모드를 strategic/playful로 변환
                let lobbyMode: GameMode | 'strategic' | 'playful' | undefined = undefined;
                if (!game.isSinglePlayer) {
                    if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                        lobbyMode = 'strategic';
                    } else if (PLAYFUL_GAME_MODES.some(m => m.mode === game.mode)) {
                        lobbyMode = 'playful';
                    }
                }
                // 싱글플레이 게임이거나 모드를 찾을 수 없는 경우 Online 상태로 변경 (게임 모드 없음)
                if (game.isSinglePlayer || !lobbyMode) {
                    volatileState.userStatuses[user.id] = { status: UserStatus.Online };
                    delete volatileState.userStatuses[user.id].mode;
                    delete volatileState.userStatuses[user.id].gameId;
                } else {
                    // strategic/playful은 GameMode가 아니므로 mode를 undefined로 설정
                    if (lobbyMode === 'strategic' || lobbyMode === 'playful') {
                        volatileState.userStatuses[user.id] = { status: UserStatus.Waiting };
                    } else {
                        volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode: lobbyMode as GameMode };
                    }
                }
            }
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });

            const ongoingRematchNegotiation = Object.values(volatileState.negotiations).find(
                neg => neg.rematchOfGameId === gameId
            );

            if (ongoingRematchNegotiation) {
                const otherPlayerId = ongoingRematchNegotiation.challenger.id === user.id
                    ? ongoingRematchNegotiation.opponent.id
                    : ongoingRematchNegotiation.challenger.id;
                
                const otherPlayerStatus = volatileState.userStatuses[otherPlayerId];
                if (otherPlayerStatus?.status === 'negotiating') {
                    otherPlayerStatus.status = UserStatus.InGame;
                    otherPlayerStatus.gameId = gameId;
                }

                delete volatileState.negotiations[ongoingRematchNegotiation.id];

                if (game.gameStatus === 'rematch_pending') {
                    game.gameStatus = 'ended';
                    await db.saveGame(game);
                }
            }
            
            // 두 플레이어가 모두 나갔는지 확인
            const p1Status = volatileState.userStatuses[game.player1.id];
            const p2Status = volatileState.userStatuses[game.player2.id];
            const p1Left = !p1Status || p1Status.gameId !== gameId;
            const p2Left = !p2Status || p2Status.gameId !== gameId;
            const bothPlayersLeft = p1Left && p2Left;
            
            // 관전자가 있는지 확인
            const hasSpectators = Object.values(volatileState.userStatuses).some(
                status => status.spectatingGameId === gameId
            );
            
            // 두 플레이어가 모두 나갔고 관전자도 없으면 게임 삭제
            if (bothPlayersLeft && !hasSpectators) {
                // 리매치 협상이 진행 중인지 확인
                const isRematchBeingNegotiated = Object.values(volatileState.negotiations).some(
                    neg => neg.rematchOfGameId === gameId
                );
                
                if (!isRematchBeingNegotiated) {
                    console.log(`[GC] Deleting game ${gameId} - both players left and no spectators`);
                    clearAiSession(gameId);
                    await db.deleteGame(gameId);
                    // 게임 삭제를 클라이언트에 알리기 위해 GAME_DELETED 브로드캐스트
                    broadcast({ type: 'GAME_DELETED', payload: { gameId } });
                }
            }
            
            return {};
        }
        case 'LEAVE_AI_GAME': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) {
                // 게임이 없어도 사용자 상태는 업데이트 (이미 종료된 게임일 수 있음)
                const userStatus = volatileState.userStatuses[user.id];
                if (userStatus) {
                    userStatus.status = UserStatus.Online;
                    delete userStatus.mode;
                    delete userStatus.gameId;
                    delete userStatus.spectatingGameId;
                } else {
                    volatileState.userStatuses[user.id] = { status: UserStatus.Online };
                }
                broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
                return {}; // 에러를 반환하지 않고 성공 처리
            }

            if (volatileState.userStatuses[user.id]) {
                const isTower = game.gameCategory === 'tower';
                // 싱글플레이 게임이나 도전의 탑이 아닌 경우, 게임 모드를 strategic/playful로 변환
                let lobbyMode: GameMode | 'strategic' | 'playful' | undefined = undefined;
                if (!game.isSinglePlayer && !isTower) {
                    if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                        lobbyMode = 'strategic';
                    } else if (PLAYFUL_GAME_MODES.some(m => m.mode === game.mode)) {
                        lobbyMode = 'playful';
                    }
                }
                // 싱글플레이 게임이나 도전의 탑이거나 모드를 찾을 수 없는 경우 Online 상태로 변경 (게임 모드 없음)
                if (game.isSinglePlayer || isTower || !lobbyMode) {
                    volatileState.userStatuses[user.id] = { status: UserStatus.Online };
                    delete volatileState.userStatuses[user.id].mode;
                    delete volatileState.userStatuses[user.id].gameId;
                } else {
                    // strategic/playful은 GameMode가 아니므로 mode를 undefined로 설정
                    if (lobbyMode === 'strategic' || lobbyMode === 'playful') {
                        volatileState.userStatuses[user.id] = { status: UserStatus.Waiting };
                    } else {
                        volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode: lobbyMode as GameMode };
                    }
                }
            }
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            
            // If the user leaves before the game is officially over (e.g. resigns), end the game.
            if (!['ended', 'no_contest'].includes(game.gameStatus)) {
                 await summaryService.endGame(game, types.Player.White, 'disconnect'); // AI is always P2/White and wins on disconnect
            }
            
            return {};
        }
        case 'SPECTATE_GAME': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) return { error: 'Game not found.' };
            volatileState.userStatuses[user.id] = { status: UserStatus.Spectating, spectatingGameId: gameId, mode: game.mode };
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            return {};
        }
        case 'LEAVE_SPECTATING': {
            const userStatus = volatileState.userStatuses[user.id];
            if (userStatus && userStatus.status === UserStatus.Spectating) {
                userStatus.status = UserStatus.Online; 
                delete userStatus.spectatingGameId;
                delete userStatus.gameId; 
            }
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            return {};
        }
        case 'EMERGENCY_EXIT': {
            // 비상탈출: 모든 플레이 중인 게임을 강제 종료
            const userStatus = volatileState.userStatuses[user.id];
            const activeGameIds: string[] = [];
            
            // userStatuses에서 게임 ID 수집
            if (userStatus?.gameId) {
                activeGameIds.push(userStatus.gameId);
            }
            if (userStatus?.spectatingGameId && !activeGameIds.includes(userStatus.spectatingGameId)) {
                activeGameIds.push(userStatus.spectatingGameId);
            }
            
            // 모든 활성 게임을 확인하여 사용자가 참여 중인 게임 찾기
            const allActiveGames = await db.getAllActiveGames();
            for (const game of allActiveGames) {
                if (game.gameStatus === 'ended' || game.gameStatus === 'no_contest') continue;
                
                const isPlayer = game.player1.id === user.id || game.player2.id === user.id;
                const isSpectator = userStatus?.status === types.UserStatus.Spectating && userStatus.spectatingGameId === game.id;
                
                if (isPlayer || isSpectator) {
                    if (!activeGameIds.includes(game.id)) {
                        activeGameIds.push(game.id);
                    }
                }
            }
            
            // 각 게임을 종료 처리
            for (const gameId of activeGameIds) {
                const game = await db.getLiveGame(gameId);
                if (!game || game.gameStatus === 'ended' || game.gameStatus === 'no_contest') continue;
                
                const isPlayer = game.player1.id === user.id || game.player2.id === user.id;
                const isSpectator = userStatus?.status === types.UserStatus.Spectating && userStatus.spectatingGameId === game.id;
                
                if (isPlayer) {
                    // PVP 경기장에서는 기권패 처리
                    if (!game.isSinglePlayer && !game.isAiGame) {
                        const myPlayerEnum = game.player1.id === user.id ? types.Player.Black : types.Player.White;
                        const winner = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
                        await summaryService.endGame(game, winner, 'resign');
                    } else {
                        // 싱글플레이 또는 AI 게임은 그냥 종료
                        if (game.isSinglePlayer) {
                            // 싱글플레이 게임은 패배 처리
                            await summaryService.endGame(game, types.Player.White, 'disconnect');
                        } else if (game.isAiGame) {
                            // AI 게임은 AI 승리 처리
                            const aiPlayerEnum = game.player1.id === user.id ? types.Player.White : types.Player.Black;
                            await summaryService.endGame(game, aiPlayerEnum, 'disconnect');
                        }
                    }
                } else if (isSpectator) {
                    // 관전 중이면 그냥 상태만 변경
                    // (게임 종료는 필요 없음)
                }
            }
            
            // 사용자 상태를 대기 상태로 변경
            if (volatileState.userStatuses[user.id]) {
                volatileState.userStatuses[user.id] = { status: types.UserStatus.Waiting };
            }
            
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            
            return { clientResponse: { redirectTo: '#/' } };
        }

        case 'START_RANKED_MATCHING': {
            const { lobbyType, selectedModes } = payload;
            
            // 이미 매칭 중이면 에러
            if (volatileState.rankedMatchingQueue?.[lobbyType]?.[user.id]) {
                return { error: '이미 매칭 중입니다.' };
            }
            
            // 선택된 모드가 없으면 에러
            if (!selectedModes || selectedModes.length === 0) {
                return { error: '최소 1개 이상의 게임 모드를 선택해주세요.' };
            }
            
            // 믹스룰 제외 확인
            if (selectedModes.includes(GameMode.Mix)) {
                return { error: '믹스룰은 랭킹전에서 사용할 수 없습니다.' };
            }
            
            // 사용자 랭킹 점수 계산 (선택된 모드 중 첫 번째 모드의 점수 사용)
            const userStats = user.stats || {};
            const firstMode = selectedModes[0];
            const userRating = userStats[firstMode]?.rankingScore || 1200;
            
            // 매칭 큐 초기화
            if (!volatileState.rankedMatchingQueue) {
                volatileState.rankedMatchingQueue = { strategic: {}, playful: {} };
            }
            if (!volatileState.rankedMatchingQueue[lobbyType]) {
                volatileState.rankedMatchingQueue[lobbyType] = {};
            }
            
            // 매칭 큐에 추가
            volatileState.rankedMatchingQueue[lobbyType][user.id] = {
                userId: user.id,
                lobbyType,
                selectedModes,
                startTime: now,
                rating: userRating,
            };
            
            // 사용자 상태를 매칭 중으로 변경
            volatileState.userStatuses[user.id] = { 
                ...volatileState.userStatuses[user.id],
                status: UserStatus.Waiting, // 대기 상태 유지 (매칭 중 표시는 클라이언트에서)
            };
            
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            broadcast({ type: 'RANKED_MATCHING_UPDATE', payload: { queue: volatileState.rankedMatchingQueue } });
            
            // 즉시 매칭 시도
            await tryMatchPlayers(volatileState, lobbyType);
            
            // HTTP 응답에 매칭 정보 포함 (즉시 상태 업데이트를 위해)
            return { 
                clientResponse: { 
                    success: true,
                    matchingInfo: {
                        startTime: now,
                        lobbyType,
                        selectedModes
                    }
                } 
            };
        }
        
        case 'CANCEL_RANKED_MATCHING': {
            // 매칭 큐에서 제거
            if (volatileState.rankedMatchingQueue) {
                for (const lobbyType of ['strategic', 'playful'] as const) {
                    if (volatileState.rankedMatchingQueue[lobbyType]?.[user.id]) {
                        delete volatileState.rankedMatchingQueue[lobbyType][user.id];
                    }
                }
            }
            
            broadcast({ type: 'RANKED_MATCHING_UPDATE', payload: { queue: volatileState.rankedMatchingQueue } });
            
            return { clientResponse: { success: true } };
        }

        default:
            return { error: 'Unknown social action.' };
    }
};

// 매칭 알고리즘: 가장 비슷한 랭킹 점수 유저 매칭 (500점 이내)
export const tryMatchPlayers = async (volatileState: VolatileState, lobbyType: 'strategic' | 'playful'): Promise<void> => {
    const queue = volatileState.rankedMatchingQueue?.[lobbyType];
    if (!queue || Object.keys(queue).length < 2) return;
    
    const entries = Object.values(queue);
    
    // 모든 가능한 쌍을 확인하여 가장 비슷한 점수 차이의 쌍 찾기
    let bestMatch: { player1: typeof entries[0], player2: typeof entries[0], scoreDiff: number } | null = null;
    
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const entry1 = entries[i];
            const entry2 = entries[j];
            
            // 공통 모드가 있는지 확인
            const commonModes = entry1.selectedModes.filter(m => entry2.selectedModes.includes(m));
            if (commonModes.length === 0) continue;
            
            // 점수 차이 확인 (500점 이내)
            const scoreDiff = Math.abs(entry1.rating - entry2.rating);
            if (scoreDiff > 500) continue;
            
            // 더 나은 매칭이면 업데이트
            if (!bestMatch || scoreDiff < bestMatch.scoreDiff) {
                bestMatch = { player1: entry1, player2: entry2, scoreDiff };
            }
        }
    }
    
    if (!bestMatch) return;
    
    // 매칭 성공: 게임 생성
    const { player1: entry1, player2: entry2 } = bestMatch;
    const commonModes = entry1.selectedModes.filter(m => entry2.selectedModes.includes(m));
    
    // 우선순위를 고려하여 가장 높은 우선순위의 공통 모드 선택
    // 각 플레이어의 selectedModes 배열 인덱스 합이 가장 작은 모드를 선택
    let selectedMode: GameMode = commonModes[0];
    let minPrioritySum = Infinity;
    
    for (const mode of commonModes) {
        const player1Priority = entry1.selectedModes.indexOf(mode);
        const player2Priority = entry2.selectedModes.indexOf(mode);
        const prioritySum = player1Priority + player2Priority;
        
        if (prioritySum < minPrioritySum) {
            minPrioritySum = prioritySum;
            selectedMode = mode;
        }
    }
    
    // 랭킹전 기본 설정 가져오기
    const { getRankedGameSettings } = await import('../../constants/rankedGameSettings.js');
    const settings = getRankedGameSettings(selectedMode);
    
    // Negotiation 생성 (랭킹전)
    const player1 = await db.getUser(entry1.userId);
    const player2 = await db.getUser(entry2.userId);
    
    if (!player1 || !player2) return;
    
    const negotiation: Negotiation = {
        id: `neg-ranked-${randomUUID()}`,
        challenger: player1,
        opponent: player2,
        mode: selectedMode,
        settings,
        proposerId: player1.id,
        status: 'pending',
        turnCount: 0,
        deadline: Date.now() + 5000, // 5초 후 자동 수락
        isRanked: true, // 랭킹전
    };
    
    // 게임 생성
    const { initializeGame } = await import('../gameModes.js');
    const game = await initializeGame(negotiation);
    await db.saveGame(game);
    
    // 큐에서 제거
    if (volatileState.rankedMatchingQueue && volatileState.rankedMatchingQueue[lobbyType]) {
        delete volatileState.rankedMatchingQueue[lobbyType][entry1.userId];
        delete volatileState.rankedMatchingQueue[lobbyType][entry2.userId];
    }
    
    // 사용자 상태 업데이트
    volatileState.userStatuses[game.player1.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
    volatileState.userStatuses[game.player2.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
    
    // 예상 랭킹 점수 변동 계산
    const { calculateEloChange } = await import('../summaryService.js');
    const player1Rating = player1.stats?.[selectedMode]?.rankingScore || 1200;
    const player2Rating = player2.stats?.[selectedMode]?.rankingScore || 1200;
    const player1WinChange = calculateEloChange(player1Rating, player2Rating, 'win');
    const player1LossChange = calculateEloChange(player1Rating, player2Rating, 'loss');
    const player2WinChange = calculateEloChange(player2Rating, player1Rating, 'win');
    const player2LossChange = calculateEloChange(player2Rating, player1Rating, 'loss');
    
    // 클래식바둑 특별 처리
    let player1WinChangeFinal = player1WinChange;
    let player1LossChangeFinal = player1LossChange;
    let player2WinChangeFinal = player2WinChange;
    let player2LossChangeFinal = player2LossChange;
    
    if (selectedMode === GameMode.Standard) {
        player1WinChangeFinal = player1WinChange * 2;
        player1LossChangeFinal = Math.round(player1LossChange / 2);
        player2WinChangeFinal = player2WinChange * 2;
        player2LossChangeFinal = Math.round(player2LossChange / 2);
    }
    
    // 매칭 성공 알림 브로드캐스트
    const { broadcast } = await import('../socket.js');
    broadcast({ 
        type: 'RANKED_MATCH_FOUND', 
        payload: { 
            gameId: game.id,
            player1: {
                id: player1.id,
                nickname: player1.nickname,
                rating: player1Rating,
                winChange: player1WinChangeFinal,
                lossChange: player1LossChangeFinal,
            },
            player2: {
                id: player2.id,
                nickname: player2.nickname,
                rating: player2Rating,
                winChange: player2WinChangeFinal,
                lossChange: player2LossChangeFinal,
            },
        } 
    });
    
    // 게임 정보 브로드캐스트
    const { broadcastToGameParticipants } = await import('../socket.js');
    broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
    broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
    broadcast({ type: 'RANKED_MATCHING_UPDATE', payload: { queue: volatileState.rankedMatchingQueue } });
};