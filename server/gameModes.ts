
import { getGoLogic } from './goLogic.js';
import { NO_CONTEST_MOVE_THRESHOLD, SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES, STRATEGIC_ACTION_BUTTONS_EARLY, STRATEGIC_ACTION_BUTTONS_MID, STRATEGIC_ACTION_BUTTONS_LATE, PLAYFUL_ACTION_BUTTONS_EARLY, PLAYFUL_ACTION_BUTTONS_MID, PLAYFUL_ACTION_BUTTONS_LATE, RANDOM_DESCRIPTIONS, ALKKAGI_TURN_TIME_LIMIT, ALKKAGI_PLACEMENT_TIME_LIMIT, TIME_BONUS_SECONDS_PER_POINT } from '../constants';
import * as types from '../types/index.js';
import { analyzeGame } from './kataGoService.js';
import type { LiveGameSession, AppState, Negotiation, ActionButton, GameMode } from '../types/index.js';
import { GameCategory } from '../types/index.js';
import { aiUserId, makeAiMove, getAiUser } from './aiPlayer.js';
import { syncAiSession } from './aiSessionManager.js';
// FIX: The imported functions were not found. They are now exported from `standard.ts` with the correct names.
import { initializeStrategicGame, updateStrategicGameState } from './modes/standard.js';
import { initializePlayfulGame, updatePlayfulGameState } from './modes/playful.js';
import { randomUUID } from 'crypto';
import * as db from './db.js';
import * as effectService from './effectService.js';
import { endGame } from './summaryService.js';

export const finalizeAnalysisResult = (baseAnalysis: types.AnalysisResult, session: types.LiveGameSession, preservedTimeInfo?: { blackTimeLeft?: number, whiteTimeLeft?: number }): types.AnalysisResult => {
    const finalAnalysis = JSON.parse(JSON.stringify(baseAnalysis)); // Deep copy

    // Base stone bonus
    finalAnalysis.scoreDetails.black.baseStoneBonus = 0;
    finalAnalysis.scoreDetails.white.baseStoneBonus = 0;

    // Hidden stone bonus
    finalAnalysis.scoreDetails.black.hiddenStoneBonus = 0;
    finalAnalysis.scoreDetails.white.hiddenStoneBonus = 0;
    
    // Time bonus: 보존된 시간 정보를 우선 사용 (게임이 재시작되어 시간이 초기화된 경우 대비)
    if (session.mode === types.GameMode.Speed || (session.mode === types.GameMode.Mix && session.settings.mixedModes?.includes(types.GameMode.Speed))) {
        const blackTime = preservedTimeInfo?.blackTimeLeft ?? session.blackTimeLeft ?? 0;
        const whiteTime = preservedTimeInfo?.whiteTimeLeft ?? session.whiteTimeLeft ?? 0;
        finalAnalysis.scoreDetails.black.timeBonus = Math.floor(blackTime / TIME_BONUS_SECONDS_PER_POINT);
        finalAnalysis.scoreDetails.white.timeBonus = Math.floor(whiteTime / TIME_BONUS_SECONDS_PER_POINT);
        console.log(`[finalizeAnalysisResult] Time bonus calculation: blackTime=${blackTime}, whiteTime=${whiteTime}, blackBonus=${finalAnalysis.scoreDetails.black.timeBonus}, whiteBonus=${finalAnalysis.scoreDetails.white.timeBonus}, preservedTimeInfo=${preservedTimeInfo ? 'yes' : 'no'}`);
    } else {
        finalAnalysis.scoreDetails.black.timeBonus = 0;
        finalAnalysis.scoreDetails.white.timeBonus = 0;
    }
    
    // Item bonus (currently none, placeholder)
    finalAnalysis.scoreDetails.black.itemBonus = 0;
    finalAnalysis.scoreDetails.white.itemBonus = 0;

    // Recalculate totals
    const blackTotal = finalAnalysis.scoreDetails.black.territory + finalAnalysis.scoreDetails.black.captures + (finalAnalysis.scoreDetails.black.deadStones ?? 0) + finalAnalysis.scoreDetails.black.baseStoneBonus + finalAnalysis.scoreDetails.black.hiddenStoneBonus + finalAnalysis.scoreDetails.black.timeBonus + finalAnalysis.scoreDetails.black.itemBonus;
    const whiteTotal = finalAnalysis.scoreDetails.white.territory + finalAnalysis.scoreDetails.white.captures + finalAnalysis.scoreDetails.white.komi + (finalAnalysis.scoreDetails.white.deadStones ?? 0) + finalAnalysis.scoreDetails.white.baseStoneBonus + finalAnalysis.scoreDetails.white.hiddenStoneBonus + finalAnalysis.scoreDetails.white.timeBonus + finalAnalysis.scoreDetails.white.itemBonus;
    
    finalAnalysis.scoreDetails.black.total = blackTotal;
    finalAnalysis.scoreDetails.white.total = whiteTotal;
    
    finalAnalysis.areaScore.black = blackTotal;
    finalAnalysis.areaScore.white = whiteTotal;
    
    // 디버깅: 점수 계산 상세 로그
    console.log(`[finalizeAnalysisResult] Score calculation for game ${session.id}:`);
    console.log(`  Black: territory=${finalAnalysis.scoreDetails.black.territory}, captures=${finalAnalysis.scoreDetails.black.captures}, deadStones=${finalAnalysis.scoreDetails.black.deadStones ?? 0}, total=${blackTotal}`);
    console.log(`  White: territory=${finalAnalysis.scoreDetails.white.territory}, captures=${finalAnalysis.scoreDetails.white.captures}, komi=${finalAnalysis.scoreDetails.white.komi}, deadStones=${finalAnalysis.scoreDetails.white.deadStones ?? 0}, total=${whiteTotal}`);
    
    return finalAnalysis;
};


export const getGameResult = async (game: LiveGameSession): Promise<LiveGameSession> => {
    console.log(`[getGameResult] Called for game ${game.id}, gameStatus=${game.gameStatus}, isSinglePlayer=${game.isSinglePlayer}, stageId=${game.stageId}`);
    const isMissileMode = game.mode === types.GameMode.Missile || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Missile));
    const p1MissilesUsed = (game.settings.missileCount ?? 0) - (game.missiles_p1 ?? game.settings.missileCount ?? 0);
    const p2MissilesUsed = (game.settings.missileCount ?? 0) - (game.missiles_p2 ?? game.settings.missileCount ?? 0);
    const hasUsedMissile = isMissileMode && (p1MissilesUsed > 0 || p2MissilesUsed > 0);

    const isHiddenMode = game.mode === types.GameMode.Hidden || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Hidden));
    const p1ScansUsed = (game.settings.scanCount ?? 0) - (game.scans_p1 ?? game.settings.scanCount ?? 0);
    const p2ScansUsed = (game.settings.scanCount ?? 0) - (game.scans_p2 ?? game.settings.scanCount ?? 0);
    const hasUsedScan = isHiddenMode && (p1ScansUsed > 0 || p2ScansUsed > 0);

    // 싱글플레이어 게임에서는 NO_CONTEST 체크를 건너뜀 (자동 계가 등으로 인해 moveHistory가 초기화될 수 있음)
    const isSinglePlayer = game.isSinglePlayer && !game.gameCategory; // 도전의 탑은 제외
    
    if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode) && 
        !isSinglePlayer && // 싱글플레이어 게임 제외
        game.moveHistory.length < NO_CONTEST_MOVE_THRESHOLD && 
        !hasUsedMissile && 
        !hasUsedScan) {
        game.gameStatus = 'no_contest';
        if (!game.noContestInitiatorIds) game.noContestInitiatorIds = [];
        if (!game.noContestInitiatorIds.includes(game.player1.id)) game.noContestInitiatorIds.push(game.player1.id);
        if (!game.noContestInitiatorIds.includes(game.player2.id)) game.noContestInitiatorIds.push(game.player2.id);
        return game;
    }
    
    const isGoBased = SPECIAL_GAME_MODES.some(m => m.mode === game.mode);
    if (!isGoBased) {
        game.gameStatus = 'ended';
        return game;
    }
    
    // 계가 시작 전: 아직 공개되지 않은 히든 돌들을 모두 공개
    if (isHiddenMode && game.hiddenMoves && game.moveHistory) {
        if (!game.permanentlyRevealedStones) {
            game.permanentlyRevealedStones = [];
        }
        
        // 모든 히든 돌을 확인하여 아직 공개되지 않은 것들을 찾기
        const stonesToReveal: types.Point[] = [];
        
        for (const [moveIndexStr, isHidden] of Object.entries(game.hiddenMoves)) {
            if (!isHidden) continue;
            
            const moveIndex = parseInt(moveIndexStr);
            const move = game.moveHistory[moveIndex];
            
            if (!move) continue;
            
            const { x, y } = move;
            
            // 이미 영구적으로 공개된 돌인지 확인
            const isAlreadyRevealed = game.permanentlyRevealedStones.some(
                p => p.x === x && p.y === y
            );
            
            if (isAlreadyRevealed) continue;
            
            // 돌이 보드에 아직 남아있는지 확인 (캡처되지 않았는지)
            if (game.boardState[y]?.[x] !== types.Player.None) {
                stonesToReveal.push({ x, y });
            }
        }
        
        // AI 초기 히든돌도 확인 (싱글플레이 모드)
        if (game.isSinglePlayer && (game as any).aiInitialHiddenStone) {
            const aiHidden = (game as any).aiInitialHiddenStone;
            const isAlreadyRevealed = game.permanentlyRevealedStones.some(
                p => p.x === aiHidden.x && p.y === aiHidden.y
            );
            
            if (!isAlreadyRevealed) {
                // AI 초기 히든돌이 보드에 남아있는지 확인
                if (game.boardState[aiHidden.y]?.[aiHidden.x] !== types.Player.None) {
                    stonesToReveal.push({ x: aiHidden.x, y: aiHidden.y });
                    // AI 초기 히든돌을 moveHistory에 추가 (아직 추가되지 않은 경우)
                    const moveIndex = game.moveHistory.findIndex(m => m.x === aiHidden.x && m.y === aiHidden.y);
                    if (moveIndex === -1) {
                        if (!game.hiddenMoves) game.hiddenMoves = {};
                        const hiddenMoveIndex = game.moveHistory.length;
                        game.moveHistory.push({
                            player: types.Player.White,
                            x: aiHidden.x,
                            y: aiHidden.y
                        });
                        game.hiddenMoves[hiddenMoveIndex] = true;
                    }
                }
            }
        }
        
        // 발견되지 않은 히든 돌들을 모두 영구적으로 공개
        if (stonesToReveal.length > 0) {
            game.permanentlyRevealedStones.push(...stonesToReveal);
            console.log(`[getGameResult] Revealed ${stonesToReveal.length} hidden stones before scoring for game ${game.id}`);
        }
    }
    
    // 게임 상태 보존 (계가 전에 게임이 초기화되는 것을 방지)
    // 먼저 보호 플래그를 설정하여 다른 로직이 게임을 초기화하지 않도록 함
    (game as any).isScoringProtected = true;
    
    const preservedGameState = {
        boardState: game.boardState ? JSON.parse(JSON.stringify(game.boardState)) : null,
        moveHistory: game.moveHistory ? JSON.parse(JSON.stringify(game.moveHistory)) : null,
        blackTimeLeft: game.blackTimeLeft,
        whiteTimeLeft: game.whiteTimeLeft,
        blackPatternStones: game.blackPatternStones ? JSON.parse(JSON.stringify(game.blackPatternStones)) : null,
        whitePatternStones: game.whitePatternStones ? JSON.parse(JSON.stringify(game.whitePatternStones)) : null,
        captures: game.captures ? JSON.parse(JSON.stringify(game.captures)) : null,
        baseStoneCaptures: game.baseStoneCaptures ? JSON.parse(JSON.stringify(game.baseStoneCaptures)) : null,
        hiddenStoneCaptures: game.hiddenStoneCaptures ? JSON.parse(JSON.stringify(game.hiddenStoneCaptures)) : null,
        totalTurns: game.totalTurns,
    };
    (game as any).preservedGameState = preservedGameState;
    
    // 시간 정보 보존 (게임이 재시작되어 시간이 초기화되는 것을 방지)
    const preservedTimeInfo = {
        blackTimeLeft: game.blackTimeLeft,
        whiteTimeLeft: game.whiteTimeLeft
    };
    (game as any).preservedTimeInfo = preservedTimeInfo;
    
    console.log(`[getGameResult] Preserving game state for scoring: boardStateSize=${game.boardState?.length || 0}, moveHistoryLength=${game.moveHistory?.length || 0}, blackTimeLeft=${preservedGameState.blackTimeLeft}, whiteTimeLeft=${preservedGameState.whiteTimeLeft}`);
    
    // 게임 상태를 scoring으로 변경
    game.gameStatus = 'scoring';
    game.winReason = 'score';
    game.isAnalyzing = true;
    
    // boardState와 moveHistory가 반드시 포함되도록 보장 (게임 객체 자체에도 적용)
    // preservedGameState가 있으면 무조건 사용 (초기화 방지)
    if (preservedGameState.boardState && Array.isArray(preservedGameState.boardState) && preservedGameState.boardState.length > 0) {
        game.boardState = preservedGameState.boardState;
        console.log(`[getGameResult] Restored boardState from preservedGameState: size=${game.boardState.length}x${game.boardState[0]?.length || 0}`);
    } else {
        console.warn(`[getGameResult] preservedGameState.boardState is invalid, using game.boardState: size=${game.boardState?.length || 0}`);
    }
    if (preservedGameState.moveHistory && Array.isArray(preservedGameState.moveHistory) && preservedGameState.moveHistory.length > 0) {
        game.moveHistory = preservedGameState.moveHistory;
        console.log(`[getGameResult] Restored moveHistory from preservedGameState: length=${game.moveHistory.length}`);
    } else {
        console.warn(`[getGameResult] preservedGameState.moveHistory is invalid, using game.moveHistory: length=${game.moveHistory?.length || 0}`);
    }
    if (preservedGameState.blackTimeLeft !== undefined) {
        game.blackTimeLeft = preservedGameState.blackTimeLeft;
    }
    if (preservedGameState.whiteTimeLeft !== undefined) {
        game.whiteTimeLeft = preservedGameState.whiteTimeLeft;
    }
    
    // 최종 확인: boardState가 유효한지 확인
    const boardStateValid = game.boardState && Array.isArray(game.boardState) && game.boardState.length > 0 && 
                            game.boardState[0] && Array.isArray(game.boardState[0]) && game.boardState[0].length > 0;
    if (!boardStateValid) {
        console.error(`[getGameResult] ERROR: boardState is invalid after restoration! boardState=${JSON.stringify(game.boardState?.slice(0, 2))}`);
    }
    
    console.log(`[getGameResult] Game state before save: boardStateSize=${game.boardState?.length || 0}, boardStateValid=${boardStateValid}, moveHistoryLength=${game.moveHistory?.length || 0}, blackTimeLeft=${game.blackTimeLeft}, whiteTimeLeft=${game.whiteTimeLeft}`);
    
    await db.saveGame(game);
    const { broadcast } = await import('./socket.js');
    // 브로드캐스트 시 moveHistory, totalTurns, 시간 정보를 명시적으로 포함하되, boardState는 제외하여 대역폭 절약
    // scoring 상태로 변경될 때는 클라이언트에서 이미 boardState를 보존하고 있으므로 전송 불필요
    const gameToBroadcast = {
        ...game,
        // boardState는 제외 (클라이언트에서 보존)
        moveHistory: preservedGameState.moveHistory || game.moveHistory,
        totalTurns: preservedGameState.totalTurns ?? game.totalTurns,
        blackTimeLeft: preservedTimeInfo.blackTimeLeft ?? game.blackTimeLeft,
        whiteTimeLeft: preservedTimeInfo.whiteTimeLeft ?? game.whiteTimeLeft,
        blackPatternStones: preservedGameState.blackPatternStones || game.blackPatternStones,
        whitePatternStones: preservedGameState.whitePatternStones || game.whitePatternStones,
        captures: preservedGameState.captures || game.captures,
        baseStoneCaptures: preservedGameState.baseStoneCaptures || game.baseStoneCaptures,
        hiddenStoneCaptures: preservedGameState.hiddenStoneCaptures || game.hiddenStoneCaptures,
    };
    // boardState 제거하여 대역폭 절약
    delete (gameToBroadcast as any).boardState;
    const { broadcastToGameParticipants } = await import('./socket.js');
    broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: gameToBroadcast } }, game);
    console.log(`[getGameResult] Broadcasted game with preserved state (boardState excluded for bandwidth): moveHistoryLength=${gameToBroadcast.moveHistory?.length || 0}, totalTurns=${gameToBroadcast.totalTurns}`);
    console.log(`[getGameResult] Game ${game.id} set to scoring state and broadcasted (isSinglePlayer: ${game.isSinglePlayer}, stageId: ${game.stageId}, moveHistoryLength: ${game.moveHistory.length})`);
    
    // 카타고 분석 시작
    console.log(`[getGameResult] Starting KataGo analysis for game ${game.id}...`);
    console.log(`[getGameResult] Game details: isSinglePlayer=${game.isSinglePlayer}, stageId=${game.stageId}, moveHistoryLength=${game.moveHistory.length}, boardSize=${game.settings.boardSize}`);
    console.log(`[getGameResult] Board state validation: boardState exists=${!!game.boardState}, boardState size=${game.boardState?.length || 0}x${game.boardState?.[0]?.length || 0}, moveHistory length=${game.moveHistory?.length || 0}`);
    
    // 게임 상태 검증 (KataGo 분석 전)
    if (!game.boardState || !Array.isArray(game.boardState) || game.boardState.length === 0) {
        console.error(`[getGameResult] ERROR: Invalid boardState for game ${game.id}, cannot start KataGo analysis`);
        game.gameStatus = 'ended';
        game.isAnalyzing = false;
        await db.saveGame(game);
        return game;
    }
    
    // 보존된 게임 상태를 클로저에 저장하여 분석 완료 후에도 사용 가능하도록 함
    const savedPreservedGameState = preservedGameState;
    const savedPreservedTimeInfo = preservedTimeInfo;
    
    analyzeGame(game)
        .then(async (baseAnalysis) => {
            console.log(`[getGameResult] KataGo analysis completed for game ${game.id}, getting fresh game state...`);
            // 싱글플레이 게임은 메모리 캐시에서 먼저 찾기 (DB에 저장되지 않을 수 있음)
            let freshGame = null;
            if (game.isSinglePlayer) {
                const { getCachedGame } = await import('./gameCache.js');
                freshGame = await getCachedGame(game.id);
            }
            // 캐시에서 못 찾으면 DB에서 찾기
            if (!freshGame) {
                freshGame = await db.getLiveGame(game.id);
            }
            if (!freshGame) {
                console.error(`[getGameResult] Game ${game.id} not found in cache or database after analysis`);
                return;
            }
            
            // 게임 상태가 playing으로 변경되었으면 다시 scoring으로 변경 (게임 루프가 재시작한 경우)
            if (freshGame.gameStatus === 'playing' && freshGame.isSinglePlayer && freshGame.stageId) {
                console.log(`[getGameResult] Game ${game.id} was reset to playing during analysis, restoring scoring state`);
                
                // 보존된 게임 상태 복원
                const preservedState = (freshGame as any).preservedGameState || (game as any).preservedGameState || savedPreservedGameState;
                if (preservedState) {
                    if (preservedState.moveHistory && preservedState.moveHistory.length > 0) {
                        freshGame.moveHistory = preservedState.moveHistory;
                        console.log(`[getGameResult] Restored moveHistory (length: ${freshGame.moveHistory.length})`);
                    }
                    if (preservedState.boardState && preservedState.boardState.length > 0) {
                        freshGame.boardState = preservedState.boardState;
                        console.log(`[getGameResult] Restored boardState (size: ${freshGame.boardState.length}x${freshGame.boardState[0]?.length || 0})`);
                    }
                    if (preservedState.blackPatternStones) {
                        freshGame.blackPatternStones = preservedState.blackPatternStones;
                    }
                    if (preservedState.whitePatternStones) {
                        freshGame.whitePatternStones = preservedState.whitePatternStones;
                    }
                    if (preservedState.captures) {
                        freshGame.captures = preservedState.captures;
                    }
                    if (preservedState.baseStoneCaptures) {
                        freshGame.baseStoneCaptures = preservedState.baseStoneCaptures;
                    }
                    if (preservedState.hiddenStoneCaptures) {
                        freshGame.hiddenStoneCaptures = preservedState.hiddenStoneCaptures;
                    }
                    // 시간 정보도 복원
                    if (preservedState.blackTimeLeft !== undefined) {
                        freshGame.blackTimeLeft = preservedState.blackTimeLeft;
                    }
                    if (preservedState.whiteTimeLeft !== undefined) {
                        freshGame.whiteTimeLeft = preservedState.whiteTimeLeft;
                    }
                    // totalTurns도 복원
                    if (preservedState.totalTurns !== undefined) {
                        freshGame.totalTurns = preservedState.totalTurns;
                    }
                    console.log(`[getGameResult] Restored time info: blackTimeLeft=${freshGame.blackTimeLeft}, whiteTimeLeft=${freshGame.whiteTimeLeft}, totalTurns=${freshGame.totalTurns}`);
                } else {
                    // 보존된 상태가 없으면 원본 게임 상태 사용
                    if (game.moveHistory && game.moveHistory.length > 0) {
                        freshGame.moveHistory = game.moveHistory;
                        console.log(`[getGameResult] Restored moveHistory from game (length: ${freshGame.moveHistory.length})`);
                    }
                    if (game.boardState && game.boardState.length > 0) {
                        freshGame.boardState = game.boardState;
                        console.log(`[getGameResult] Restored boardState from game (size: ${freshGame.boardState.length}x${freshGame.boardState[0]?.length || 0})`);
                    }
                }
                
                freshGame.gameStatus = 'scoring';
                freshGame.isAnalyzing = true;
                (freshGame as any).isScoringProtected = true;
                (freshGame as any).preservedGameState = preservedState || (game as any).preservedGameState;
                (freshGame as any).preservedTimeInfo = (game as any).preservedTimeInfo || savedPreservedTimeInfo || preservedTimeInfo;
                await db.saveGame(freshGame);
                const { broadcast } = await import('./socket.js');
                // 브로드캐스트 시 preservedGameState를 명시적으로 포함하되, boardState는 제외하여 대역폭 절약
                // 클라이언트에서 이미 boardState를 보존하고 있으므로 전송 불필요
                const gameToBroadcast = {
                    ...freshGame,
                    // boardState는 제외 (클라이언트에서 보존)
                    moveHistory: preservedState?.moveHistory || freshGame.moveHistory,
                    totalTurns: preservedState?.totalTurns ?? freshGame.totalTurns,
                    blackTimeLeft: (freshGame as any).preservedTimeInfo?.blackTimeLeft ?? freshGame.blackTimeLeft,
                    whiteTimeLeft: (freshGame as any).preservedTimeInfo?.whiteTimeLeft ?? freshGame.whiteTimeLeft,
                    blackPatternStones: preservedState?.blackPatternStones || freshGame.blackPatternStones,
                    whitePatternStones: preservedState?.whitePatternStones || freshGame.whitePatternStones,
                    captures: preservedState?.captures || freshGame.captures,
                    baseStoneCaptures: preservedState?.baseStoneCaptures || freshGame.baseStoneCaptures,
                    hiddenStoneCaptures: preservedState?.hiddenStoneCaptures || freshGame.hiddenStoneCaptures,
                };
                // boardState 제거하여 대역폭 절약
                delete (gameToBroadcast as any).boardState;
                const { broadcastToGameParticipants } = await import('./socket.js');
                broadcastToGameParticipants(freshGame.id, { type: 'GAME_UPDATE', payload: { [freshGame.id]: gameToBroadcast } }, freshGame);
            }
            
            if (freshGame.gameStatus !== 'scoring') {
                console.log(`[getGameResult] Game ${game.id} no longer in scoring state (status: ${freshGame.gameStatus}), skipping analysis result`);
                return;
            }

            console.log(`[getGameResult] Finalizing analysis result for game ${game.id}...`);
            // 보존된 시간 정보를 사용하여 시간 보너스 계산 (게임이 재시작되어 시간이 초기화된 경우 대비)
            const timeInfoToUse = (freshGame as any).preservedTimeInfo || savedPreservedTimeInfo || preservedTimeInfo;
            console.log(`[getGameResult] Using time info for bonus: blackTimeLeft=${timeInfoToUse.blackTimeLeft}, whiteTimeLeft=${timeInfoToUse.whiteTimeLeft}`);
            const finalAnalysis = finalizeAnalysisResult(baseAnalysis, freshGame, timeInfoToUse);

            if (!freshGame.analysisResult) freshGame.analysisResult = {};
            freshGame.analysisResult['system'] = finalAnalysis;
            freshGame.finalScores = {
                black: finalAnalysis.scoreDetails.black.total,
                white: finalAnalysis.scoreDetails.white.total
            };
            freshGame.isAnalyzing = false;
            
            // 분석 결과 저장 및 브로드캐스트 (계가 화면에 표시되도록)
            // 보존된 게임 상태를 사용하여 브로드캐스트하되, boardState는 제외하여 대역폭 절약
            const preservedStateForBroadcast = (freshGame as any).preservedGameState || savedPreservedGameState;
            const timeInfoForBroadcast = (freshGame as any).preservedTimeInfo || savedPreservedTimeInfo || preservedTimeInfo;
            const gameToBroadcast = {
                ...freshGame,
                // boardState는 제외 (클라이언트에서 보존)
                moveHistory: preservedStateForBroadcast?.moveHistory || freshGame.moveHistory,
                totalTurns: preservedStateForBroadcast?.totalTurns ?? freshGame.totalTurns,
                blackTimeLeft: timeInfoForBroadcast?.blackTimeLeft ?? freshGame.blackTimeLeft,
                whiteTimeLeft: timeInfoForBroadcast?.whiteTimeLeft ?? freshGame.whiteTimeLeft,
                blackPatternStones: preservedStateForBroadcast?.blackPatternStones || freshGame.blackPatternStones,
                whitePatternStones: preservedStateForBroadcast?.whitePatternStones || freshGame.whitePatternStones,
                captures: preservedStateForBroadcast?.captures || freshGame.captures,
                baseStoneCaptures: preservedStateForBroadcast?.baseStoneCaptures || freshGame.baseStoneCaptures,
                hiddenStoneCaptures: preservedStateForBroadcast?.hiddenStoneCaptures || freshGame.hiddenStoneCaptures,
            };
            // boardState 제거하여 대역폭 절약
            delete (gameToBroadcast as any).boardState;
            await db.saveGame(freshGame);
            const { broadcastToGameParticipants } = await import('./socket.js');
            broadcastToGameParticipants(freshGame.id, { type: 'GAME_UPDATE', payload: { [freshGame.id]: gameToBroadcast } }, freshGame);
            console.log(`[getGameResult] Broadcasted final result with preserved state: boardStateSize=${gameToBroadcast.boardState?.length || 0}, moveHistoryLength=${gameToBroadcast.moveHistory?.length || 0}, totalTurns=${gameToBroadcast.totalTurns}`);
            console.log(`[getGameResult] Analysis complete for game ${freshGame.id}, scores: Black ${finalAnalysis.scoreDetails.black.total}, White ${finalAnalysis.scoreDetails.white.total}`);
            
            // 승자 판정: 흑의 점수가 백의 점수보다 크면 흑 승리, 같거나 작으면 백 승리 (덤 때문에)
            const blackTotal = finalAnalysis.scoreDetails.black.total;
            const whiteTotal = finalAnalysis.scoreDetails.white.total;
            const winner = blackTotal > whiteTotal
                ? types.Player.Black
                : types.Player.White;
            
            console.log(`[getGameResult] Winner determination: Black=${blackTotal}, White=${whiteTotal}, Winner=${winner === types.Player.Black ? 'Black' : 'White'}, ScoreDiff=${Math.abs(blackTotal - whiteTotal).toFixed(1)}`);
            
            await endGame(freshGame, winner, 'score');
        })
        .catch(async (error) => {
            console.error(`[getGameResult] KataGo analysis failed for game ${game.id}:`, error);
            console.error(`[getGameResult] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
            // 싱글플레이 게임은 메모리 캐시에서 먼저 찾기
            let failedGame = null;
            if (game.isSinglePlayer) {
                const { getCachedGame } = await import('./gameCache.js');
                failedGame = await getCachedGame(game.id);
            }
            // 캐시에서 못 찾으면 DB에서 찾기
            if (!failedGame) {
                failedGame = await db.getLiveGame(game.id);
            }
            if (failedGame && failedGame.gameStatus === 'scoring') {
                console.log(`[getGameResult] Game ${failedGame.id} still in scoring state, setting isAnalyzing to false and ending game with fallback winner`);
                failedGame.isAnalyzing = false;
                
                // 보존된 게임 상태 복원 (에러 발생 시에도 게임 상태 유지)
                const preservedState = (failedGame as any).preservedGameState || (game as any).preservedGameState;
                if (preservedState) {
                    if (preservedState.moveHistory && preservedState.moveHistory.length > 0) {
                        failedGame.moveHistory = preservedState.moveHistory;
                    }
                    if (preservedState.boardState && preservedState.boardState.length > 0) {
                        failedGame.boardState = preservedState.boardState;
                    }
                    if (preservedState.captures) {
                        failedGame.captures = preservedState.captures;
                    }
                    if (preservedState.totalTurns !== undefined) {
                        failedGame.totalTurns = preservedState.totalTurns;
                    }
                }
                
                await db.saveGame(failedGame);
                const { broadcastToGameParticipants } = await import('./socket.js');
                
                // 브로드캐스트 시 보존된 상태 포함
                const gameToBroadcast = {
                    ...failedGame,
                    moveHistory: preservedState?.moveHistory || failedGame.moveHistory,
                    totalTurns: preservedState?.totalTurns ?? failedGame.totalTurns,
                    captures: preservedState?.captures || failedGame.captures,
                };
                broadcastToGameParticipants(failedGame.id, { type: 'GAME_UPDATE', payload: { [failedGame.id]: gameToBroadcast } }, failedGame);
                
                // Decide a winner randomly as a fallback
                const winner = Math.random() < 0.5 ? types.Player.Black : types.Player.White;
                console.log(`[getGameResult] Ending game ${failedGame.id} with fallback winner: ${winner === types.Player.Black ? 'Black' : 'White'}`);
                // End the game properly to process summaries and rewards
                await endGame(failedGame, winner, 'score'); // Re-use 'score' reason, as it's a scoring failure
            } else {
                console.error(`[getGameResult] Game ${game.id} not found or not in scoring state after analysis failure`);
            }
        });
    return game;
};

export const getNewActionButtons = (game: types.LiveGameSession): ActionButton[] => {
    const { mode, moveHistory } = game;
    
    let phase: 'early' | 'mid' | 'late';
    const isPlayful = PLAYFUL_GAME_MODES.some((m: { mode: GameMode }) => m.mode === mode);

    if (isPlayful) {
        // Use round-based phase for most playful games
        const currentRound = game.alkkagiRound || game.curlingRound || game.round || 1;
        const totalRounds = game.settings.alkkagiRounds || game.settings.curlingRounds || game.settings.diceGoRounds || 2;

        if (currentRound === 1) {
            phase = 'early';
        } else if (currentRound === totalRounds) {
            phase = 'late';
        } else {
            phase = 'mid';
        }
    } else { // Strategic
        const moveCount = moveHistory.length;
        if (moveCount <= 30) {
            phase = 'early';
        } else if (moveCount >= 31 && moveCount <= 150) {
            phase = 'mid';
        } else { // moveCount >= 151
            phase = 'late';
        }
    }

    let sourceDeck: ActionButton[];

    if (isPlayful) {
        switch (phase) {
            case 'early': sourceDeck = PLAYFUL_ACTION_BUTTONS_EARLY; break;
            case 'mid':   sourceDeck = PLAYFUL_ACTION_BUTTONS_MID; break;
            case 'late':  sourceDeck = PLAYFUL_ACTION_BUTTONS_LATE; break;
        }
    } else { // Strategic
        switch (phase) {
            case 'early': sourceDeck = STRATEGIC_ACTION_BUTTONS_EARLY; break;
            case 'mid':   sourceDeck = STRATEGIC_ACTION_BUTTONS_MID; break;
            case 'late':  sourceDeck = STRATEGIC_ACTION_BUTTONS_LATE; break;
        }
    }

    const shuffledButtons = [...sourceDeck].sort(() => 0.5 - Math.random());
    const manners = shuffledButtons.filter(b => b.type === 'manner');
    const unmanners = shuffledButtons.filter(b => b.type === 'unmannerly');

    const mannerCount = Math.random() > 0.5 ? 1 : 2;
    const selectedManners = manners.slice(0, mannerCount);
    
    const neededUnmanners = 3 - selectedManners.length;
    const selectedUnmanners = unmanners.slice(0, neededUnmanners);

    let result = [...selectedManners, ...selectedUnmanners];
    
    if (result.length < 3) {
        const existingNames = new Set(result.map(b => b.name));
        const filler = shuffledButtons.filter(b => !existingNames.has(b.name));
        result.push(...filler.slice(0, 3 - result.length));
    }
    
    return result.slice(0, 3).sort(() => 0.5 - Math.random());
};

export const initializeGame = async (neg: Negotiation): Promise<LiveGameSession> => {
    const gameId = `game-${randomUUID()}`;
    const { settings, mode } = neg;
    const now = Date.now();
    
    const challenger = await db.getUser(neg.challenger.id);
    const opponent = neg.opponent.id === aiUserId ? getAiUser(neg.mode) : await db.getUser(neg.opponent.id);

    if (!challenger || !opponent) {
        throw new Error(`Could not find one or more players to start the game: ${neg.challenger.id}, ${neg.opponent.id}`);
    }
    
    const isAiGame = opponent.id === aiUserId;
    
    const descriptions = RANDOM_DESCRIPTIONS[mode] || [`${mode} 한 판!`];
    const randomDescription = descriptions[Math.floor(Math.random() * descriptions.length)];

    const game: LiveGameSession = {
        id: gameId,
        mode, settings, description: randomDescription, player1: challenger, player2: opponent, isAiGame,
        gameCategory: GameCategory.Normal,  // 일반 게임은 normal 카테고리
        isRankedGame: neg.isRanked ?? false, // 협상에서 isRanked 플래그 가져오기
        boardState: Array(settings.boardSize).fill(0).map(() => Array(settings.boardSize).fill(types.Player.None)),
        moveHistory: [], captures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 },
        baseStoneCaptures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 }, 
        hiddenStoneCaptures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 },
        winner: null, winReason: null, createdAt: now, lastMove: null, passCount: 0, koInfo: null,
        winningLine: null, statsUpdated: false, blackTimeLeft: settings.timeLimit * 60, whiteTimeLeft: settings.timeLimit * 60,
        blackByoyomiPeriodsLeft: settings.byoyomiCount, whiteByoyomiPeriodsLeft: settings.byoyomiCount,
        disconnectionState: null, disconnectionCounts: { [challenger.id]: 0, [opponent.id]: 0 },
        currentActionButtons: { [challenger.id]: [], [opponent.id]: [] },
        actionButtonCooldownDeadline: {},
        actionButtonUsedThisCycle: { [challenger.id]: false, [opponent.id]: false },
        missileUsedThisTurn: false,
        maxActionButtonUses: 5, actionButtonUses: { [challenger.id]: 0, [opponent.id]: 0 },
        round: 1, turnInRound: 1, newlyRevealed: [], scores: { [challenger.id]: 0, [opponent.id]: 0 },
        analysisResult: null, isAnalyzing: false,
        gameStatus: 'pending', blackPlayerId: null, whitePlayerId: null, currentPlayer: types.Player.None,
        gameStartTime: undefined, // 게임이 실제로 시작될 때 설정됨
    };

    if (SPECIAL_GAME_MODES.some(m => m.mode === mode)) {
        await initializeStrategicGame(game, neg, now);
    } else if (PLAYFUL_GAME_MODES.some((m: { mode: GameMode; }) => m.mode === mode)) {
        await initializePlayfulGame(game, neg, now);
    }
    
    if (game.gameStatus === 'playing' && game.currentPlayer === types.Player.None) {
        game.currentPlayer = types.Player.Black;
        if (settings.timeLimit > 0) game.turnDeadline = now + game.blackTimeLeft * 1000;
        game.turnStartTime = now;
    }
    
    return game;
};

export const resetGameForRematch = (game: LiveGameSession, negotiation: types.Negotiation): LiveGameSession => {
    const newGame = { ...game, id: `game-${randomUUID()}` };

    newGame.mode = negotiation.mode;
    newGame.settings = negotiation.settings;
    // 게임 카테고리는 원래 게임의 카테고리 유지 (일반 게임의 리매치는 일반 게임)
    newGame.gameCategory = game.gameCategory ?? GameCategory.Normal;
    
    const now = Date.now();
    const baseFields = {
        winner: null, winReason: null, statsUpdated: false, summary: undefined, finalScores: undefined,
        winningLine: null,
        boardState: Array(newGame.settings.boardSize).fill(0).map(() => Array(newGame.settings.boardSize).fill(types.Player.None)),
        moveHistory: [], captures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 }, 
        baseStoneCaptures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 }, 
        hiddenStoneCaptures: { [types.Player.None]: 0, [types.Player.Black]: 0, [types.Player.White]: 0 }, 
        lastMove: null, passCount: 0, koInfo: null,
        blackTimeLeft: newGame.settings.timeLimit * 60, whiteTimeLeft: newGame.settings.timeLimit * 60,
        blackByoyomiPeriodsLeft: newGame.settings.byoyomiCount, whiteByoyomiPeriodsLeft: newGame.settings.byoyomiCount,
        currentActionButtons: { [game.player1.id]: [], [game.player2.id]: [] },
        actionButtonCooldownDeadline: {},
        actionButtonUsedThisCycle: { [game.player1.id]: false, [game.player2.id]: false },
        missileUsedThisTurn: false,
        actionButtonUses: { [game.player1.id]: 0, [game.player2.id]: 0 },
        isAnalyzing: false, analysisResult: null, round: 1, turnInRound: 1,
        scores: { [game.player1.id]: 0, [game.player2.id]: 0 },
        rematchRejectionCount: undefined,
    };

    Object.assign(newGame, baseFields);

    if (SPECIAL_GAME_MODES.some(m => m.mode === newGame.mode)) {
        initializeStrategicGame(newGame, negotiation, now);
    } else if (PLAYFUL_GAME_MODES.some((m: { mode: GameMode }) => m.mode === newGame.mode)) {
        initializePlayfulGame(newGame, negotiation, now);
    }
    
    return newGame;
};

export const updateGameStates = async (games: LiveGameSession[], now: number): Promise<LiveGameSession[]> => {
    // 싱글플레이 게임과 멀티플레이 게임을 분리하여 처리
    // 도전의 탑도 싱글플레이어 게임과 동일하게 처리
    const singlePlayerGames: LiveGameSession[] = [];
    const multiPlayerGames: LiveGameSession[] = [];
    
    for (const game of games) {
        if (game.isSinglePlayer || game.gameCategory === 'tower' || game.isAiGame) {
            singlePlayerGames.push(game);
        } else {
            multiPlayerGames.push(game);
        }
    }

    // 싱글플레이 게임은 완전히 독립적으로 병렬 처리 (각 게임이 서로 영향을 주지 않음)
    const processSinglePlayerGame = async (game: LiveGameSession): Promise<LiveGameSession> => {
        return processGame(game, now);
    };

    // 멀티플레이 게임 처리
    const processMultiPlayerGame = async (game: LiveGameSession): Promise<LiveGameSession> => {
        return processGame(game, now);
    };

    // 싱글플레이와 멀티플레이를 병렬로 처리
    const [singlePlayerResults, multiPlayerResults] = await Promise.all([
        Promise.all(singlePlayerGames.map(processSinglePlayerGame)),
        Promise.all(multiPlayerGames.map(processMultiPlayerGame)),
    ]);

    return [...singlePlayerResults, ...multiPlayerResults];
};

const processGame = async (game: LiveGameSession, now: number): Promise<LiveGameSession> => {
        // pending 상태의 게임은 아직 시작되지 않았으므로 게임 루프에서 처리하지 않음
        if (game.gameStatus === 'pending') {
            return game;
        }

        // scoring 상태인 게임은 업데이트하지 않음 (계가 진행 중) - 가장 먼저 체크
        if (game.gameStatus === 'scoring' || (game as any).isScoringProtected) {
            return game;
        }

        try {
            if (game.disconnectionState && (now - game.disconnectionState.timerStartedAt > 90000)) {
                // 90초 내에 재접속하지 못하면 시간패배 처리
                game.winner = game.blackPlayerId === game.disconnectionState.disconnectedPlayerId ? types.Player.White : types.Player.Black;
                game.winReason = 'timeout';
                game.gameStatus = 'ended';
                game.disconnectionState = null;
                await summaryService.endGame(game, game.winner, 'timeout');
            }

            if (game.lastTimeoutPlayerIdClearTime && now >= game.lastTimeoutPlayerIdClearTime) {
                game.lastTimeoutPlayerId = null;
                game.lastTimeoutPlayerIdClearTime = undefined;
            }

            // Add null checks for players to prevent crashes on corrupted game data.
            if (!game.player1 || !game.player2) {
                console.warn(`[Game Loop] Skipping corrupted game ${game.id} with missing player data.`);
                return game;
            }

            // PVE 게임 (싱글플레이어, 도전의 탑)은 클라이언트에서 실행되므로 서버 루프에서 제외
            // AI 게임은 서버에서 처리해야 하므로 PVE 게임에서 제외
            const isPVEGame = game.isSinglePlayer || game.gameCategory === 'tower' || game.gameCategory === 'singleplayer';
            const isTower = game.gameCategory === 'tower';
            if (isPVEGame) {
                // PVE 게임은 클라이언트에서 실행되므로 서버에서는 최소한의 처리만 수행
                // player1 정보만 필요시 업데이트 (AI는 업데이트 불필요)
                const { getCachedUser } = await import('./gameCache.js');
                const p1 = await getCachedUser(game.player1.id);
                if (p1) game.player1 = p1;

                // 도전의 탑은 클라이언트에서 모든 처리가 이루어지므로 서버에서 액션 버튼 업데이트 불필요
                // 싱글플레이어만 액션 버튼 업데이트 수행
                if (game.isSinglePlayer && !isTower) {
                    const playableStatuses: types.GameStatus[] = [
                        'playing', 'hidden_placing', 'scanning', 'missile_selecting',
                        'alkkagi_playing',
                        'curling_playing',
                        'dice_rolling',
                        'dice_placing',
                        'thief_rolling',
                        'thief_placing',
                    ];

                    // 액션 버튼 업데이트만 수행 (싱글플레이에서만)
                    if (playableStatuses.includes(game.gameStatus)) {
                        if (!game.currentActionButtons) game.currentActionButtons = {};
                        const deadline = game.actionButtonCooldownDeadline?.[game.player1.id];
                        if (typeof deadline !== 'number' || now >= deadline) {
                            game.currentActionButtons[game.player1.id] = getNewActionButtons(game);

                            const effects = effectService.calculateUserEffects(game.player1);
                            const cooldown = (5 * 60 - (effects.mythicStatBonuses[types.MythicStat.MannerActionCooldown]?.flat || 0)) * 1000;

                            if (!game.actionButtonCooldownDeadline) game.actionButtonCooldownDeadline = {};
                            game.actionButtonCooldownDeadline[game.player1.id] = now + cooldown;
                            if (game.actionButtonUsedThisCycle) {
                                game.actionButtonUsedThisCycle[game.player1.id] = false;
                            }
                        }
                    }
                }

                // PVE 게임은 클라이언트에서 실행되지만, 미사일 애니메이션 등 일부 상태 업데이트는 서버에서도 처리 필요
                // 미사일 애니메이션 업데이트 (애니메이션 종료 시 게임 상태 복원)
                if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                    await updateStrategicGameState(game, now);
                    // 미사일 상태가 변경된 경우 (아이템 시간 초과 등) DB 저장 및 브로드캐스트 필요
                    if ((game as any)._missileStateChanged) {
                        (game as any)._missileStateChanged = false;
                        const { updateGameCache } = await import('./gameCache.js');
                        updateGameCache(game);
                        await db.saveGame(game);
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                    }
                } else if (PLAYFUL_GAME_MODES.some((m: { mode: GameMode }) => m.mode === game.mode)) {
                    await updatePlayfulGameState(game, now);
                }
                
                // PVE 게임은 클라이언트에서 실행되므로 서버에서는 최소한의 정보만 유지 (게임 종료 시 저장용)
                return game;
            }

            // 멀티플레이 게임 처리 (기존 로직)
            // 캐시를 사용하여 DB 조회 최소화
            const { getCachedUser } = await import('./gameCache.js');
            const p1 = await getCachedUser(game.player1.id);
            const p2 = game.player2.id === aiUserId ? getAiUser(game.mode) : await getCachedUser(game.player2.id);
            if (p1) game.player1 = p1;
            if (p2) game.player2 = p2;

            const players = [game.player1, game.player2].filter(p => p.id !== aiUserId);

            // AI 세션을 현재 게임 상태와 동기화 (재시작/재연결 시 안전 장치)
            syncAiSession(game, aiUserId);

            const playableStatuses: types.GameStatus[] = [
                'playing', 'hidden_placing', 'scanning', 'missile_selecting',
                'alkkagi_playing',
                'curling_playing',
                'dice_rolling',
                'dice_placing',
                'thief_rolling',
                'thief_placing',
            ];

            if (playableStatuses.includes(game.gameStatus)) {
                // Ensure maps are initialized before per-player writes
                if (!game.currentActionButtons) game.currentActionButtons = {};
                if (!game.actionButtonCooldownDeadline) game.actionButtonCooldownDeadline = {};
                if (!game.actionButtonUsedThisCycle) game.actionButtonUsedThisCycle = {};

                for (const player of players) {
                    const deadline = game.actionButtonCooldownDeadline?.[player.id];
                    if (typeof deadline !== 'number' || now >= deadline) {
                        game.currentActionButtons[player.id] = getNewActionButtons(game);

                        const effects = effectService.calculateUserEffects(player);
                        const cooldown = (5 * 60 - (effects.mythicStatBonuses[types.MythicStat.MannerActionCooldown]?.flat || 0)) * 1000;

                        game.actionButtonCooldownDeadline[player.id] = now + cooldown;
                        game.actionButtonUsedThisCycle[player.id] = false;
                    }
                }
            }

            const isAiTurn = game.isAiGame && game.currentPlayer !== types.Player.None &&
                (game.currentPlayer === types.Player.Black ? game.blackPlayerId === aiUserId : game.whitePlayerId === aiUserId) &&
                // 클라이언트 전용 AI로 동작시킬 게임(도전의 탑)은 서버에서 AI 수를 처리하지 않음
                game.gameCategory !== 'tower';

            // 멀티플레이 AI 게임의 경우에만 메인 루프에서 AI 수 처리
            if (isAiTurn && game.gameStatus !== 'ended' && !['missile_animating', 'hidden_reveal_animating', 'alkkagi_animating', 'curling_animating'].includes(game.gameStatus)) {
                if (!game.aiTurnStartTime) {
                    game.aiTurnStartTime = now + (1000 + Math.random() * 1500);
                }
                if (now >= game.aiTurnStartTime) {
                    const initialMoveCount = game.moveHistory?.length ?? 0;
                    await makeAiMove(game);

                    const moveCountAfter = game.moveHistory?.length ?? initialMoveCount;
                    const aiActuallyMoved = moveCountAfter > initialMoveCount;

                    if (aiActuallyMoved) {
                        game.aiTurnStartTime = undefined;
                        if (!game.turnStartTime) {
                            game.turnStartTime = now;
                        }
                    } else {
                        game.aiTurnStartTime = now + 50;
                    }
                }
            }

            if (SPECIAL_GAME_MODES.some(m => m.mode === game.mode)) {
                await updateStrategicGameState(game, now);
            } else if (PLAYFUL_GAME_MODES.some((m: { mode: GameMode }) => m.mode === game.mode)) {
                await updatePlayfulGameState(game, now);
            }

            return game;
        } catch (error) {
            console.error(`[Game Loop] Failed to update game ${game.id}:`, error);
            return game;
        }
};
