import { randomUUID } from 'crypto';
import * as db from './db.js';
// FIX: Import GameMode to resolve TS2304 error.
import { type ServerAction, type User, type VolatileState, InventoryItem, Quest, QuestLog, Negotiation, Player, LeagueTier, TournamentType, GameMode } from '../types/index.js';
import * as types from '../types/index.js';
import { volatileState } from './state.js';
import { isDifferentDayKST, isDifferentWeekKST, isDifferentMonthKST } from '../utils/timeUtils.js';
import * as effectService from './effectService.js';
import { regenerateActionPoints } from './effectService.js';
import { updateGameStates } from './gameModes.js';
import { DAILY_QUESTS, WEEKLY_QUESTS, MONTHLY_QUESTS, SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, ACTION_POINT_REGEN_INTERVAL_MS, ITEM_SELL_PRICES, MATERIAL_SELL_PRICES } from '../constants';
import { initializeGame } from './gameModes.js';
import { handleStrategicGameAction } from './modes/standard.js';
import { handlePlayfulGameAction } from './modes/playful.js';
import { createDefaultUser, createDefaultQuests } from './initialData.ts';
import { containsProfanity } from '../profanity.js';
import * as mannerService from './mannerService.js';

// Import new action handlers
import { handleAdminAction } from './actions/adminActions.js';
import { handleInventoryAction } from './actions/inventoryActions.js';
import { handleNegotiationAction } from './actions/negotiationActions.js';
import { handleRewardAction } from './actions/rewardActions.js';
import { handleShopAction } from './actions/shopActions.js';
import { handleSocialAction } from './actions/socialActions.js';
import { handleTournamentAction } from './actions/tournamentActions.js';
import { handleUserAction } from './actions/userActions.js';
import { handleSinglePlayerAction } from './actions/singlePlayerActions.js';
import { handleTowerAction } from './actions/towerActions.js';
import { handleGuildAction } from './actions/guildActions.js';
import { broadcast } from './socket.js';


export type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

// --- Helper Functions (moved from the old gameActions) ---

export const resetAndGenerateQuests = async (user: User): Promise<User> => {
    const now = Date.now();
    const updatedUser = JSON.parse(JSON.stringify(user));
    let modified = false;

    // Ensure the quests object and its properties exist for older users.
    if (!updatedUser.quests || typeof updatedUser.quests.daily === 'undefined' || typeof updatedUser.quests.weekly === 'undefined' || typeof updatedUser.quests.monthly === 'undefined') {
        const existingQuests = updatedUser.quests || {};
        updatedUser.quests = {
            daily: existingQuests.daily || createDefaultQuests().daily,
            weekly: existingQuests.weekly || createDefaultQuests().weekly,
            monthly: existingQuests.monthly || createDefaultQuests().monthly,
        };
        modified = true;
    }

    // Daily Quests
    if (isDifferentDayKST(updatedUser.quests.daily?.lastReset, now)) {
        updatedUser.quests.daily = {
            quests: [],
            activityProgress: 0,
            claimedMilestones: [false, false, false, false, false],
            lastReset: now,
        };
        const newQuests: Quest[] = DAILY_QUESTS.map((q, i) => ({
            ...q, id: `q-d-${i}-${now}`, progress: 0, isClaimed: false,
        }));
        updatedUser.quests.daily.quests = newQuests;
        // Daily login quest progress
        updateQuestProgress(updatedUser, 'login', undefined, 1);
        modified = true;
    }

    // Weekly Quests
    if (isDifferentWeekKST(updatedUser.quests.weekly?.lastReset, now)) {
        updatedUser.quests.weekly = {
            quests: [],
            activityProgress: 0,
            claimedMilestones: [false, false, false, false, false],
            lastReset: now,
        };
        const newQuests: Quest[] = WEEKLY_QUESTS.map((q, i) => ({
            ...q, id: `q-w-${i}-${now}`, progress: 0, isClaimed: false,
        }));
        updatedUser.quests.weekly.quests = newQuests;
        modified = true;
    }
    
    // Monthly Quests
    if (isDifferentMonthKST(updatedUser.quests.monthly?.lastReset, now)) {
        updatedUser.quests.monthly = {
            quests: [],
            activityProgress: 0,
            claimedMilestones: [false, false, false, false, false],
            lastReset: now,
        };
         const newQuests: Quest[] = MONTHLY_QUESTS.map((q, i) => ({
            ...q, id: `q-m-${i}-${now}`, progress: 0, isClaimed: false,
        }));
        updatedUser.quests.monthly.quests = newQuests;
        modified = true;
    }

    const tournamentTypes: TournamentType[] = ['neighborhood', 'national', 'world'];
    for (const type of tournamentTypes) {
        const playedDateKey = `last${type.charAt(0).toUpperCase() + type.slice(1)}PlayedDate` as keyof User;
        const rewardClaimedKey = `${type}RewardClaimed` as keyof User;
        const tournamentKey = `last${type.charAt(0).toUpperCase() + type.slice(1)}Tournament` as keyof User;

        if (isDifferentDayKST((user as any)[playedDateKey], now)) {
            (updatedUser as any)[playedDateKey] = undefined;
            (updatedUser as any)[rewardClaimedKey] = undefined;
            (updatedUser as any)[tournamentKey] = null;
            modified = true;
        }
    }

    return modified ? updatedUser : user;
};

export const updateQuestProgress = (user: User, type: 'win' | 'participate' | 'action_button' | 'tournament_participate' | 'enhancement_attempt' | 'craft_attempt' | 'chat_greeting' | 'tournament_complete' | 'login' | 'claim_daily_milestone_100' | 'claim_weekly_milestone_100', mode?: GameMode, amount: number = 1) => {
    if (!user.quests) return;
    const isStrategic = mode ? SPECIAL_GAME_MODES.some(m => m.mode === mode) : false;
    const isPlayful = mode ? PLAYFUL_GAME_MODES.some(m => m.mode === mode) : false;

    const questsToUpdate: Quest[] = [
        ...(user.quests.daily?.quests || []),
        ...(user.quests.weekly?.quests || []),
        ...(user.quests.monthly?.quests || [])
    ];

    for (const quest of questsToUpdate) {
        if (quest.isClaimed) continue;

        let shouldUpdate = false;
        switch (quest.title) {
            case '출석하기': if (type === 'login') shouldUpdate = true; break;
            case '채팅창에 인사하기': if (type === 'chat_greeting') shouldUpdate = true; break;
            case '전략바둑 플레이하기': if (type === 'participate' && isStrategic) shouldUpdate = true; break;
            case '놀이바둑 플레이하기': if (type === 'participate' && isPlayful) shouldUpdate = true; break;
            case '전략바둑 승리하기': if (type === 'win' && isStrategic) shouldUpdate = true; break;
            case '놀이바둑 승리하기': if (type === 'win' && isPlayful) shouldUpdate = true; break;
            case '액션버튼 사용하기': if (type === 'action_button') shouldUpdate = true; break;
            case '자동대국 토너먼트 완료하기': if (type === 'tournament_complete') shouldUpdate = true; break;
            case '자동대국 토너먼트 참여하기': if (type === 'tournament_participate') shouldUpdate = true; break;
            case '장비 강화시도': if (type === 'enhancement_attempt') shouldUpdate = true; break;
            case '재료 합성시도': if (type === 'craft_attempt') shouldUpdate = true; break;
            case '일일퀘스트 활약도100보상 받기(3/3)': if (type === 'claim_daily_milestone_100') shouldUpdate = true; break;
            case '일일 퀘스트 활약도100 보상받기 10회': if (type === 'claim_daily_milestone_100') shouldUpdate = true; break;
            case '주간퀘스트 활약도100보상 받기(2/2)': if (type === 'claim_weekly_milestone_100') shouldUpdate = true; break;
        }

        if (shouldUpdate) {
            quest.progress = Math.min(quest.target, quest.progress + amount);
        }
    }
};

export const handleAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user?: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    const gameId = payload?.gameId;
    
    // 프로덕션에서는 상세 로깅 제거 (성능 향상)
    if (process.env.NODE_ENV === 'development') {
        console.log(`[handleAction] Received action: ${type}, userId: ${action.userId}, gameId: ${gameId || 'none'}`);
    }
    
    // user가 전달되지 않은 경우에만 DB에서 조회 (중복 쿼리 방지)
    let userData = user;
    if (!userData) {
        const fetchedUser = await db.getUser(action.userId);
        if (!fetchedUser) {
            return { error: 'User not found.' };
        }
        userData = fetchedUser;
    }
    

    // 관리자 액션은 먼저 처리 (gameId가 있어도 관리자 액션은 여기서 처리)
    if (type.startsWith('ADMIN_')) return handleAdminAction(volatileState, action, userData);

    // 타워 게임 관련 액션은 먼저 처리 (gameId가 있어도 타워 액션은 여기서 처리)
    if (type === 'START_TOWER_GAME' || type === 'CONFIRM_TOWER_GAME_START' || type === 'TOWER_REFRESH_PLACEMENT' || type === 'TOWER_ADD_TURNS' || type === 'END_TOWER_GAME') {
        const { handleTowerAction } = await import('./actions/towerActions.js');
        return handleTowerAction(volatileState, action, userData);
    }

    // Guild actions should be handled before game actions (they don't require gameId)
    if (type.startsWith('GUILD_') || 
        type.startsWith('CREATE_GUILD') || 
        type.startsWith('JOIN_GUILD') || 
        type.startsWith('LEAVE_GUILD') || 
        type.startsWith('KICK_GUILD') || 
        type.startsWith('UPDATE_GUILD') || 
        type.startsWith('SEND_GUILD') || 
        type.startsWith('GET_GUILD') || 
        type.startsWith('LIST_GUILDS') ||
        type.startsWith('START_GUILD') || 
        type.startsWith('DONATE_TO_GUILD') || 
        type.startsWith('PURCHASE_GUILD') || 
        type.startsWith('END_GUILD')) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`[handleAction] Routing GUILD action: ${type} to handleGuildAction`);
        }
        const { handleGuildAction } = await import('./actions/guildActions.js');
        const result = await handleGuildAction(volatileState, action, userData);
        if (process.env.NODE_ENV === 'development' && result?.error) {
            console.log(`[handleAction] GUILD action ${type} result: ERROR: ${result.error}`);
        }
        return result;
    }

    // Game Actions (require gameId)
    // 도전의 탑은 클라이언트에서만 실행되므로 서버에서 착수 액션을 처리하지 않음
    if (gameId && type !== 'LEAVE_AI_GAME') {
        // 싱글플레이 미사일 액션은 먼저 처리 (게임이 캐시에 없을 수 있음)
        if (type === 'START_MISSILE_SELECTION' || type === 'LAUNCH_MISSILE' || type === 'CANCEL_MISSILE_SELECTION' || type === 'MISSILE_INVALID_SELECTION' || type === 'MISSILE_ANIMATION_COMPLETE') {
            // 게임 ID가 sp-game-으로 시작하면 싱글플레이 게임으로 간주
            if (gameId.startsWith('sp-game-')) {
                const { handleSinglePlayerAction } = await import('./actions/singlePlayerActions.js');
                const result = await handleSinglePlayerAction(volatileState, action, userData);
                // singlePlayerActions에서 이미 저장 및 브로드캐스트를 처리하므로 여기서는 결과만 반환
                if (result && (result as any).error) {
                    return result;
                }
                return result || { error: 'Failed to process single player missile action.' };
            }
        }
        
        // 싱글플레이 자동 계가 트리거 (PLACE_STONE with triggerAutoScoring) 처리
        if (type === 'PLACE_STONE' && (payload as any)?.triggerAutoScoring && gameId.startsWith('sp-game-')) {
            // 싱글플레이 게임은 메모리 캐시에서 먼저 찾기
            const { getCachedGame } = await import('./gameCache.js');
            let game = await getCachedGame(gameId);
            if (!game) {
                const db = await import('./db.js');
                game = await db.getLiveGame(gameId);
            }
            if (!game || !game.isSinglePlayer) {
                return { error: 'Invalid single player game.' };
            }
            // handleStrategicGameAction을 통해 처리 (싱글플레이 게임도 전략 액션 핸들러 사용)
            const { handleStrategicGameAction } = await import('./modes/strategic.js');
            const result = await handleStrategicGameAction(volatileState, game, action, userData);
            return result || {};
        }
        
        // 싱글플레이 게임의 히든바둑 액션은 먼저 처리 (게임을 찾기 전에)
        const actionTypeStr = type as string;
        if (actionTypeStr === 'START_HIDDEN_PLACEMENT' || actionTypeStr === 'START_SCANNING' || actionTypeStr === 'SCAN_BOARD') {
            // 싱글플레이 게임은 캐시에서 직접 찾기 (DB에 저장되지 않을 수 있음)
            const { getCachedGame } = await import('./gameCache.js');
            let game = await getCachedGame(gameId);
            
            // 싱글플레이어 게임의 경우 캐시에서 직접 확인 (TTL 무시)
            if (!game && gameId.startsWith('sp-game-')) {
                const cache = volatileState.gameCache;
                if (cache) {
                    const cached = cache.get(gameId);
                    if (cached) {
                        console.log(`[handleAction] Found single player game in cache (expired TTL): gameId=${gameId}, gameStatus=${cached.game.gameStatus}`);
                        game = cached.game;
                        // 캐시 갱신
                        const { updateGameCache } = await import('./gameCache.js');
                        updateGameCache(game);
                    }
                }
            }
            
            // 여전히 없으면 DB에서 찾기
            if (!game) {
                game = await db.getLiveGame(gameId);
            }
            
            if (!game) {
                console.error(`[handleAction] Game not found: gameId=${gameId}, type=${type}`);
                return { error: 'Game not found.' };
            }
            
            if (game.isSinglePlayer) {
                // PLACE_STONE은 히든 아이템 사용 시 서버에서 처리해야 함
                const actionType = type as string;
                if (actionType === 'PLACE_STONE' && (game.gameStatus === 'hidden_placing' || (payload as any)?.isHidden)) {
                    console.log(`[handleAction] Processing single player PLACE_STONE with hidden item: type=${type}, gameId=${gameId}, gameStatus=${game.gameStatus}, isHidden=${(payload as any)?.isHidden}`);
                    // strategic 모드 핸들러로 라우팅 (히든 아이템 처리 포함)
                    if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                        const { handleStrategicGameAction } = await import('./modes/strategic.js');
                        const { updateGameCache } = await import('./gameCache.js');
                        const result = await handleStrategicGameAction(volatileState, game, action, userData);
                        if (result && !result.error) {
                            updateGameCache(game);
                            await db.saveGame(game);
                            const { broadcastToGameParticipants } = await import('./socket.js');
                            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                        }
                        return result || {};
                    }
                }
                console.log(`[handleAction] Processing single player action: type=${type}, gameId=${gameId}, gameStatus=${game.gameStatus}`);
                const { handleSinglePlayerAction } = await import('./actions/singlePlayerActions.js');
                const singlePlayerResult = await handleSinglePlayerAction(volatileState, action, userData);
                console.log(`[handleAction] Single player action result:`, singlePlayerResult);
                // singlePlayerActions.ts에서 이미 저장 및 브로드캐스트를 처리하므로 여기서는 결과만 반환
                return singlePlayerResult || {};
            }
        }
        
        // 캐시를 사용하여 DB 조회 최소화
        const { getCachedGame, updateGameCache } = await import('./gameCache.js');
        const game = await getCachedGame(gameId);
        if (!game) {
            console.error(`[handleAction] Game not found: gameId=${gameId}, type=${type}`);
            return { error: 'Game not found.' };
        }
        
        console.log(`[handleAction] Game found: gameId=${gameId}, type=${type}, isSinglePlayer=${game.isSinglePlayer}, gameStatus=${game.gameStatus}`);
        
        // PVE 게임 (타워, 싱글플레이어, AI 게임)의 착수 액션은 클라이언트에서만 처리
        const isPVEGame = game.gameCategory === 'tower' || game.gameCategory === 'singleplayer' || game.isSinglePlayer || game.isAiGame;
        if (isPVEGame) {
            // 계가 요청은 서버에서 처리
            if (type === 'REQUEST_SCORING') {
                const { boardState, moveHistory, settings } = payload;
                // KataGo를 사용한 계가 분석
                const { analyzeGame } = await import('./kataGoService.js');
                const analysisGame = {
                    ...game,
                    boardState,
                    moveHistory,
                    settings: { ...game.settings, ...settings }
                };
                const analysis = await analyzeGame(analysisGame);
                return {
                    clientResponse: {
                        scoringAnalysis: analysis
                    }
                };
            }
            // CONFIRM_SINGLE_PLAYER_GAME_START는 서버에서 처리해야 함 (게임 시작 확인)
            if (type === 'CONFIRM_SINGLE_PLAYER_GAME_START') {
                const { handleSinglePlayerAction } = await import('./actions/singlePlayerActions.js');
                return handleSinglePlayerAction(volatileState, action, userData);
            }
            // 미사일 액션은 서버에서 처리해야 함 (게임 상태 변경)
            if (type === 'START_MISSILE_SELECTION' || type === 'LAUNCH_MISSILE' || type === 'CANCEL_MISSILE_SELECTION' || type === 'MISSILE_INVALID_SELECTION' || type === 'MISSILE_ANIMATION_COMPLETE') {
                // 싱글플레이 게임의 경우 싱글플레이 핸들러로 라우팅 (이미 위에서 처리했지만 중복 방지)
                if (game.isSinglePlayer) {
                    const { handleSinglePlayerAction } = await import('./actions/singlePlayerActions.js');
                    const result = await handleSinglePlayerAction(volatileState, action, userData);
                    // singlePlayerActions에서 이미 저장 및 브로드캐스트를 처리하므로 여기서는 결과만 반환
                    return result || {};
                }
                // 전략 게임 핸들러를 통해 미사일 액션 처리
                if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                    // START_MISSILE_SELECTION 전 상태 저장 (변경 확인용)
                    const statusBefore = game.gameStatus;
                    const result = await handleStrategicGameAction(volatileState, game, action, userData);
                    
                    // MISSILE_ANIMATION_COMPLETE는 항상 게임 상태가 변경되므로 반드시 브로드캐스트
                    if (type === 'MISSILE_ANIMATION_COMPLETE') {
                        console.log(`[GameActions] MISSILE_ANIMATION_COMPLETE: gameStatus=${game.gameStatus}, always broadcasting update for game ${game.id}`);
                        updateGameCache(game);
                        // 싱글플레이어 게임의 경우 게임 저장을 기다려서 게임을 찾지 못하는 문제 방지
                        if (game.isSinglePlayer) {
                            try {
                                await db.saveGame(game);
                            } catch (err) {
                                console.error(`[GameActions] Failed to save game ${game.id}:`, err);
                            }
                        } else {
                            db.saveGame(game).catch(err => {
                                console.error(`[GameActions] Failed to save game ${game.id}:`, err);
                            });
                        }
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                        return result || { clientResponse: { gameUpdated: true } };
                    }
                    
                    // START_MISSILE_SELECTION의 경우 게임 상태가 변경되므로 반드시 브로드캐스트 필요
                    if (type === 'START_MISSILE_SELECTION') {
                        if (game.gameStatus === 'missile_selecting' && statusBefore !== 'missile_selecting') {
                            console.log(`[GameActions] START_MISSILE_SELECTION: gameStatus changed from ${statusBefore} to missile_selecting, broadcasting update for game ${game.id}`);
                            updateGameCache(game);
                            db.saveGame(game).catch(err => {
                                console.error(`[GameActions] Failed to save game ${game.id}:`, err);
                            });
                            const { broadcastToGameParticipants } = await import('./socket.js');
                            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                            return result || { clientResponse: { gameUpdated: true } };
                        } else {
                            console.warn(`[GameActions] START_MISSILE_SELECTION: gameStatus not changed (before=${statusBefore}, after=${game.gameStatus}), gameId=${game.id}`);
                        }
                    }
                    
                    // result가 null이나 undefined가 아니거나, 에러가 없는 경우 게임 상태가 변경되었을 수 있으므로 브로드캐스트
                    if (result !== null && result !== undefined) {
                        // 캐시 업데이트
                        updateGameCache(game);
                        // DB 저장은 비동기로 처리하여 응답 지연 최소화
                        db.saveGame(game).catch(err => {
                            console.error(`[GameActions] Failed to save game ${game.id}:`, err);
                        });
                        // 게임 상태 변경 후 실시간 브로드캐스트 (게임 참가자에게만 전송)
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                        return result;
                    }
                }
            }
            // 놀이바둑 AI 게임의 PLACE_STONE은 서버에서 AI 처리
            if (type === 'PLACE_STONE' && game.isAiGame && PLAYFUL_GAME_MODES.some(m => m.mode === game.mode)) {
                // AI 차례인지 확인
                const aiPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId : game.whitePlayerId;
                const { aiUserId } = await import('./aiPlayer.js');
                if (aiPlayerId === aiUserId) {
                    // 서버에서 AI 처리
                    const { makeAiMove } = await import('./aiPlayer.js');
                    await makeAiMove(game);
                    await db.saveGame(game);
                    const { broadcastToGameParticipants } = await import('./socket.js');
                    broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                    return {};
                }
            }
            // PVE 게임 관련 특수 액션만 서버에서 처리 (TOWER_REFRESH_PLACEMENT, TOWER_ADD_TURNS 등은 이미 위에서 처리됨)
            // 착수 액션(PLACE_STONE 등)은 클라이언트에서만 처리하므로 여기서는 조용히 무시
            return {};
        }
        
        let result: HandleActionResult | null | undefined = null;
        
        if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
            result = await handleStrategicGameAction(volatileState, game, action, userData);
        } else if (PLAYFUL_GAME_MODES.some(m => m.mode === game.mode)) {
            result = await handlePlayfulGameAction(volatileState, game, action, userData);
        }

        if (result !== null && result !== undefined) {
            // 캐시 업데이트
            updateGameCache(game);
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.saveGame(game).catch(err => {
                console.error(`[GameActions] Failed to save game ${game.id}:`, err);
            });
            // 게임 상태 변경 후 실시간 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants } = await import('./socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            return result;
        }
    }

    // Non-Game actions
    // ADMIN_ 액션은 위에서 이미 처리됨
    if (type.includes('NEGOTIATION') || type === 'START_AI_GAME' || type === 'REQUEST_REMATCH' || type === 'CHALLENGE_USER' || type === 'SEND_CHALLENGE') return handleNegotiationAction(volatileState, action, userData);
    if (type === 'CLAIM_SINGLE_PLAYER_MISSION_REWARD' || type === 'CLAIM_ALL_TRAINING_QUEST_REWARDS' || type === 'START_SINGLE_PLAYER_MISSION' || type === 'LEVEL_UP_TRAINING_QUEST') {
        return handleSinglePlayerAction(volatileState, action, userData);
    }
    // 타워 액션은 위에서 이미 처리됨 (중복 제거)
    if (type.startsWith('CLAIM_') || type.startsWith('DELETE_MAIL') || type === 'DELETE_ALL_CLAIMED_MAIL' || type === 'MARK_MAIL_AS_READ') return handleRewardAction(volatileState, action, userData);
    if (type.startsWith('BUY_') || type === 'PURCHASE_ACTION_POINTS' || type === 'EXPAND_INVENTORY' || type === 'BUY_TOWER_ITEM') return handleShopAction(volatileState, action, userData);
    if (type.startsWith('TOURNAMENT') || 
        type.startsWith('START_TOURNAMENT') || 
        type.startsWith('SKIP_TOURNAMENT') || 
        type.startsWith('FORFEIT_TOURNAMENT') || 
        type.startsWith('FORFEIT_CURRENT_MATCH') || 
        type.startsWith('SAVE_TOURNAMENT') || 
        type.startsWith('CLEAR_TOURNAMENT') || 
        type.startsWith('ADVANCE_TOURNAMENT') || 
        type === 'USE_CONDITION_POTION' || 
        type === 'BUY_CONDITION_POTION' ||
        type === 'START_TOURNAMENT_MATCH' || 
        type === 'ENTER_TOURNAMENT_VIEW' || 
        type === 'LEAVE_TOURNAMENT_VIEW' ||
        type === 'CLAIM_TOURNAMENT_REWARD' ||
        type === 'COMPLETE_TOURNAMENT_SIMULATION') {
        return handleTournamentAction(volatileState, action, userData);
    }
    if (['TOGGLE_EQUIP_ITEM', 'SELL_ITEM', 'ENHANCE_ITEM', 'DISASSEMBLE_ITEM', 'USE_ITEM', 'USE_ALL_ITEMS_OF_TYPE', 'CRAFT_MATERIAL', 'COMBINE_ITEMS', 'REFINE_EQUIPMENT'].includes(type)) return handleInventoryAction(volatileState, action, userData);
    if (['UPDATE_AVATAR', 'UPDATE_BORDER', 'CHANGE_NICKNAME', 'RESET_STAT_POINTS', 'CONFIRM_STAT_ALLOCATION', 'UPDATE_MBTI', 'SAVE_PRESET', 'APPLY_PRESET', 'UPDATE_REJECTION_SETTINGS'].includes(type)) return handleUserAction(volatileState, action, userData);
    if (type.includes('SINGLE_PLAYER')) return handleSinglePlayerAction(volatileState, action, userData);
    if (type === 'MANNER_ACTION') return mannerService.handleMannerAction(volatileState, action, userData);
    // Guild actions are now handled above (before game actions)
    // LEAVE_AI_GAME은 gameId를 가지지만 소셜 액션으로 처리해야 함
    if (type === 'LEAVE_AI_GAME') return handleSocialAction(volatileState, action, userData);
    
    // Social actions can be game-related (chat in game) or not (logout)
    const socialResult = await handleSocialAction(volatileState, action, userData);
    if (socialResult) return socialResult;

    return { error: `Unhandled action type: ${type}` };
};