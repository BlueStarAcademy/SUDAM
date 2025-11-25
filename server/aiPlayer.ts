import { User, GameMode, LiveGameSession, Player, Point, AlkkagiStone, BoardState, Equipment, InventoryItem, LeagueTier, CoreStat, RecommendedMove } from '../types/index.js';
import { defaultStats, createDefaultInventory, createDefaultQuests, createDefaultBaseStats, createDefaultSpentStatPoints } from './initialData.js';
import { getOmokLogic } from './omokLogic.js';
import { getGoLogic, processMove } from './goLogic.js';
import { DICE_GO_MAIN_ROLL_TIME, DICE_GO_LAST_CAPTURE_BONUS_BY_TOTAL_ROUNDS, ALKKAGI_PLACEMENT_TIME_LIMIT, ALKKAGI_TURN_TIME_LIMIT, SPECIAL_GAME_MODES, SINGLE_PLAYER_STAGES, ALKKAGI_SIMULTANEOUS_PLACEMENT_TIME_LIMIT, CURLING_TURN_TIME_LIMIT, BATTLE_PLACEMENT_ZONES } from '../constants';
import * as types from '../types/index.js';
import { analyzeGame } from './kataGoService.js';
import * as summaryService from './summaryService.js';
import { makeGoAiBotMove } from './goAiBot.js';
import * as db from './db.js';
import {
    shouldProcessAiTurn,
    startAiProcessing,
    finishAiProcessing,
    cancelAiProcessing,
} from './aiSessionManager.js';
import { getCaptureTarget, NO_CAPTURE_TARGET } from './utils/captureTargets.ts';


export const aiUserId = 'ai-player-01';

const aiInventory = createDefaultInventory();
const aiEquipment = aiInventory
    .filter(item => item.isEquipped)
    .reduce((acc, item) => {
        if(item.slot) acc[item.slot] = item.name;
        return acc;
    }, {} as Equipment);

const baseAiUser: Omit<User, 'nickname'> = {
    id: aiUserId,
    username: 'ai_bot',
    isAdmin: false,
    strategyLevel: 50,
    strategyXp: 0,
    playfulLevel: 50,
    playfulXp: 0,
    blacksmithLevel: 1,
    blacksmithXp: 0,
    baseStats: createDefaultBaseStats(),
    spentStatPoints: createDefaultSpentStatPoints(),
    inventory: aiInventory,
    inventorySlots: { equipment: 40, consumable: 40, material: 40 },
    equipment: aiEquipment,
    actionPoints: { current: 999, max: 999 },
    lastActionPointUpdate: Date.now(),
    actionPointPurchasesToday: 0,
    lastActionPointPurchaseDate: 0,
    dailyShopPurchases: {},
    gold: 99999,
    diamonds: 9999,
    mannerScore: 200,
    mail: [],
    quests: createDefaultQuests(),
    stats: JSON.parse(JSON.stringify(defaultStats)),
    avatarId: 'default',
    borderId: 'default',
    ownedBorders: ['default'],
    tournamentScore: 2250,
    league: types.LeagueTier.Challenger,
};

const aiNicknames: Record<GameMode, string> = {
    [GameMode.Standard]: '클래식바둑봇',
    [GameMode.Capture]: '따내기바둑봇',
    [GameMode.Speed]: '스피드바둑봇',
    [GameMode.Base]: '베이스바둑봇',
    [GameMode.Hidden]: '히든바둑봇',
    [GameMode.Missile]: '미사일바둑봇',
    [GameMode.Mix]: '믹스룰바둑봇',
    [GameMode.Dice]: '주사위바둑봇',
    [GameMode.Omok]: '오목봇',
    [GameMode.Ttamok]: '따목봇',
    [GameMode.Thief]: '도둑과 경찰봇',
    [GameMode.Alkkagi]: '알까기봇',
    [GameMode.Curling]: '바둑 컬링',
};

export const getAiUser = (mode: GameMode): User => {
    return {
        ...baseAiUser,
        nickname: aiNicknames[mode] || 'AI 봇',
    };
};

const makeSimpleCaptureAiMove = (game: types.LiveGameSession) => {
    const difficulty = game.settings.aiDifficulty ?? 1;
    const probability = difficulty / 10.0;
    const aiPlayer = game.currentPlayer;
    const humanPlayer = aiPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
    const logic = getGoLogic(game);
    const boardSize = game.settings.boardSize;
    const now = Date.now();

    const applyMove = (move: Point) => {
        const result = processMove(game.boardState, { ...move, player: aiPlayer }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
        if (!result.isValid) {
            console.error(`[Simple AI] Invalid move generated: ${JSON.stringify(move)} for game ${game.id}. Reason: ${result.reason}`);
            return;
        }
        
        game.boardState = result.newBoardState;
        game.lastMove = move;
        game.moveHistory.push({ player: aiPlayer, ...move });
        game.koInfo = result.newKoInfo;
        game.passCount = move.x === -1 ? game.passCount + 1 : 0;

        if (result.capturedStones.length > 0) {
            if (!game.justCaptured) game.justCaptured = [];
            for (const stone of result.capturedStones) {
                const wasPatternStone = (humanPlayer === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                        (humanPlayer === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
                const points = wasPatternStone ? 2 : 1;
                game.captures[aiPlayer] += points;
                game.justCaptured.push({ point: stone, player: humanPlayer, wasHidden: false });
            }
        }
        
        const target = getCaptureTarget(game, aiPlayer);
        if (target !== undefined && target !== NO_CAPTURE_TARGET && game.captures[aiPlayer] >= target) {
            summaryService.endGame(game, aiPlayer, 'capture_limit');
            return;
        }
        
        game.currentPlayer = humanPlayer;
        game.turnStartTime = now;
        const stage = SINGLE_PLAYER_STAGES.find(s => s.id === game.stageId);
        if(stage) {
            if (stage.timeControl.type === 'byoyomi') {
                 game.turnDeadline = now + (stage.timeControl.mainTime * 60 * 1000);
            } else { // fischer
                 game.turnDeadline = now + (stage.timeControl.mainTime * 60 * 1000);
            }
        } else {
            game.turnDeadline = now + 300 * 1000; // 5 min fallback
        }
    };

    const findValidMoves = (board: types.BoardState, player: Player): Point[] => {
        const moves: Point[] = [];
        for (let y = 0; y < boardSize; y++) {
            for (let x = 0; x < boardSize; x++) {
                if (board[y][x] === types.Player.None) {
                    const res = processMove(board, { x, y, player }, game.koInfo, game.moveHistory.length);
                    if (res.isValid) {
                        moves.push({ x, y });
                    }
                }
            }
        }
        return moves;
    };

    const allValidAiMoves = findValidMoves(game.boardState, aiPlayer);
    if (allValidAiMoves.length === 0) {
        applyMove({ x: -1, y: -1 });
        return;
    }

    // 1. Winning Capture
    if (Math.random() < probability) {
        const target = getCaptureTarget(game, aiPlayer);
        const winningMoves = target === undefined || target === NO_CAPTURE_TARGET
            ? []
            : allValidAiMoves.filter(move => {
                const res = processMove(game.boardState, { ...move, player: aiPlayer }, game.koInfo, game.moveHistory.length);
                if (!res.isValid) return false;
                const captureGain = res.capturedStones.length * (res.capturedStones.some(s => game.whitePatternStones?.some(p => p.x === s.x && p.y === s.y)) ? 2 : 1);
                return (game.captures[aiPlayer] + captureGain) >= target;
            });
        if (winningMoves.length > 0) {
            applyMove(winningMoves[Math.floor(Math.random() * winningMoves.length)]);
            return;
        }
    }
    
    // 2. Block Opponent's Winning Capture
    if (Math.random() < probability) {
        const opponentTarget = getCaptureTarget(game, humanPlayer);
        const opponentWinningMoves = opponentTarget === undefined || opponentTarget === NO_CAPTURE_TARGET
            ? []
            : findValidMoves(game.boardState, humanPlayer).filter(move => {
                const res = processMove(game.boardState, { ...move, player: humanPlayer }, game.koInfo, game.moveHistory.length);
                if (!res.isValid) return false;
                const captureGain = res.capturedStones.length * (res.capturedStones.some(s => game.blackPatternStones?.some(p => p.x === s.x && p.y === s.y)) ? 2 : 1);
                return (game.captures[humanPlayer] + captureGain) >= opponentTarget;
            });

        if (opponentWinningMoves.length > 0) {
            const blockMove = opponentWinningMoves[Math.floor(Math.random() * opponentWinningMoves.length)];
             if (allValidAiMoves.some(m => m.x === blockMove.x && m.y === blockMove.y)) {
                applyMove(blockMove);
                return;
             }
        }
    }

    // 3. Maximize Capture
    if (Math.random() < probability) {
        let maxCapture = 0;
        let maxCaptureMoves: Point[] = [];
        allValidAiMoves.forEach(move => {
            const res = processMove(game.boardState, { ...move, player: aiPlayer }, game.koInfo, game.moveHistory.length);
            if (res.isValid && res.capturedStones.length > 0) {
                const captureScore = res.capturedStones.reduce((acc, stone) => {
                    const isPattern = game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y);
                    return acc + (isPattern ? 2 : 1);
                }, 0);
                if (captureScore > maxCapture) {
                    maxCapture = captureScore;
                    maxCaptureMoves = [move];
                } else if (captureScore === maxCapture) {
                    maxCaptureMoves.push(move);
                }
            }
        });
        if (maxCaptureMoves.length > 0) {
            applyMove(maxCaptureMoves[Math.floor(Math.random() * maxCaptureMoves.length)]);
            return;
        }
    }
    
    // 4. Atari opponent
    if (Math.random() < probability) {
        const potentialAtariMoves = allValidAiMoves.filter(move => {
            const tempBoard = JSON.parse(JSON.stringify(game.boardState));
            tempBoard[move.y][move.x] = aiPlayer;
            const tempLogic = getGoLogic({ ...game, boardState: tempBoard });
            for(const neighbor of logic.getNeighbors(move.x, move.y)) {
                if(tempBoard[neighbor.y][neighbor.x] === humanPlayer) {
                    const group = tempLogic.findGroup(neighbor.x, neighbor.y, humanPlayer, tempBoard);
                    if (group && group.liberties === 1) return true;
                }
            }
            return false;
        });

        if (potentialAtariMoves.length > 0) {
            applyMove(potentialAtariMoves[Math.floor(Math.random() * potentialAtariMoves.length)]);
            return;
        }
    }
    
    // 5. Save own atari group
    if (Math.random() < probability) {
        const myAtariGroups = logic.getAllGroups(aiPlayer, game.boardState).filter(g => g.liberties === 1);
        if (myAtariGroups.length > 0) {
            const libertyKey = myAtariGroups[0].libertyPoints.values().next().value;
            if (libertyKey) {
                const [x, y] = libertyKey.split(',').map(Number);
                const savingMove = {x, y};
                if(allValidAiMoves.some(m => m.x === savingMove.x && m.y === savingMove.y)) {
                    applyMove(savingMove);
                    return;
                }
            }
        }
    }
    
    // 6. Random adjacent move
    const adjacentMoves: Point[] = [];
    const occupiedPoints: Point[] = [];
    for(let y=0; y<boardSize; y++) {
        for(let x=0; x<boardSize; x++) {
            if (game.boardState[y][x] !== Player.None) {
                occupiedPoints.push({x, y});
            }
        }
    }
    occupiedPoints.forEach(p => {
        logic.getNeighbors(p.x, p.y).forEach(n => {
            if (allValidAiMoves.some(m => m.x === n.x && m.y === n.y) && !adjacentMoves.some(m => m.x === n.x && m.y === n.y)) {
                adjacentMoves.push(n);
            }
        });
    });

    if (adjacentMoves.length > 0) {
        applyMove(adjacentMoves[Math.floor(Math.random() * adjacentMoves.length)]);
        return;
    }

    // 7. Fully random valid move
    applyMove(allValidAiMoves[Math.floor(Math.random() * allValidAiMoves.length)]);
};


const makeStrategicAiMove = async (game: types.LiveGameSession) => {
    const aiPlayerEnum = game.currentPlayer;
    const opponentPlayerEnum = aiPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
    const now = Date.now();

    // 히든바둑 모드에서 AI 히든 아이템 사용 체크
    const isHiddenMode = game.mode === types.GameMode.Hidden || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Hidden));
    const aiPlayerId = aiPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
    const totalTurns = game.totalTurns || 0;
    
    if (isHiddenMode && game.isSinglePlayer && !game.aiHiddenItemUsed && game.aiHiddenItemTurn !== undefined && totalTurns >= game.aiHiddenItemTurn) {
        // AI 히든 아이템 사용 연출
        game.aiHiddenItemUsed = true;
        game.foulInfo = { message: 'AI봇이 히든 아이템을 사용했습니다!', expiry: now + 5000 };
        
        // 5초간 생각하는 연출을 위해 게임 상태를 특별한 상태로 설정
        game.gameStatus = 'playing'; // 상태는 유지하되, 애니메이션으로 표시
        game.animation = {
            type: 'ai_thinking',
            startTime: now,
            duration: 5000,
            playerId: aiPlayerId
        };
        
        // 5초 후에 실제 수를 두도록 설정
        game.aiHiddenItemAnimationEndTime = now + 5000;
        
        await db.saveGame(game);
        return; // 이번 턴은 연출만 하고 실제 수는 다음 업데이트에서
    }
    
    // AI 히든 아이템 연출이 끝났는지 확인
    if (game.aiHiddenItemAnimationEndTime && now >= game.aiHiddenItemAnimationEndTime) {
        game.aiHiddenItemAnimationEndTime = undefined;
        game.animation = null;
        // 이제 실제 히든 수를 둡니다
    }

    // 1. Get analysis from KataGo
    // aiDifficulty를 기반으로 maxVisits 계산 (katagoLevel 제거됨)
    // 기본값: aiDifficulty 1-2 -> 10, 3-4 -> 20, 5-6 -> 30, 7-8 -> 40, 9-10 -> 50
    const aiDifficulty = game.settings.aiDifficulty || 2;
    const maxVisits = Math.min(50, Math.max(10, Math.ceil(aiDifficulty / 2) * 10));
    const analysis = await analyzeGame(game, { maxVisits });
    const recommendedMoves = analysis.recommendedMoves || [];
    
    let move: RecommendedMove | undefined;
    let result: ReturnType<typeof processMove> | null = null;
    
    // 2. Iterate through recommended moves to find a valid one
    for (const recommendedMove of recommendedMoves) {
        // Handle pass move explicitly, as processMove will reject it.
        if (recommendedMove.x === -1 && recommendedMove.y === -1) {
            move = recommendedMove;
            result = {
                isValid: true,
                newBoardState: JSON.parse(JSON.stringify(game.boardState)), // Pass doesn't change the board
                capturedStones: [],
                newKoInfo: null // Pass resolves ko
            };
            break;
        }

        const moveAttempt = { x: recommendedMove.x, y: recommendedMove.y, player: aiPlayerEnum };
        
        const validationResult = processMove(
            game.boardState,
            moveAttempt,
            game.koInfo,
            game.moveHistory.length
        );

        if (validationResult.isValid) {
            move = recommendedMove;
            result = validationResult;
            break; // Found a valid move
        } else {
            console.warn(`[AI] KataGo recommended invalid move ${JSON.stringify(recommendedMove)} because: ${validationResult.reason}. Trying next best move.`);
        }
    }
    
    // 3. If the chosen valid move is a pass, double-check if we should really pass.
    if (move && move.x === -1 && move.y === -1) {
        console.log('[AI] KataGo suggested a pass. Checking for liberty-blocking moves instead.');
        const logic = getGoLogic(game);
        const opponentLiberties = logic.getAllLibertiesOfPlayer(opponentPlayerEnum, game.boardState);
        let validBlockingMove: Point | null = null;

        if (opponentLiberties.length > 0) {
            for (const liberty of opponentLiberties.sort(() => 0.5 - Math.random())) {
                const validationResult = processMove(game.boardState, { ...liberty, player: aiPlayerEnum }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                if (validationResult.isValid) {
                    validBlockingMove = liberty;
                    result = validationResult;
                    move = { ...validBlockingMove, winrate: 0, scoreLead: 0, order: 0 };
                    break;
                }
            }
        }
        
        if (validBlockingMove) {
            console.log(`[AI] Found a liberty-blocking move at ${JSON.stringify(validBlockingMove)}. Playing there instead of passing.`);
        } else {
            console.log('[AI] No blocking moves found. Proceeding with pass.');
        }
    }


    // 4. If no valid move was found from KataGo's suggestions, search for ANY valid move before resigning.
    if (!result) {
        console.warn(`[AI] KataGo's suggestions were all invalid. Searching for any valid move on the board.`);
        const emptyPoints: Point[] = [];
        for (let y = 0; y < game.settings.boardSize; y++) {
            for (let x = 0; x < game.settings.boardSize; x++) {
                if (game.boardState[y][x] === Player.None) {
                    emptyPoints.push({ x, y });
                }
            }
        }
    
        // Shuffle and try to find a valid move
        emptyPoints.sort(() => 0.5 - Math.random()); 
    
        for (const point of emptyPoints) {
            const moveAttempt = { ...point, player: aiPlayerEnum };
            const validationResult = processMove(
                game.boardState,
                moveAttempt,
                game.koInfo,
                game.moveHistory.length
            );
    
            if (validationResult.isValid) {
                console.log(`[AI] Found a fallback valid move at ${JSON.stringify(point)}.`);
                move = { ...point, winrate: 0, scoreLead: 0, order: 99 };
                result = validationResult;
                break;
            }
        }
    
        // If still no valid move after checking all empty spots, THEN resign.
        if (!result) {
            console.error(`[AI Error] AI could not find ANY valid move on the entire board. Resigning.`);
            await summaryService.endGame(game, opponentPlayerEnum, 'resign');
            return;
        }
    }
    
    // 5. Process the final valid move
    const isHiddenMove = isHiddenMode && game.aiHiddenItemUsed && game.aiHiddenItemAnimationEndTime === undefined;
    
    game.boardState = result.newBoardState;
    game.lastMove = { x: move!.x, y: move!.y };
    game.moveHistory.push({ player: aiPlayerEnum, x: move!.x, y: move!.y });
    // totalTurns는 아래에서 validMoves로 다시 계산됨
    game.koInfo = result.newKoInfo;
    
    // 히든 수인 경우 hiddenMoves에 기록
    if (isHiddenMove) {
        if (!game.hiddenMoves) game.hiddenMoves = {};
        game.hiddenMoves[game.moveHistory.length - 1] = true;
        const hiddenKey = aiPlayerId === game.player1.id ? 'hidden_stones_used_p1' : 'hidden_stones_used_p2';
        game[hiddenKey] = (game[hiddenKey] || 0) + 1;
    }

    if (move!.x === -1 && move!.y === -1) {
        game.passCount++;
        if (game.passCount >= 2) {
             await summaryService.endGame(game, types.Player.None, 'score');
             return;
        }
    } else {
        game.passCount = 0;
    }

    if (result.capturedStones.length > 0) {
         if (!game.justCaptured) game.justCaptured = [];
         for (const stone of result.capturedStones) {
            const wasPatternStone = (opponentPlayerEnum === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                    (opponentPlayerEnum === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
            
            const points = wasPatternStone ? 2 : 1;
            game.captures[aiPlayerEnum] += points;
            game.justCaptured.push({ point: stone, player: opponentPlayerEnum, wasHidden: false });
         }
    }
    
    if (game.isSinglePlayer || game.mode === types.GameMode.Capture) {
        const target = getCaptureTarget(game, aiPlayerEnum);
        if (target !== undefined && target !== NO_CAPTURE_TARGET && game.captures[aiPlayerEnum] >= target) {
            await summaryService.endGame(game, aiPlayerEnum, 'capture_limit');
            return;
        }
    }

    const aiPlayerTimeKey = aiPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
    const isFischer = game.mode === types.GameMode.Speed || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Speed));
    const fischerIncrement = isFischer ? (game.settings.timeIncrement || 0) : 0;
    
    if (game.turnDeadline) {
        const timeRemaining = Math.max(0, (game.turnDeadline - now) / 1000);
        game[aiPlayerTimeKey] = timeRemaining + fischerIncrement;
    } else {
        // turnDeadline이 없으면 현재 시간에 increment 추가
        game[aiPlayerTimeKey] = (game[aiPlayerTimeKey] || 0) + fischerIncrement;
    }
    
    // 싱글플레이/AI봇 대결 자동 계가 트리거 체크
    // hidden_placing, scanning 등 아이템 모드에서는 자동계가 체크를 하지 않음
    const isItemMode = ['hidden_placing', 'scanning', 'missile_selecting', 'missile_animating', 'scanning_animating'].includes(game.gameStatus);
    
    if (!isItemMode) {
        const autoScoringTurns = game.isSinglePlayer && game.stageId
            ? SINGLE_PLAYER_STAGES.find(s => s.id === game.stageId)?.autoScoringTurns
            : (game.settings as any)?.autoScoringTurns;
        
        if (autoScoringTurns !== undefined || (game.isSinglePlayer && game.stageId)) {
            // 흑/백 모두 카운팅: moveHistory에 추가된 수를 카운팅 (x !== -1인 수만)
            const validMoves = game.moveHistory.filter(m => m.x !== -1 && m.y !== -1);
            const newTotalTurns = validMoves.length;
            game.totalTurns = newTotalTurns;
            
            // 디버깅: totalTurns 업데이트 로그
            if (autoScoringTurns) {
                const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                console.log(`[AI Player][${gameType}] totalTurns updated: ${newTotalTurns}/${autoScoringTurns} (stageId: ${game.stageId || 'N/A'}, player: ${aiPlayerEnum === Player.Black ? 'Black' : 'White'})`);
            }
            
            if (autoScoringTurns) {
                const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                console.log(`[AI Player][${gameType}] Auto-scoring check: totalTurns=${game.totalTurns}, autoScoringTurns=${autoScoringTurns}, gameStatus=${game.gameStatus}, validMovesLength=${validMoves.length}`);
                // AI가 수를 둔 후이므로, totalTurns가 autoScoringTurns 이상이면 계가로 넘어감
                // 단, 마지막 턴(totalTurns === autoScoringTurns)인 경우 AI가 수를 둔 후이므로 계가 진행
                if (game.totalTurns >= autoScoringTurns) {
                    // 게임 상태를 먼저 확인하여 중복 트리거 방지
                    if (game.gameStatus === 'playing' || game.gameStatus === 'hidden_placing') {
                        const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                        console.log(`[AI Player][${gameType}] Auto-scoring triggered at ${game.totalTurns} turns (stageId: ${game.stageId || 'N/A'}, gameStatus: ${game.gameStatus})`);
                        // 게임 상태를 먼저 scoring으로 변경하여 다른 로직이 게임을 재시작하지 않도록 함
                        game.gameStatus = 'scoring';
                        await db.saveGame(game);
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        // boardState 제외하여 대역폭 절약
                        const gameToBroadcast = { ...game };
                        delete (gameToBroadcast as any).boardState;
                        broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: gameToBroadcast } }, game);
                        const { getGameResult } = await import('./gameModes.js');
                        await getGameResult(game);
                        return;
                    } else {
                        const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                        console.warn(`[AI Player][${gameType}] Auto-scoring condition met but gameStatus is not 'playing' or 'hidden_placing': ${game.gameStatus} (totalTurns=${game.totalTurns}, autoScoringTurns=${autoScoringTurns}) - FORCING TRIGGER`);
                        // 조건이 만족되었는데 gameStatus가 다른 경우 강제로 트리거
                        game.gameStatus = 'scoring';
                        await db.saveGame(game);
                        const { broadcastToGameParticipants } = await import('./socket.js');
                        const gameToBroadcast = { ...game };
                        delete (gameToBroadcast as any).boardState;
                        broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: gameToBroadcast } }, game);
                        const { getGameResult } = await import('./gameModes.js');
                        await getGameResult(game);
                        return;
                    }
                } else {
                    const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                    console.log(`[AI Player][${gameType}] Auto-scoring condition not met: totalTurns=${game.totalTurns} < autoScoringTurns=${autoScoringTurns}`);
                }
            }
        }
    }
    
    game.currentPlayer = opponentPlayerEnum;
    if (game.settings.timeLimit > 0) {
        const timeKey = game.currentPlayer === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
        const isFischer = game.mode === types.GameMode.Speed || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Speed));
        const isNextInByoyomi = game[timeKey] <= 0 && game.settings.byoyomiCount > 0 && !isFischer;
        
        if (isNextInByoyomi) {
            game.turnDeadline = now + game.settings.byoyomiTime * 1000;
        } else {
            game.turnDeadline = now + game[timeKey] * 1000;
        }
        game.turnStartTime = now;
    } else {
        game.turnDeadline = undefined;
        game.turnStartTime = undefined;
    }
};

// FIX: Implement missing AI functions
const makeDiceGoAiMove = async (game: types.LiveGameSession) => {
    const now = Date.now();
    const aiPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
    const { getGoLogic, processMove } = await import('./goLogic.js');
    
    if (game.gameStatus === 'dice_rolling') {
        // 주사위 굴리기
        const logic = getGoLogic(game);
        const liberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
        const whiteStoneCount = game.boardState.flat().filter(s => s === types.Player.White).length;
        
        // 최적의 주사위 선택: 백돌이 많을수록 높은 수를 원함
        let dice1: number;
        if (whiteStoneCount > 10 && liberties.length > 6) {
            // 아이템 사용 고려 (홀수/짝수)
            const oddItemUses = game.diceGoItemUses?.[aiPlayerId]?.odd || 0;
            const evenItemUses = game.diceGoItemUses?.[aiPlayerId]?.even || 0;
            
            if (oddItemUses > 0 && liberties.length >= 5) {
                dice1 = [1, 3, 5][Math.floor(Math.random() * 3)];
                game.diceGoItemUses![aiPlayerId].odd--;
            } else if (evenItemUses > 0 && liberties.length >= 6) {
                dice1 = [2, 4, 6][Math.floor(Math.random() * 3)];
                game.diceGoItemUses![aiPlayerId].even--;
            } else {
                dice1 = Math.floor(Math.random() * 6) + 1;
            }
        } else {
            dice1 = Math.floor(Math.random() * 6) + 1;
        }
        
        const isOvershot = liberties.length > 0 && dice1 > liberties.length;
        
        game.animation = { type: 'dice_roll_main', dice: { dice1, dice2: 0, dice3: 0 }, startTime: now, duration: 1500 };
        game.gameStatus = 'dice_rolling_animating';
        game.turnDeadline = undefined;
        game.turnStartTime = undefined;
        game.dice = undefined;
        game.stonesToPlace = isOvershot ? -1 : dice1;
        
        if (!game.diceRollHistory) game.diceRollHistory = {};
        if (!game.diceRollHistory[aiPlayerId]) game.diceRollHistory[aiPlayerId] = [];
        game.diceRollHistory[aiPlayerId].push(dice1);
        
    } else if (game.gameStatus === 'dice_placing') {
        // 최적의 위치에 돌 배치
        const logic = getGoLogic(game);
        const liberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
        let stonesToPlace = game.stonesToPlace || 0;
        let totalCaptures = 0;
        let lastCaptureStones: types.Point[] = [];
        
        while (stonesToPlace > 0 && liberties.length > 0) {
            // 최대한 많은 돌을 따낼 수 있는 위치 선택
            let bestMove: types.Point | null = null;
            let maxCaptures = 0;
            
            for (const liberty of liberties) {
                const result = processMove(game.boardState, { ...liberty, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                if (result.isValid && result.capturedStones.length > maxCaptures) {
                    maxCaptures = result.capturedStones.length;
                    bestMove = liberty;
                }
            }
            
            // 최선의 수가 없으면 랜덤하게 선택
            if (!bestMove) {
                bestMove = liberties[Math.floor(Math.random() * liberties.length)];
            }
            
            const result = processMove(game.boardState, { ...bestMove, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
            if (result.isValid) {
                game.boardState = result.newBoardState;
                game.lastMove = bestMove;
                game.moveHistory.push({ player: types.Player.Black, x: bestMove.x, y: bestMove.y });
                game.koInfo = result.newKoInfo;
                
                if (result.capturedStones.length > 0) {
                    totalCaptures += result.capturedStones.length;
                    lastCaptureStones = result.capturedStones;
                    if (!game.justCaptured) game.justCaptured = [];
                    for (const stone of result.capturedStones) {
                        game.justCaptured.push({ point: stone, player: types.Player.White, wasHidden: false });
                    }
                }
                
                if (!game.stonesPlacedThisTurn) game.stonesPlacedThisTurn = [];
                game.stonesPlacedThisTurn.push(bestMove);
            } else {
                break;
            }
            
            stonesToPlace--;
            // 업데이트된 liberties 계산
            const updatedLogic = getGoLogic(game);
            const updatedLiberties = updatedLogic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
            if (updatedLiberties.length === 0) break;
        }
        
        game.diceCapturesThisTurn = totalCaptures;
        game.diceLastCaptureStones = lastCaptureStones;
        
        // finishPlacingTurn 호출
        const finishPlacingTurn = (await import('./modes/diceGo.js')).finishPlacingTurn;
        finishPlacingTurn(game, aiPlayerId);
    }
};
const makeOmokAiMove = (game: types.LiveGameSession) => {
    const logic = getOmokLogic(game);
    const now = Date.now();
    
    const aiPlayerEnum = game.currentPlayer;
    const humanPlayerEnum = aiPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
    const boardSize = game.settings.boardSize;
    
    // 가능한 모든 수 찾기
    const validMoves: types.Point[] = [];
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] === types.Player.None) {
                // 3-3 금지 체크 (흑돌인 경우만)
                if (game.settings.has33Forbidden && aiPlayerEnum === types.Player.Black && logic.is33(x, y, game.boardState)) {
                    continue;
                }
                validMoves.push({ x, y });
            }
        }
    }
    
    if (validMoves.length === 0) {
        // 수를 둘 곳이 없으면 게임 종료 처리
        return;
    }
    
    // 임시 보드로 수를 시뮬레이션
    const evaluateMove = (x: number, y: number, player: types.Player): number => {
        const tempBoard = game.boardState.map(row => [...row]);
        tempBoard[y][x] = player;
        
        // 승리 체크
        const winCheck = logic.checkWin(x, y, tempBoard);
        if (winCheck) return 10000;
        
        // 상대방이 다음 수에 승리할 수 있는지 체크 (방어 우선)
        const opponent = player === types.Player.Black ? types.Player.White : types.Player.Black;
        for (let oy = 0; oy < boardSize; oy++) {
            for (let ox = 0; ox < boardSize; ox++) {
                if (tempBoard[oy][ox] === types.Player.None) {
                    const opponentTempBoard = tempBoard.map(row => [...row]);
                    opponentTempBoard[oy][ox] = opponent;
                    const opponentWin = logic.checkWin(ox, oy, opponentTempBoard);
                    if (opponentWin) return -5000; // 상대방 승리 수를 막아야 함
                }
            }
        }
        
        // 라인 통계로 점수 계산
        let score = 0;
        const directions = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 1, dy: -1 }];
        
        for (const { dx, dy } of directions) {
            const stats = logic.getLineStats(x, y, player, tempBoard, dx, dy);
            // 4개 연속 (열린 4) = 높은 점수
            if (stats.length === 4 && stats.openEnds >= 1) score += 1000;
            // 3개 연속 (열린 3) = 중간 점수
            if (stats.length === 3 && stats.openEnds >= 1) score += 100;
            // 2개 연속 = 낮은 점수
            if (stats.length === 2 && stats.openEnds >= 1) score += 10;
        }
        
        // 따목 모드인 경우 따내기 점수 추가
        if (game.mode === types.GameMode.Ttamok) {
            const capturedCount = logic.checkPotentialCaptures(x, y, player, tempBoard);
            score += capturedCount * 50;
        }
        
        return score;
    };
    
    // 각 수의 점수 계산
    const moveScores = validMoves.map(move => ({
        move,
        score: evaluateMove(move.x, move.y, aiPlayerEnum)
    }));
    
    // 최고 점수 수 찾기
    moveScores.sort((a, b) => b.score - a.score);
    const bestMoves = moveScores.filter(m => m.score === moveScores[0].score);
    const chosenMove = bestMoves[Math.floor(Math.random() * bestMoves.length)].move;
    
    // 수를 둠
    game.boardState[chosenMove.y][chosenMove.x] = aiPlayerEnum;
    game.lastMove = chosenMove;
    game.moveHistory.push({ player: aiPlayerEnum, x: chosenMove.x, y: chosenMove.y });
    
    // 따목 모드인 경우 따내기 처리
    if (game.mode === types.GameMode.Ttamok) {
        const { capturedCount } = logic.performTtamokCapture(chosenMove.x, chosenMove.y);
        game.captures[aiPlayerEnum] += capturedCount;
        const target = getCaptureTarget(game, aiPlayerEnum) ?? game.settings.captureTarget ?? 10;
        if (target !== NO_CAPTURE_TARGET && game.captures[aiPlayerEnum] >= target) {
            game.winner = aiPlayerEnum;
            game.winReason = 'capture_limit';
            game.gameStatus = 'ended';
            return;
        }
    }
    
    // 승리 체크
    const winCheck = logic.checkWin(chosenMove.x, chosenMove.y, game.boardState);
    if (winCheck) {
        game.winner = aiPlayerEnum;
        game.winReason = 'omok_win';
        game.winningLine = winCheck.line;
        game.gameStatus = 'ended';
        return;
    }
    
    // 보드가 가득 찬 경우
    const boardIsFull = game.boardState.flat().every(cell => cell !== types.Player.None);
    if (boardIsFull) {
        game.gameStatus = 'ended';
        game.winReason = 'score';
        if (game.mode === types.GameMode.Ttamok) {
            const p1Enum = game.player1.id === game.blackPlayerId ? types.Player.Black : (game.player1.id === game.whitePlayerId ? types.Player.White : types.Player.None);
            const p2Enum = game.player2.id === game.blackPlayerId ? types.Player.Black : (game.player2.id === game.whitePlayerId ? types.Player.White : types.Player.None);
            const p1Captures = game.captures[p1Enum];
            const p2Captures = game.captures[p2Enum];
            if (p1Captures > p2Captures) {
                game.winner = p1Enum;
            } else if (p2Captures > p1Captures) {
                game.winner = p2Enum;
            } else {
                game.winner = Math.random() < 0.5 ? types.Player.Black : types.Player.White;
            }
        } else {
            game.winner = Math.random() < 0.5 ? types.Player.Black : types.Player.White;
        }
        return;
    }
    
    // 턴 변경
    game.currentPlayer = humanPlayerEnum;
    if (game.settings.timeLimit > 0) {
        const nextTimeKey = humanPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
        game.turnDeadline = now + game[nextTimeKey] * 1000;
        game.turnStartTime = now;
    }
};
const makeThiefAiMove = async (game: types.LiveGameSession) => {
    const now = Date.now();
    const aiPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
    const { getGoLogic, processMove } = await import('./goLogic.js');
    const aiUser = game.player1.id === aiPlayerId ? game.player1 : game.player2;
    const myRole = aiPlayerId === game.thiefPlayerId ? 'thief' : 'police';
    
    if (game.gameStatus === 'thief_rolling') {
        // 주사위 굴리기
        const dice1 = Math.floor(Math.random() * 6) + 1;
        let dice2 = 0;
        let stonesToPlace: number;
        
        if (myRole === 'police') {
            dice2 = Math.floor(Math.random() * 6) + 1;
            stonesToPlace = dice1 + dice2;
        } else {
            stonesToPlace = dice1;
        }
        
        game.stonesToPlace = stonesToPlace;
        game.animation = { type: 'dice_roll_main', dice: { dice1, dice2, dice3: 0 }, startTime: now, duration: 1500 };
        game.gameStatus = 'thief_rolling_animating';
        game.turnDeadline = undefined;
        game.turnStartTime = undefined;
        game.dice = undefined;
        
        if (!game.thiefDiceRollHistory) game.thiefDiceRollHistory = {};
        if (!game.thiefDiceRollHistory[aiPlayerId]) game.thiefDiceRollHistory[aiPlayerId] = [];
        game.thiefDiceRollHistory[aiPlayerId].push(dice1);
        if (dice2 > 0) game.thiefDiceRollHistory[aiPlayerId].push(dice2);
        
    } else if (game.gameStatus === 'thief_placing') {
        // 최적의 위치에 돌 배치
        const logic = getGoLogic(game);
        let stonesToPlace = game.stonesToPlace || 0;
        
        while (stonesToPlace > 0) {
            let bestMove: types.Point | null = null;
            
            if (myRole === 'thief') {
                // 도둑: 기존 돌의 활로에만 배치 가능
                const noBlackStonesOnBoard = !game.boardState.flat().includes(types.Player.Black);
                const canPlaceFreely = (game.turnInRound === 1 || noBlackStonesOnBoard);
                
                if (canPlaceFreely) {
                    // 자유 배치: 백돌을 최대한 많이 따낼 수 있는 위치 선택
                    const allEmpty = [];
                    for (let y = 0; y < game.settings.boardSize; y++) {
                        for (let x = 0; x < game.settings.boardSize; x++) {
                            if (game.boardState[y][x] === types.Player.None) {
                                allEmpty.push({ x, y });
                            }
                        }
                    }
                    
                    let maxCaptures = 0;
                    for (const pos of allEmpty) {
                        const result = processMove(game.boardState, { ...pos, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                        if (result.isValid && result.capturedStones.length > maxCaptures) {
                            maxCaptures = result.capturedStones.length;
                            bestMove = pos;
                        }
                    }
                    
                    if (!bestMove && allEmpty.length > 0) {
                        bestMove = allEmpty[Math.floor(Math.random() * allEmpty.length)];
                    }
                } else {
                    // 활로에만 배치
                    const liberties = logic.getAllLibertiesOfPlayer(types.Player.Black, game.boardState);
                    if (liberties.length > 0) {
                        // 백돌을 따낼 수 있는 활로 우선 선택
                        let maxCaptures = 0;
                        for (const liberty of liberties) {
                            const result = processMove(game.boardState, { ...liberty, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                            if (result.isValid && result.capturedStones.length > maxCaptures) {
                                maxCaptures = result.capturedStones.length;
                                bestMove = liberty;
                            }
                        }
                        
                        if (!bestMove) {
                            bestMove = liberties[Math.floor(Math.random() * liberties.length)];
                        }
                    }
                }
            } else {
                // 경찰: 도둑 돌의 활로에 배치하여 따내기
                const blackStonesOnBoard = game.boardState.flat().includes(types.Player.Black);
                if (blackStonesOnBoard) {
                    const liberties = logic.getAllLibertiesOfPlayer(types.Player.Black, game.boardState);
                    if (liberties.length > 0) {
                        // 최대한 많은 도둑 돌을 따낼 수 있는 위치 선택
                        let maxCaptures = 0;
                        for (const liberty of liberties) {
                            const result = processMove(game.boardState, { ...liberty, player: types.Player.White }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                            if (result.isValid && result.capturedStones.length > maxCaptures) {
                                maxCaptures = result.capturedStones.length;
                                bestMove = liberty;
                            }
                        }
                        
                        if (!bestMove) {
                            bestMove = liberties[Math.floor(Math.random() * liberties.length)];
                        }
                    }
                } else {
                    // 도둑 돌이 없으면 자유 배치
                    const allEmpty = [];
                    for (let y = 0; y < game.settings.boardSize; y++) {
                        for (let x = 0; x < game.settings.boardSize; x++) {
                            if (game.boardState[y][x] === types.Player.None) {
                                allEmpty.push({ x, y });
                            }
                        }
                    }
                    if (allEmpty.length > 0) {
                        bestMove = allEmpty[Math.floor(Math.random() * allEmpty.length)];
                    }
                }
            }
            
            if (bestMove) {
                const result = processMove(game.boardState, { ...bestMove, player: myRole === 'thief' ? types.Player.Black : types.Player.White }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
                if (result.isValid) {
                    game.boardState = result.newBoardState;
                    game.lastMove = bestMove;
                    game.moveHistory.push({ player: myRole === 'thief' ? types.Player.Black : types.Player.White, x: bestMove.x, y: bestMove.y });
                    game.koInfo = result.newKoInfo;
                    
                    if (!game.stonesPlacedThisTurn) game.stonesPlacedThisTurn = [];
                    game.stonesPlacedThisTurn.push(bestMove);
                    
                    if (result.capturedStones.length > 0) {
                        if (!game.justCaptured) game.justCaptured = [];
                        for (const stone of result.capturedStones) {
                            game.justCaptured.push({ point: stone, player: myRole === 'thief' ? types.Player.White : types.Player.Black, wasHidden: false });
                        }
                        
                        // 경찰이 도둑 돌을 따낼 때 점수 추가
                        if (myRole === 'police') {
                            if (!game.thiefCapturesThisRound) game.thiefCapturesThisRound = 0;
                            game.thiefCapturesThisRound += result.capturedStones.length;
                        }
                    }
                    
                    game.stonesToPlace = (game.stonesToPlace || 1) - 1;
                    
                    // 경찰이 모든 도둑 돌을 따낸 경우
                    const blackStonesLeft = game.boardState.flat().filter(s => s === types.Player.Black).length;
                    const allThievesCaptured = blackStonesLeft === 0 && myRole === 'police';
                    if (allThievesCaptured) {
                        game.stonesToPlace = 0;
                    }
                }
            } else {
                break;
            }
            
            if (game.stonesToPlace === undefined || game.stonesToPlace <= 0) break;
        }
        
        // 턴 종료 처리 (THIEF_PLACE_STONE 로직과 동일)
        if (game.stonesToPlace === undefined || game.stonesToPlace <= 0) {
            if (!game.stonesPlacedThisTurn) game.stonesPlacedThisTurn = [];
            game.lastTurnStones = game.stonesPlacedThisTurn;
            game.stonesPlacedThisTurn = [];
            game.lastMove = null;
            
            game.turnInRound = (game.turnInRound || 0) + 1;
            const totalTurnsInRound = 10;
            const blackStonesLeft = game.boardState.flat().filter(s => s === types.Player.Black).length;
            const allThievesCaptured = blackStonesLeft === 0 && myRole === 'police';
    
            if (game.turnInRound > totalTurnsInRound || allThievesCaptured) {
                const finalThiefStonesLeft = game.boardState.flat().filter(s => s === types.Player.Black).length;
                const capturesThisRound = game.thiefCapturesThisRound || 0;
                
                game.scores[game.thiefPlayerId!] = (game.scores[game.thiefPlayerId!] || 0) + finalThiefStonesLeft;
                game.scores[game.policePlayerId!] = (game.scores[game.policePlayerId!] || 0) + capturesThisRound;
                
                const p1Id = game.player1.id;
                const p1IsThief = p1Id === game.thiefPlayerId;
    
                game.thiefRoundSummary = {
                    round: game.round,
                    isDeathmatch: !!game.isDeathmatch,
                    player1: {
                        id: p1Id,
                        role: p1IsThief ? 'thief' : 'police',
                        roundScore: p1IsThief ? finalThiefStonesLeft : capturesThisRound,
                        cumulativeScore: game.scores[p1Id] ?? 0,
                    },
                    player2: {
                        id: game.player2.id,
                        role: !p1IsThief ? 'thief' : 'police',
                        roundScore: !p1IsThief ? finalThiefStonesLeft : capturesThisRound,
                        cumulativeScore: game.scores[game.player2.id] ?? 0,
                    }
                };
    
                const p1Score = game.scores[p1Id]!;
                const p2Score = game.scores[game.player2.id]!;
                
                if ((game.round === 2 && p1Score !== p2Score) || game.isDeathmatch) {
                    const winnerId = p1Score > p2Score ? p1Id : game.player2.id;
                    const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : types.Player.White;
                    const { endGame } = await import('./summaryService.js');
                    endGame(game, winnerEnum, 'total_score');
                    return;
                }
                
                game.gameStatus = 'thief_round_end';
                game.revealEndTime = now + 20000;
                if (game.isAiGame) game.roundEndConfirmations = { [aiUserId]: now };
            } else {
                game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
                game.gameStatus = 'thief_rolling';
                game.turnDeadline = now + 30000;
                game.turnStartTime = now;
            }
        }
    }
};

const makeAlkkagiAiMove = async (game: types.LiveGameSession) => {
    const now = Date.now();
    const aiPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
    const aiPlayerEnum = game.currentPlayer;
    
    if (game.gameStatus === 'alkkagi_placement' || game.gameStatus === 'alkkagi_simultaneous_placement') {
        // 돌 배치: 상대방 돌에 가까운 위치에 배치
        const targetPlacements = game.settings.alkkagiStoneCount || 5;
        const placedThisRound = game.alkkagiStonesPlacedThisRound?.[aiPlayerId] || 0;
        
        if (placedThisRound >= targetPlacements) return;
        
        const boardSizePx = 840;
        const cellSize = boardSizePx / 19;
        const opponentStones = (game.alkkagiStones || []).filter(s => s.player !== aiPlayerEnum && s.onBoard);
        
        let bestPoint: types.Point | null = null;
        if (opponentStones.length > 0) {
            // 상대방 돌 근처에 배치
            const targetStone = opponentStones[Math.floor(Math.random() * opponentStones.length)];
            const offsetX = (Math.random() - 0.5) * cellSize * 2;
            const offsetY = (Math.random() - 0.5) * cellSize * 2;
            bestPoint = {
                x: Math.max(cellSize, Math.min(boardSizePx - cellSize, targetStone.x + offsetX)),
                y: Math.max(cellSize, Math.min(boardSizePx - cellSize, targetStone.y + offsetY))
            };
        } else {
            // 중앙 근처에 배치
            bestPoint = {
                x: boardSizePx / 2 + (Math.random() - 0.5) * cellSize * 4,
                y: boardSizePx / 2 + (Math.random() - 0.5) * cellSize * 4
            };
        }
        
        const newStone: types.AlkkagiStone = {
            id: Date.now() + Math.random(),
            player: aiPlayerEnum,
            x: bestPoint.x,
            y: bestPoint.y,
            vx: 0,
            vy: 0,
            radius: (boardSizePx / 19) * 0.47,
            onBoard: true
        };
        
        if (game.gameStatus === 'alkkagi_simultaneous_placement') {
            const playerStonesKey = aiPlayerId === game.player1.id ? 'alkkagiStones_p1' : 'alkkagiStones_p2';
            if (!game[playerStonesKey]) game[playerStonesKey] = [];
            game[playerStonesKey]!.push(newStone);
        } else {
            if (!game.alkkagiStones) game.alkkagiStones = [];
            game.alkkagiStones.push(newStone);
        }
        
        if (!game.alkkagiStonesPlacedThisRound) game.alkkagiStonesPlacedThisRound = {};
        game.alkkagiStonesPlacedThisRound[aiPlayerId] = placedThisRound + 1;
        
        if (game.gameStatus === 'alkkagi_placement') {
            game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
            game.alkkagiPlacementDeadline = now + 30000;
        }
        
    } else if (game.gameStatus === 'alkkagi_playing') {
        // 돌 튕기기: 상대방 돌을 최대한 많이 떨어뜨리는 방향으로
        const myStones = (game.alkkagiStones || []).filter(s => s.player === aiPlayerEnum && s.onBoard);
        const opponentStones = (game.alkkagiStones || []).filter(s => s.player !== aiPlayerEnum && s.onBoard);
        
        if (myStones.length === 0 || opponentStones.length === 0) return;
        
        // 가장 가까운 상대방 돌을 향해 튕기기
        let bestStone: types.AlkkagiStone | null = null;
        let bestTarget: types.AlkkagiStone | null = null;
        let minDistance = Infinity;
        
        for (const myStone of myStones) {
            for (const oppStone of opponentStones) {
                const dist = Math.hypot(oppStone.x - myStone.x, oppStone.y - myStone.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestStone = myStone;
                    bestTarget = oppStone;
                }
            }
        }
        
        if (bestStone && bestTarget) {
            const dx = bestTarget.x - bestStone.x;
            const dy = bestTarget.y - bestStone.y;
            const distance = Math.hypot(dx, dy);
            const speed = Math.min(15, distance / 20); // 적절한 속도
            const vx = (dx / distance) * speed;
            const vy = (dy / distance) * speed;
            
            game.animation = { type: 'alkkagi_flick', stoneId: bestStone.id, vx, vy, startTime: now, duration: 5000 };
            game.gameStatus = 'alkkagi_animating';
            game.alkkagiTurnDeadline = undefined;
            game.turnStartTime = undefined;
        }
    }
};

const makeCurlingAiMove = async (game: types.LiveGameSession) => {
    const now = Date.now();
    const aiPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
    const aiPlayerEnum = game.currentPlayer;
    
    if (game.gameStatus === 'curling_playing') {
        // 최적의 위치와 속도로 돌 던지기
        const boardSizePx = 840;
        const center = { x: boardSizePx / 2, y: boardSizePx / 2 };
        const cellSize = boardSizePx / 19;
        
        // 하우스 중심을 향해 던지기
        const launchX = boardSizePx * 0.1 + Math.random() * boardSizePx * 0.1; // 하단에서 발사
        const launchY = boardSizePx * 0.9;
        
        const dx = center.x - launchX;
        const dy = center.y - launchY;
        const distance = Math.hypot(dx, dy);
        const speed = Math.min(12, distance / 30); // 적절한 속도
        const vx = (dx / distance) * speed;
        const vy = (dy / distance) * speed;
        
        const newStone: types.AlkkagiStone = {
            id: Date.now(),
            player: aiPlayerEnum,
            x: launchX,
            y: launchY,
            vx: 0,
            vy: 0,
            radius: (boardSizePx / 19) * 0.47,
            onBoard: false,
        };
        
        game.animation = { type: 'curling_flick', stone: newStone, velocity: { x: vx, y: vy }, startTime: now, duration: 8000 };
        game.gameStatus = 'curling_animating';
        if (!game.stonesThrownThisRound) game.stonesThrownThisRound = {};
        game.stonesThrownThisRound[aiPlayerId] = (game.stonesThrownThisRound[aiPlayerId] || 0) + 1;
        game.curlingTurnDeadline = undefined;
        game.turnStartTime = undefined;
    }
};


export const makeAiMove = async (game: LiveGameSession) => {
    const initialMoveCount = game.moveHistory?.length ?? 0;

    if (!shouldProcessAiTurn(game.id, initialMoveCount)) {
        return;
    }

    if (!startAiProcessing(game.id)) {
        return;
    }

    try {
        let moveExecuted = false;

        // 새로운 바둑 AI 봇 시스템 사용 여부 확인
        // 싱글플레이, 도전의탑, 전략바둑에서 사용
        const isTower = game.gameCategory === 'tower';
        const useGoAiBot = game.isSinglePlayer ||
                           isTower ||
                           (game.settings as any)?.useGoAiBot === true ||
                           (game.settings as any)?.goAiBotLevel !== undefined;
        
        if (useGoAiBot) {
            // AI 봇 단계 결정
            let aiLevel = 1; // 기본값
            
            if (game.isSinglePlayer || isTower) {
                // 싱글플레이/도전의 탑: 게임 설정의 aiDifficulty를 사용 (katagoLevel 제거됨)
                aiLevel = (game.settings.aiDifficulty || 1);
            } else if ((game.settings as any)?.goAiBotLevel !== undefined) {
                aiLevel = (game.settings as any).goAiBotLevel;
            } else {
                aiLevel = (game.settings.aiDifficulty || 1);
            }

            // 바둑 모드인 경우에만 새로운 AI 봇 시스템 사용
            const goModes: GameMode[] = [
                types.GameMode.Standard,
                types.GameMode.Capture,
                types.GameMode.Speed,
                types.GameMode.Base,
                types.GameMode.Hidden,
                types.GameMode.Missile,
                types.GameMode.Mix
            ];

            if (goModes.includes(game.mode)) {
                await makeGoAiBotMove(game, aiLevel);
                moveExecuted = true;
            }
        }

        if (!moveExecuted) {
            // 기존 로직 유지
            if (game.isSinglePlayer) {
                makeSimpleCaptureAiMove(game);
                moveExecuted = true;
            } else {
                const strategicModes: GameMode[] = [
                    types.GameMode.Standard,
                    types.GameMode.Capture,
                    types.GameMode.Speed,
                    types.GameMode.Base,
                    types.GameMode.Hidden,
                    types.GameMode.Missile,
                    types.GameMode.Mix
                ];

                if (strategicModes.includes(game.mode)) {
                    await makeStrategicAiMove(game);
                    moveExecuted = true;
                } else {
                    switch (game.mode) {
                        case types.GameMode.Dice:
                            await makeDiceGoAiMove(game);
                            moveExecuted = true;
                            break;
                        case types.GameMode.Omok:
                        case types.GameMode.Ttamok:
                            makeOmokAiMove(game);
                            moveExecuted = true;
                            break;
                        case types.GameMode.Alkkagi:
                            await makeAlkkagiAiMove(game);
                            moveExecuted = true;
                            break;
                        case types.GameMode.Curling:
                            await makeCurlingAiMove(game);
                            moveExecuted = true;
                            break;
                        case types.GameMode.Thief:
                            await makeThiefAiMove(game);
                            moveExecuted = true;
                            break;
                    }
                }
            }
        }

        const finalMoveCount = game.moveHistory?.length ?? initialMoveCount;
        finishAiProcessing(game.id, finalMoveCount);
    } catch (error) {
        cancelAiProcessing(game.id);
        throw error;
    }
};