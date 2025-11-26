import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, Negotiation, GameMode, UserStatus, Player } from '../../types/index.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, STRATEGIC_ACTION_POINT_COST, PLAYFUL_ACTION_POINT_COST, DEFAULT_GAME_SETTINGS } from '../../constants';
import { initializeGame } from '../gameModes.js';
import { aiUserId, getAiUser } from '../aiPlayer.js';
import { broadcast } from '../socket.js';

type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

const getActionPointCost = (mode: GameMode): number => {
    if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
        return STRATEGIC_ACTION_POINT_COST;
    }
    if (PLAYFUL_GAME_MODES.some(m => m.mode === mode)) {
        return PLAYFUL_ACTION_POINT_COST;
    }
    return STRATEGIC_ACTION_POINT_COST; // Default to strategic cost
};

export const handleNegotiationAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    const now = Date.now();

    switch (type) {
        case 'CHALLENGE_USER': {
            const { opponentId, mode, settings, isRanked } = payload;
            const opponent = opponentId === aiUserId ? getAiUser(mode) : await db.getUser(opponentId);
        
            if (!opponent) return { error: 'Opponent not found.' };
            if (user.id === opponent.id) return { error: 'You cannot challenge yourself.' };

            // Clean up any of my own previous abandoned drafts
            const existingDraftId = Object.keys(volatileState.negotiations).find(id => {
                const neg = volatileState.negotiations[id];
                return neg.challenger.id === user.id && neg.status === 'draft';
            });
            if (existingDraftId) {
                delete volatileState.negotiations[existingDraftId];
            }
            
            // For real players, perform status checks
            if (opponentId !== aiUserId) {
                let myStatus = volatileState.userStatuses[user.id];
                const opponentStatus = volatileState.userStatuses[opponent.id];

                if (!opponentStatus) {
                    return { error: '상대방이 오프라인 상태입니다.' };
                }
                
                // myStatus가 없거나 waiting/resting이 아니면 대기 상태로 설정
                // (대기실에 입장했지만 상태가 아직 업데이트되지 않은 경우)
                if (!myStatus || (myStatus.status !== UserStatus.Waiting && myStatus.status !== 'resting')) {
                    // 대기 상태로 설정 (mode는 선택한 게임 모드로 설정)
                    volatileState.userStatuses[user.id] = { status: UserStatus.Waiting, mode };
                    myStatus = volatileState.userStatuses[user.id];
                    broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
                }
                
                // 'waiting' 또는 'resting' 상태에서 대국 신청 가능
                const canIChallenge = myStatus.status === UserStatus.Waiting || myStatus.status === 'resting';
                if (!canIChallenge) {
                    return { error: '대국 신청은 대기실에서만 가능합니다.' };
                }
                
                const canOpponentBeChallenged = opponentStatus?.status === UserStatus.Waiting || opponentStatus?.status === UserStatus.Online;
                if (!canOpponentBeChallenged) {
                    return { error: '상대방이 대국을 신청받을 수 있는 상태가 아닙니다.' };
                }

                // Check if opponent has rejected this game mode
                if (opponent.rejectedGameModes && opponent.rejectedGameModes.includes(mode)) {
                    return { error: `상대방이 ${mode} 게임 신청을 거부했습니다.` };
                }

                // FIX: Only block if the opponent is in a *pending* negotiation (one they have to respond to).
                const isOpponentInPendingNegotiation = Object.values(volatileState.negotiations).some(
                    neg => (neg.opponent.id === opponent.id || neg.challenger.id === opponent.id) && neg.status === 'pending'
                );
                if (isOpponentInPendingNegotiation) {
                    return { error: '상대방은 현재 다른 대국 신청을 처리 중입니다.' };
                }

                if (opponent.actionPoints.current < getActionPointCost(mode) && !opponent.isAdmin) {
                    return { error: `상대방의 액션 포인트가 부족합니다.` };
                }
            }
            
            const cost = getActionPointCost(mode);
            if (user.actionPoints.current < cost && !user.isAdmin) {
                return { error: `액션 포인트가 부족합니다. (필요: ${cost})` };
            }
        
            const negotiationId = `neg-${randomUUID()}`;
            const newNegotiation: Negotiation = {
                id: negotiationId,
                challenger: user,
                opponent: opponent,
                mode: mode,
                settings: settings ? { ...DEFAULT_GAME_SETTINGS, ...settings } : { ...DEFAULT_GAME_SETTINGS },
                proposerId: user.id,
                status: 'draft',
                turnCount: 0,
                deadline: now + 60000,
                isRanked: isRanked ?? false, // 기본값: 친선전
            };
        
            volatileState.negotiations[negotiationId] = newNegotiation;
            volatileState.userStatuses[user.id].status = UserStatus.Negotiating;
            // Draft negotiation이 생성되었으므로 브로드캐스트 (challenger가 설정을 조정할 수 있도록)
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            return {
                clientResponse: {
                    negotiationId: negotiationId
                }
            };
        }
        case 'SEND_CHALLENGE': {
            const { negotiationId, settings } = payload;
            const negotiation = volatileState.negotiations[negotiationId];
            if (!negotiation || negotiation.challenger.id !== user.id || negotiation.status !== 'draft') {
                return { error: 'Invalid challenge.' };
            }

            const cost = getActionPointCost(negotiation.mode);
            if (user.actionPoints.current < cost && !user.isAdmin) {
                return { error: `액션 포인트가 부족합니다. (필요: ${cost})` };
            }

            const opponent = negotiation.opponent;
            const isOpponentAlreadyInNegotiation = Object.values(volatileState.negotiations).some(
                neg => neg.id !== negotiationId &&
                       (neg.challenger.id === opponent.id || neg.opponent.id === opponent.id) &&
                       neg.status === 'pending'
            );

            if (isOpponentAlreadyInNegotiation) {
                delete volatileState.negotiations[negotiationId];
                volatileState.userStatuses[user.id].status = UserStatus.Waiting;
                return { error: '상대방이 다른 대국 신청을 먼저 받았습니다. 잠시 후 다시 시도해주세요.' };
            }

            negotiation.previousSettings = undefined; // 초기 신청이므로 이전 설정 없음
            // settings를 깊은 복사로 저장하여 전달
            negotiation.settings = JSON.parse(JSON.stringify(settings));
            negotiation.status = 'pending';
            negotiation.proposerId = negotiation.opponent.id;
            negotiation.turnCount = 0; // 초기 신청은 turnCount 0
            // 브로드캐스트 직전에 deadline을 다시 계산하여 정확한 시간 설정
            const broadcastTime = Date.now();
            negotiation.deadline = broadcastTime + 60000;
            
            // 상대방의 상태를 Negotiating으로 업데이트 (대국 신청을 받았으므로)
            if (volatileState.userStatuses[opponent.id]) {
                volatileState.userStatuses[opponent.id].status = UserStatus.Negotiating;
            }
            
            // negotiations를 깊은 복사하여 브로드캐스트
            const negotiationsToBroadcast = JSON.parse(JSON.stringify(volatileState.negotiations));
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: negotiationsToBroadcast, userStatuses: volatileState.userStatuses } });
            return {};
        }
        case 'UPDATE_NEGOTIATION': {
            const { negotiationId, settings } = payload;
            const negotiation = volatileState.negotiations[negotiationId];
            if (!negotiation || negotiation.proposerId !== user.id || negotiation.status !== 'pending') {
                return { error: 'Cannot update this negotiation now.' };
            }

            negotiation.previousSettings = { ...negotiation.settings }; // 이전 설정 저장
            negotiation.settings = settings;
            negotiation.proposerId = negotiation.challenger.id === user.id ? negotiation.opponent.id : negotiation.challenger.id;
            negotiation.turnCount = (negotiation.turnCount || 0) + 1;
            negotiation.deadline = now + 60000;

            if (negotiation.turnCount >= 10) {
                volatileState.userStatuses[negotiation.challenger.id].status = UserStatus.Waiting;
                volatileState.userStatuses[negotiation.opponent.id].status = UserStatus.Waiting;
                delete volatileState.negotiations[negotiationId];
                broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
                return { error: 'Negotiation failed after too many turns.' };
            }
            
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            return {};
        }
        case 'ACCEPT_NEGOTIATION': {
            const { negotiationId, settings } = payload;
            const negotiation = volatileState.negotiations[negotiationId];
            if (!negotiation || negotiation.proposerId !== user.id || negotiation.status !== 'pending') {
                return { error: 'Cannot accept this negotiation now.' };
            }
            
            // challenger가 이미 대기실을 나갔는지 확인
            const challengerStatus = volatileState.userStatuses[negotiation.challenger.id];
            if (!challengerStatus || (challengerStatus.status !== UserStatus.Negotiating && challengerStatus.status !== UserStatus.Waiting)) {
                // challenger가 이미 나간 경우 negotiation 삭제 및 opponent 상태 복구
                if (volatileState.userStatuses[negotiation.opponent.id]?.status === UserStatus.Negotiating) {
                    volatileState.userStatuses[negotiation.opponent.id].status = UserStatus.Waiting;
                }
                delete volatileState.negotiations[negotiationId];
                broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
                return { error: '상대방이 대기실을 나갔습니다. 대국 신청이 취소되었습니다.' };
            }
            
            const challenger = await db.getUser(negotiation.challenger.id);
            const opponent = await db.getUser(negotiation.opponent.id);
            if (!challenger || !opponent) return { error: "One of the players could not be found." };

            const cost = getActionPointCost(negotiation.mode);
            if ((challenger.actionPoints.current < cost && !challenger.isAdmin) || (opponent.actionPoints.current < cost && !opponent.isAdmin)) {
                volatileState.userStatuses[challenger.id].status = UserStatus.Waiting;
                delete volatileState.negotiations[negotiationId];
                return { error: 'One of the players does not have enough action points.' };
            }

            if (!challenger.isAdmin) {
                challenger.actionPoints.current -= cost;
                challenger.lastActionPointUpdate = now;
            }
            if (!opponent.isAdmin) {
                opponent.actionPoints.current -= cost;
                opponent.lastActionPointUpdate = now;
            }

            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(challenger).catch(err => {
                console.error(`[ACCEPT_NEGOTIATION] Failed to save challenger ${challenger.id}:`, err);
            });
            db.updateUser(opponent).catch(err => {
                console.error(`[ACCEPT_NEGOTIATION] Failed to save opponent ${opponent.id}:`, err);
            });

            // Broadcast updated action points immediately so clients reflect the deduction
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(challenger, ['actionPoints']);
            broadcastUserUpdate(opponent, ['actionPoints']);

            // 수락 시에는 원래 negotiation.settings를 사용 (발신자가 보낸 설정)
            // settings 파라미터는 UPDATE_NEGOTIATION에서만 사용
            const game = await initializeGame(negotiation);
            await db.saveGame(game);
            
            volatileState.userStatuses[game.player1.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
            volatileState.userStatuses[game.player2.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
            
            if (negotiation.rematchOfGameId) {
                const originalGame = await db.getLiveGame(negotiation.rematchOfGameId);
                if (originalGame && originalGame.gameStatus === 'rematch_pending') {
                    originalGame.gameStatus = 'ended';
                    await db.saveGame(originalGame);
                }
            }
            
            const playerIdsInGame = new Set([game.player1.id, game.player2.id]);
            Object.values(volatileState.negotiations).forEach(negToCancel => {
                if (negToCancel.id !== negotiationId && (playerIdsInGame.has(negToCancel.challenger.id) || playerIdsInGame.has(negToCancel.opponent.id))) {
                    const challengerId = negToCancel.challenger.id;
                    if (volatileState.userStatuses[challengerId]?.status === UserStatus.Negotiating) {
                        volatileState.userStatuses[challengerId].status = UserStatus.Waiting;
                    }
                    delete volatileState.negotiations[negToCancel.id];
                }
            });

            delete volatileState.negotiations[negotiationId];
            
            // 게임 생성 후 게임 정보를 먼저 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            // 그 다음 사용자 상태 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            
            return {
                clientResponse: {
                    gameId: game.id
                }
            };
        }
        case 'DECLINE_NEGOTIATION': {
            const { negotiationId } = payload;
            const negotiation = volatileState.negotiations[negotiationId];
            if (!negotiation) return {};
            if (negotiation.challenger.id !== user.id && negotiation.opponent.id !== user.id) {
                return { error: 'You are not part of this negotiation.' };
            }
        
            const { challenger, opponent, rematchOfGameId, mode } = negotiation;
        
            if (rematchOfGameId) {
                const originalGame = await db.getLiveGame(rematchOfGameId);
                if (originalGame?.gameStatus === 'rematch_pending') {
                    originalGame.gameStatus = 'ended';
                    await db.saveGame(originalGame);
                }
                [challenger.id, opponent.id].forEach(id => {
                    const status = volatileState.userStatuses[id];
                    if (status) {
                        status.status = UserStatus.InGame;
                        status.gameId = rematchOfGameId;
                    }
                });
            } else {
                const challengerStatus = volatileState.userStatuses[challenger.id];
                if (challengerStatus?.status === UserStatus.Negotiating) {
                    challengerStatus.status = UserStatus.Waiting;
                    challengerStatus.mode = mode;
                    challengerStatus.gameId = undefined;
                }
            }
        
            // 거절한 사람이 opponent인 경우 challenger에게 거절 메시지 전달
            const isOpponentDeclining = negotiation.opponent.id === user.id;
            const declinedMessage = isOpponentDeclining ? {
                declinedBy: opponent.nickname,
                message: `${opponent.nickname}님이 대국 신청을 거절했습니다.`
            } : undefined;
        
            delete volatileState.negotiations[negotiationId];
            
            // 발신자(challenger)에게 거절 메시지 전달
            if (isOpponentDeclining && declinedMessage) {
                broadcast({ 
                    type: 'CHALLENGE_DECLINED', 
                    payload: { 
                        negotiationId,
                        declinedMessage,
                        challengerId: challenger.id
                    } 
                });
            }
            
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            
            return {
                clientResponse: declinedMessage ? { declinedMessage } : {}
            };
        }
        case 'START_AI_GAME': {
            const { mode, settings } = payload;
            const cost = getActionPointCost(mode);
            if (user.actionPoints.current < cost && !user.isAdmin) {
                return { error: `액션 포인트가 부족합니다. (필요: ${cost})` };
            }
            if (!user.isAdmin) {
                user.actionPoints.current -= cost;
                user.lastActionPointUpdate = now;
            }
        
            const negotiation: Negotiation = {
                id: `neg-ai-${randomUUID()}`,
                challenger: user,
                opponent: getAiUser(mode),
                mode, settings,
                proposerId: user.id,
                status: 'pending', deadline: 0,
            };
        
            const game = await initializeGame(negotiation);
            await db.saveGame(game);
            
            volatileState.userStatuses[game.player1.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
            volatileState.userStatuses[game.player2.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id };
            
            const draftNegId = Object.keys(volatileState.negotiations).find(id => {
                const neg = volatileState.negotiations[id];
                return neg.challenger.id === user.id && neg.opponent.id === aiUserId && neg.status === 'draft';
            });
            if (draftNegId) delete volatileState.negotiations[draftNegId];
            
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[ACCEPT_NEGOTIATION] Failed to save user ${user.id}:`, err);
            });
            
            // 게임 생성 후 게임 정보를 먼저 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants, broadcastUserUpdate } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            // 그 다음 사용자 업데이트 브로드캐스트 (actionPoints 변경 반영)
            broadcastUserUpdate(user, ['actionPoints']);
            // 사용자 상태 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            broadcast({ type: 'NEGOTIATION_UPDATE', payload: { negotiations: volatileState.negotiations, userStatuses: volatileState.userStatuses } });
            
            return {
                clientResponse: {
                    gameId: game.id
                }
            };
        }
        case 'REQUEST_REMATCH': {
            const { opponentId, originalGameId } = payload;
            const opponent = await db.getUser(opponentId);
            if (!opponent) return { error: 'Opponent not found.' };
        
            const originalGame = await db.getLiveGame(originalGameId);
            if (!originalGame || !['ended', 'no_contest', 'rematch_pending'].includes(originalGame.gameStatus)) {
                return { error: 'Cannot request a rematch for this game.' };
            }
        
            if (Object.values(volatileState.negotiations).some(n => n.rematchOfGameId === originalGameId)) {
                return { error: 'A rematch has already been requested.' };
            }
        
            originalGame.gameStatus = 'rematch_pending';
            await db.saveGame(originalGame);
        
            const negotiationId = `neg-${randomUUID()}`;
            const newNegotiation: Negotiation = {
                id: negotiationId,
                challenger: user,
                opponent: opponent,
                mode: originalGame.mode,
                settings: originalGame.settings,
                proposerId: user.id,
                status: 'draft',
                turnCount: 0,
                deadline: now + 60000,
                rematchOfGameId: originalGameId,
            };
        
            volatileState.negotiations[negotiationId] = newNegotiation;
        
            if (volatileState.userStatuses[user.id]) {
                volatileState.userStatuses[user.id].status = UserStatus.Negotiating;
                volatileState.userStatuses[user.id].gameId = originalGameId;
            }
            if (volatileState.userStatuses[opponent.id]) {
                volatileState.userStatuses[opponent.id].status = UserStatus.Negotiating;
                volatileState.userStatuses[opponent.id].gameId = originalGameId;
            }
        
            return {};
        }
        default:
            return { error: 'Unknown negotiation action.' };
    }
};