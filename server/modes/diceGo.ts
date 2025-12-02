import * as types from '../../types/index.js';
import * as db from '../db.js';
import { getGoLogic, processMove } from '../goLogic.js';
import { handleSharedAction, updateSharedGameState } from './shared.js';
import { DICE_GO_INITIAL_WHITE_STONES_BY_ROUND, DICE_GO_LAST_CAPTURE_BONUS_BY_TOTAL_ROUNDS, DICE_GO_MAIN_PLACE_TIME, DICE_GO_MAIN_ROLL_TIME, DICE_GO_TURN_CHOICE_TIME, DICE_GO_TURN_ROLL_TIME, PLAYFUL_MODE_FOUL_LIMIT } from '../../constants';
import * as effectService from '../effectService.js';
import { endGame } from '../summaryService.js';
import { aiUserId } from '../aiPlayer.js';

export function finishPlacingTurn(game: types.LiveGameSession, playerId: string) {
    const now = Date.now();
    const humanPlayerId = game.player1.id === aiUserId ? game.player2.id : game.player1.id;
    const aiPlayerId = game.player1.id === aiUserId ? game.player1.id : game.player2.id;

    const totalCapturesThisTurn = game.diceCapturesThisTurn || 0;
    const lastCaptureStones = game.diceLastCaptureStones || [];

    game.scores[playerId] = (game.scores[playerId] || 0) + totalCapturesThisTurn;
    game.stonesToPlace = 0;
    
    const whiteStonesLeft = game.boardState.flat().filter(s => s === types.Player.White).length;

    if (whiteStonesLeft === 0) {
        if (totalCapturesThisTurn > 0) { // Check if the last action was a capture
            const totalRounds = game.settings.diceGoRounds ?? 1;
            const bonus = DICE_GO_LAST_CAPTURE_BONUS_BY_TOTAL_ROUNDS[totalRounds - 1];
            game.scores[playerId] = (game.scores[playerId] || 0) + bonus;
            if (!game.diceGoBonuses) game.diceGoBonuses = {};
            game.diceGoBonuses[playerId] = (game.diceGoBonuses[playerId] || 0) + bonus;

            game.animation = {
                type: 'bonus_score',
                playerId: playerId,
                bonus: bonus,
                startTime: now,
                duration: 3000
            };
        }

        const totalRounds = game.settings.diceGoRounds ?? 3;
        if (game.round >= totalRounds && !game.isDeathmatch) {
            const p1Score = game.scores[game.player1.id] || 0;
            const p2Score = game.scores[game.player2.id] || 0;
            if (p1Score !== p2Score) {
                const winnerId = p1Score > p2Score ? game.player1.id : game.player2.id;
                const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : (winnerId === game.whitePlayerId ? types.Player.White : types.Player.None);
                endGame(game, winnerEnum, 'dice_win');
                return;
            }
        }
        
        const roundSummary: types.DiceRoundSummary = {
            round: game.round,
            scores: { ...game.scores }
        };
        if (game.round === 1 && game.diceRollHistory) {
            roundSummary.diceStats = {};
            const playerIds = game.isAiGame ? [humanPlayerId, aiPlayerId] : [game.player1.id, game.player2.id];
            playerIds.forEach(pid => {
                const rolls = game.diceRollHistory![pid] || [];
                const rollCounts: { [roll: number]: number } = {};
                for (const roll of rolls) {
                    rollCounts[roll] = (rollCounts[roll] || 0) + 1;
                }
                roundSummary.diceStats![pid] = {
                    rolls: rollCounts,
                    totalRolls: rolls.length,
                };
            });
        }
        game.diceRoundSummary = roundSummary;
        game.gameStatus = 'dice_round_end';
        game.revealEndTime = now + 20000;
        if (!game.roundEndConfirmations) game.roundEndConfirmations = {};
        if (game.isAiGame) game.roundEndConfirmations[aiUserId] = now;

    } else {
        game.lastTurnStones = game.stonesPlacedThisTurn;
        game.stonesPlacedThisTurn = [];
        game.lastMove = null;

        game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
        game.gameStatus = 'dice_rolling';
        game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
        game.turnStartTime = now;
    }
    
    game.diceCapturesThisTurn = 0;
    game.diceLastCaptureStones = [];
}


const handleTimeoutFoul = (game: types.LiveGameSession, timedOutPlayerId: string, now: number): boolean => {
    if (!game.timeoutFouls) game.timeoutFouls = {};
    game.timeoutFouls[timedOutPlayerId] = (game.timeoutFouls[timedOutPlayerId] || 0) + 1;
    game.foulInfo = { message: '시간 초과 파울!', expiry: now + 4000 };

    if (game.timeoutFouls[timedOutPlayerId] >= PLAYFUL_MODE_FOUL_LIMIT) {
        const winnerId = game.player1.id === timedOutPlayerId ? game.player2.id : game.player1.id;
        const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : types.Player.White;
        endGame(game, winnerEnum, 'timeout');
        return true; // Game ended
    }
    return false; // Game continues
};


export const initializeDiceGo = (game: types.LiveGameSession, neg: types.Negotiation, now: number) => {
    const p1 = game.player1;
    const p2 = game.player2;

    game.blackPlayerId = null;
    game.whitePlayerId = null;
    
    const initialStoneCount = DICE_GO_INITIAL_WHITE_STONES_BY_ROUND[0];
    const { boardSize } = game.settings;
    const tempBoard = game.boardState;

    const getNeighbors = (x: number, y: number) => {
        const neighbors = [];
        if (x > 0) neighbors.push({ x: x - 1, y });
        if (x < boardSize - 1) neighbors.push({ x: x + 1, y });
        if (y > 0) neighbors.push({ x, y: y - 1 });
        if (y < boardSize - 1) neighbors.push({ x, y: y + 1 });
        return neighbors;
    };

    const findGroupSize = (startX: number, startY: number) => {
        const q: types.Point[] = [{ x: startX, y: startY }];
        const visited = new Set([`${startX},${startY}`]);
        let size = 0;
        while (q.length > 0) {
            const { x, y } = q.shift()!;
            size++;
            for (const n of getNeighbors(x, y)) {
                const key = `${n.x},${n.y}`;
                if (tempBoard[n.y][n.x] === types.Player.White && !visited.has(key)) {
                    visited.add(key);
                    q.push(n);
                }
            }
        }
        return size;
    };

    let stonesPlaced = 0;
    while (stonesPlaced < initialStoneCount) {
        let placed = false;
        let attempts = 0;
        
        while (!placed && attempts < 200) {
            attempts++;
            const shouldExtend = stonesPlaced > 0 && Math.random() < 0.8; 

            if (shouldExtend) {
                const existingStones: types.Point[] = [];
                for(let y=0; y<boardSize; y++) for(let x=0; x<boardSize; x++) if(tempBoard[y][x] === types.Player.White) existingStones.push({x,y});

                if (existingStones.length === 0) {
                    continue;
                }
                const randomExistingStone = existingStones[Math.floor(Math.random() * existingStones.length)];
                const neighbors = getNeighbors(randomExistingStone.x, randomExistingStone.y);
                const shuffledNeighbors = neighbors.sort(() => 0.5 - Math.random());

                for (const n of shuffledNeighbors) {
                    if (tempBoard[n.y][n.x] === types.Player.None) {
                        tempBoard[n.y][n.x] = types.Player.White;
                        if (findGroupSize(n.x, n.y) <= 5) {
                            stonesPlaced++;
                            placed = true;
                            break;
                        } else {
                            tempBoard[n.y][n.x] = types.Player.None; // backtrack
                        }
                    }
                }
            } else { // Start new cluster
                const x = Math.floor(Math.random() * boardSize);
                const y = Math.floor(Math.random() * boardSize);
                if (tempBoard[y][x] === types.Player.None) {
                    tempBoard[y][x] = types.Player.White;
                    stonesPlaced++;
                    placed = true;
                }
            }
        }
        if (attempts >= 200) {
            let x: number, y: number;
            do {
                x = Math.floor(Math.random() * boardSize);
                y = Math.floor(Math.random() * boardSize);
            } while (tempBoard[y][x] !== types.Player.None);
            tempBoard[y][x] = types.Player.White;
            stonesPlaced++;
        }
    }
    
    const p1Effects = effectService.calculateUserEffects(p1);
    const p2Effects = effectService.calculateUserEffects(p2);
    const p1MythicBonus = p1Effects.mythicStatBonuses[types.MythicStat.DiceGoOddBonus]?.flat || 0;
    const p2MythicBonus = p2Effects.mythicStatBonuses[types.MythicStat.DiceGoOddBonus]?.flat || 0;

    game.diceGoItemUses = {
        [p1.id]: { odd: (game.settings.oddDiceCount || 0) + p1MythicBonus, even: (game.settings.evenDiceCount || 0) + p1MythicBonus },
        [p2.id]: { odd: (game.settings.oddDiceCount || 0) + p2MythicBonus, even: (game.settings.evenDiceCount || 0) + p2MythicBonus }
    };
    
    game.scores = { [p1.id]: 0, [p2.id]: 0 };
    game.round = 1;

    if (game.isAiGame) {
        const humanPlayerColor = neg.settings.player1Color || types.Player.Black;
        if (humanPlayerColor === types.Player.Black) {
            game.blackPlayerId = game.player1.id;
            game.whitePlayerId = game.player2.id;
        } else {
            game.whitePlayerId = game.player1.id;
            game.blackPlayerId = game.player2.id;
        }
        
        game.currentPlayer = types.Player.Black;
        game.gameStatus = 'dice_rolling';
        game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
        game.turnStartTime = now;
    } else {
        game.gameStatus = 'dice_turn_rolling';
        game.turnOrderRolls = { [p1.id]: null, [p2.id]: null };
        game.turnOrderRollReady = { [p1.id]: false, [p2.id]: false };
        game.turnOrderRollTies = 0;
        game.turnOrderRollDeadline = now + DICE_GO_TURN_ROLL_TIME * 1000;
        game.diceRollHistory = { [p1.id]: [], [p2.id]: [] };
    }
};

export const updateDiceGoState = (game: types.LiveGameSession, now: number) => {
    const p1Id = game.player1.id;
    const p2Id = game.player2.id;
    
    switch (game.gameStatus) {
        case 'dice_turn_rolling':
            if (game.isAiGame) {
                const aiPlayerId = game.player1.id === aiUserId 
                    ? game.player1.id 
                    : (game.player2.id === aiUserId ? game.player2.id : null);
                
                if (aiPlayerId && game.turnOrderRollReady && !game.turnOrderRollReady[aiPlayerId]) {
                    game.turnOrderRollReady[aiPlayerId] = true;
                }
            }

            if (game.turnOrderRollDeadline && now > game.turnOrderRollDeadline) {
                if (!game.turnOrderRollReady?.[p1Id]) game.turnOrderRollReady![p1Id] = true;
                if (!game.turnOrderRollReady?.[p2Id]) game.turnOrderRollReady![p2Id] = true;
            }
            if (game.turnOrderRollReady?.[p1Id] && game.turnOrderRollReady?.[p2Id]) {
                const p1Roll = Math.floor(Math.random() * 6) + 1;
                const p2Roll = Math.floor(Math.random() * 6) + 1;
                game.animation = { type: 'dice_roll_turn', p1Roll, p2Roll, startTime: now, duration: 2000 };
                game.gameStatus = 'dice_turn_rolling_animating';
                game.turnOrderRollDeadline = undefined;
            }
            break;
        case 'dice_turn_rolling_animating':
            if (game.animation && game.animation.type === 'dice_roll_turn' && now > game.animation.startTime + game.animation.duration) {
                const { p1Roll, p2Roll } = game.animation;
                game.turnOrderRolls = { [p1Id]: p1Roll, [p2Id]: p2Roll };
                if (p1Roll === p2Roll) {
                    game.turnOrderRollTies = (game.turnOrderRollTies || 0) + 1;
                    if (game.turnOrderRollTies >= 3) {
                        // Force a winner
                        const winnerId = Math.random() < 0.5 ? p1Id : p2Id;
                        game.turnChooserId = winnerId;
                        game.gameStatus = 'dice_turn_choice';
                        game.turnChoiceDeadline = now + DICE_GO_TURN_CHOICE_TIME * 1000;
                        game.turnOrderRollTies = 0; // Reset for next potential game
                    } else {
                        // Re-roll
                        game.gameStatus = 'dice_turn_rolling';
                        game.turnOrderRollResult = 'tie';
                        game.turnOrderRollReady = { [p1Id]: false, [p2Id]: false };
                        game.turnOrderRollDeadline = now + DICE_GO_TURN_ROLL_TIME * 1000;
                    }
                } else {
                    game.turnChooserId = p1Roll > p2Roll ? p1Id : p2Id;
                    game.gameStatus = 'dice_turn_choice';
                    game.turnChoiceDeadline = now + DICE_GO_TURN_CHOICE_TIME * 1000;
                    game.turnOrderRollTies = 0; // Reset on non-tie
                }
                game.animation = null;
            }
            break;
        case 'dice_turn_choice':
            if (game.turnChoiceDeadline && now > game.turnChoiceDeadline) {
                const choice = Math.random() < 0.5 ? 'first' : 'second';
                let chooserId = game.turnChooserId;
                if (!chooserId) {
                    chooserId = Math.random() < 0.5 ? p1Id : p2Id;
                }
                const otherId = chooserId === p1Id ? p2Id : p1Id;

                if (choice === 'first') {
                    game.blackPlayerId = chooserId;
                    game.whitePlayerId = otherId;
                } else {
                    game.whitePlayerId = chooserId;
                    game.blackPlayerId = otherId;
                }
                
                game.gameStatus = 'dice_start_confirmation';
                game.revealEndTime = now + 10000;
            }
            break;
        case 'dice_start_confirmation':
            if ((game.preGameConfirmations?.[p1Id] && game.preGameConfirmations?.[p2Id]) || (game.revealEndTime && now > game.revealEndTime)) {
                game.gameStatus = 'dice_rolling';
                game.currentPlayer = types.Player.Black;
                game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                game.turnStartTime = now;
            }
            break;
        case 'dice_rolling_animating':
            if (game.animation && game.animation.type === 'dice_roll_main' && now > game.animation.startTime + game.animation.duration) {
                game.dice = game.animation.dice;
                game.animation = null;

                if (game.stonesToPlace === -1) { // Overshot
                    const overshotPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                    const overshotPlayer = game.player1.id === overshotPlayerId ? game.player1 : game.player2;
                    game.foulInfo = { message: `${overshotPlayer.nickname}님의 오버샷! 턴이 넘어갑니다.`, expiry: now + 4000 };
                    game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
                    game.gameStatus = 'dice_rolling';
                    game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                    game.turnStartTime = now;
                    game.stonesToPlace = 0;
                } else {
                    game.gameStatus = 'dice_placing';
                    game.turnDeadline = now + DICE_GO_MAIN_PLACE_TIME * 1000;
                    game.turnStartTime = now;
                    game.diceCapturesThisTurn = 0;
                    game.diceLastCaptureStones = [];
                    game.stonesPlacedThisTurn = [];
                    
                    const logic = getGoLogic(game);
                    const allWhiteLiberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
                    const whiteStoneCount = game.boardState.flat().filter(s => s === types.Player.White).length;

                    if (whiteStoneCount > 0) {
                        game.lastWhiteGroupInfo = { size: whiteStoneCount, liberties: allWhiteLiberties.length };
                    } else {
                        game.lastWhiteGroupInfo = null;
                    }
                }
            }
            break;
        case 'dice_rolling': {
            // turnDeadline이 없으면 설정 (게임 로드 시나 상태 불일치 시 대비)
            if (!game.turnDeadline) {
                console.log(`[updateDiceGoState] Setting turnDeadline for dice_rolling: gameId=${game.id}, currentPlayer=${game.currentPlayer}`);
                game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                game.turnStartTime = now;
            }
            
            // AI 턴일 때는 타임아웃 체크를 건너뛰기
            const isAiTurn = game.isAiGame && game.currentPlayer !== types.Player.None && 
                            (game.currentPlayer === types.Player.Black ? game.blackPlayerId === aiUserId : game.whitePlayerId === aiUserId);
            
            // 타임아웃 체크 및 자동 주사위 굴리기
            if (game.turnDeadline && now > game.turnDeadline && !isAiTurn) {
                const timedOutPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                const timeOver = now - game.turnDeadline;
                console.log(`[updateDiceGoState] Timeout detected: gameId=${game.id}, timedOutPlayerId=${timedOutPlayerId}, timeOver=${timeOver}ms`);
                
                const gameEnded = handleTimeoutFoul(game, timedOutPlayerId, now);
                if (gameEnded) {
                    console.log(`[updateDiceGoState] Game ended due to timeout foul limit`);
                    return;
                }

                // 타임아웃 시 자동으로 주사위 굴리기
                const dice1 = Math.floor(Math.random() * 6) + 1;
                const logic = getGoLogic(game);
                const liberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
                const isOvershot = liberties.length > 0 && dice1 > liberties.length;
                
                console.log(`[updateDiceGoState] Auto-rolling dice due to timeout: dice1=${dice1}, isOvershot=${isOvershot}, liberties=${liberties.length}`);
                
                game.animation = { type: 'dice_roll_main', dice: { dice1, dice2: 0, dice3: 0 }, startTime: now, duration: 1500 };
                game.gameStatus = 'dice_rolling_animating';
                game.turnDeadline = undefined;
                game.turnStartTime = undefined;
                game.dice = undefined;
    
                game.stonesToPlace = isOvershot ? -1 : dice1;
                if (game.diceRollHistory && game.diceRollHistory[timedOutPlayerId]) {
                    game.diceRollHistory[timedOutPlayerId].push(dice1);
                }
            }
            break;
        }
        case 'dice_placing':
            // AI 턴일 때는 타임아웃 체크를 건너뛰기
            const isAiTurnPlacing = game.isAiGame && game.currentPlayer !== types.Player.None && 
                                   (game.currentPlayer === types.Player.Black ? game.blackPlayerId === aiUserId : game.whitePlayerId === aiUserId);
            
            if (game.turnDeadline && now > game.turnDeadline && !isAiTurnPlacing) {
                const timedOutPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                const gameEnded = handleTimeoutFoul(game, timedOutPlayerId, now);
                if (gameEnded) return;

                let stonesToPlace = game.stonesToPlace || 0;
                let tempBoardState = JSON.parse(JSON.stringify(game.boardState));
                let totalCapturesThisTurn = 0;
                let lastCaptureStones: types.Point[] = [];
        
                while (stonesToPlace > 0) {
                    const logicForLiberty = getGoLogic({ ...game, boardState: tempBoardState });
                    const liberties = logicForLiberty.getAllLibertiesOfPlayer(types.Player.White, tempBoardState);
                    if (liberties.length === 0) break;
                    
                    const move = liberties[Math.floor(Math.random() * liberties.length)];
                    const result = processMove(tempBoardState, { ...move, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
        
                    if (result.isValid) {
                        tempBoardState = result.newBoardState;
                        if (result.capturedStones.length > 0) {
                            totalCapturesThisTurn += result.capturedStones.length;
                            lastCaptureStones = result.capturedStones;
                        }
                    } else {
                        console.error(`Dice Go Timeout random placement failed. Liberty: ${JSON.stringify(move)}, Reason: ${result.reason}`);
                        break;
                    }
                    stonesToPlace--;
                }
                game.boardState = tempBoardState;
                game.diceCapturesThisTurn = totalCapturesThisTurn;
                game.diceLastCaptureStones = lastCaptureStones;
                finishPlacingTurn(game, timedOutPlayerId);
            }
            break;
        case 'dice_round_end':
            if (game.isAiGame) {
                if (!game.roundEndConfirmations) game.roundEndConfirmations = {};
                game.roundEndConfirmations[aiUserId] = now;
            }
            const bothConfirmed = game.roundEndConfirmations?.[p1Id] && game.roundEndConfirmations?.[p2Id];
            if ((game.revealEndTime && now > game.revealEndTime) || bothConfirmed) {
                const totalRounds = game.settings.diceGoRounds || 3;
                if (game.round >= totalRounds && !game.isDeathmatch) {
                    const p1Score = game.scores[p1Id] || 0;
                    const p2Score = game.scores[p2Id] || 0;
                    if (p1Score === p2Score) { // Tie, start deathmatch
                        game.round++;
                        game.isDeathmatch = true;
                        game.boardState = Array(game.settings.boardSize).fill(0).map(() => Array(game.settings.boardSize).fill(types.Player.None));
                        const center = Math.floor(game.settings.boardSize / 2);
                        game.boardState[center][center] = types.Player.White;
                        game.gameStatus = 'dice_rolling';
                        game.currentPlayer = types.Player.Black;
                        game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                        game.turnStartTime = now;
                        game.diceRoundSummary = undefined;
                        game.roundEndConfirmations = {};
                        game.lastWhiteGroupInfo = null;
                        return;
                    } else {
                        const winnerId = p1Score > p2Score ? p1Id : p2Id;
                        const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : (winnerId === game.whitePlayerId ? types.Player.White : types.Player.None);
                        endGame(game, winnerEnum, 'dice_win');
                        return;
                    }
                } else {
                    game.round++;
                }

                // Start next round
                game.boardState = Array(game.settings.boardSize).fill(0).map(() => Array(game.settings.boardSize).fill(types.Player.None));
                const initialStoneCount = DICE_GO_INITIAL_WHITE_STONES_BY_ROUND[game.round - 1];
                const occupied = new Set<string>();
                for (let i = 0; i < initialStoneCount; i++) {
                    let x: number, y: number, key: string;
                    do {
                        x = Math.floor(Math.random() * game.settings.boardSize);
                        y = Math.floor(Math.random() * game.settings.boardSize);
                        key = `${x},${y}`;
                    } while (occupied.has(key));
                    game.boardState[y][x] = types.Player.White;
                    occupied.add(key);
                }
                game.gameStatus = 'dice_rolling';
                game.currentPlayer = types.Player.Black; // Black (first player) always starts the round
                game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                game.turnStartTime = now;
                game.diceRoundSummary = undefined;
                game.roundEndConfirmations = {};
                game.lastWhiteGroupInfo = null; // Clear info for the new round
            }
            break;
    }
};

export const handleDiceGoAction = async (volatileState: types.VolatileState, game: types.LiveGameSession, action: types.ServerAction & { userId: string }, user: types.User): Promise<types.HandleActionResult | undefined> => {
    const { type, payload } = action;
    const now = Date.now();
    
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const isMyTurn = myPlayerEnum === game.currentPlayer;
    const p1Id = game.player1.id;
    
    // Delegate shared actions first
    const sharedResult = await handleSharedAction(volatileState, game, action, user);
    if (sharedResult) {
        await db.saveGame(game);
        return sharedResult;
    }

    switch(type) {
        case 'DICE_READY_FOR_TURN_ROLL': {
            if (game.gameStatus !== 'dice_turn_rolling') return { error: 'Not in turn rolling phase.' };
            if (!game.turnOrderRollReady) game.turnOrderRollReady = {};
            game.turnOrderRollReady[user.id] = true;
            await db.saveGame(game);
            return {};
        }
        case 'DICE_CHOOSE_TURN': {
            if (game.gameStatus !== 'dice_turn_choice' || user.id !== game.turnChooserId) return { error: 'Not your turn to choose.' };
            const { choice } = payload as { choice: 'first' | 'second' };
            const chooserId = game.turnChooserId;
            if (!chooserId) return { error: 'Chooser not set.' };
            const otherId = chooserId === p1Id ? game.player2.id : p1Id;

            if (choice === 'first') {
                game.blackPlayerId = chooserId;
                game.whitePlayerId = otherId;
            } else {
                game.whitePlayerId = chooserId;
                game.blackPlayerId = otherId;
            }
            game.gameStatus = 'dice_start_confirmation';
            game.revealEndTime = now + 10000;
            return {};
        }
        case 'DICE_CONFIRM_START': {
             if (game.gameStatus !== 'dice_start_confirmation') return { error: "Not in confirmation phase." };
             if (!game.preGameConfirmations) game.preGameConfirmations = {};
             game.preGameConfirmations[user.id] = true;
             await db.saveGame(game);
             return {};
        }
        case 'DICE_ROLL': {
            console.log(`[handleDiceGoAction] DICE_ROLL received: gameStatus=${game.gameStatus}, isMyTurn=${isMyTurn}, currentPlayer=${game.currentPlayer}, myPlayerEnum=${myPlayerEnum}, userId=${user.id}`);
            if (game.gameStatus !== 'dice_rolling') {
                console.error(`[handleDiceGoAction] DICE_ROLL failed: gameStatus is ${game.gameStatus}, expected dice_rolling`);
                return { error: `Not in dice rolling phase. Current status: ${game.gameStatus}` };
            }
            if (!isMyTurn) {
                console.error(`[handleDiceGoAction] DICE_ROLL failed: not my turn. currentPlayer=${game.currentPlayer}, myPlayerEnum=${myPlayerEnum}, userId=${user.id}`);
                return { error: 'Not your turn to roll.' };
            }
            const { itemType } = payload as { itemType?: 'odd' | 'even' };
            let dice1: number;
            
            if (itemType) {
                if (!game.diceGoItemUses || !game.diceGoItemUses[user.id] || game.diceGoItemUses[user.id][itemType] <= 0) {
                    return { error: '아이템이 없습니다.' };
                }
                game.diceGoItemUses[user.id][itemType]--;
                const oddNumbers = [1, 3, 5];
                const evenNumbers = [2, 4, 6];
                const pool = itemType === 'odd' ? oddNumbers : evenNumbers;
                dice1 = pool[Math.floor(Math.random() * pool.length)];
            } else {
                dice1 = Math.floor(Math.random() * 6) + 1;
            }

            const logic = getGoLogic(game);
            const liberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
            const isOvershot = liberties.length > 0 && dice1 > liberties.length;
            
            game.animation = { type: 'dice_roll_main', dice: { dice1, dice2: 0, dice3: 0 }, startTime: now, duration: 1500 };
            game.gameStatus = 'dice_rolling_animating';
            game.turnDeadline = undefined;
            game.turnStartTime = undefined;
            game.dice = undefined;

            game.stonesToPlace = isOvershot ? -1 : dice1;
            if (game.diceRollHistory) game.diceRollHistory[user.id].push(dice1);
            await db.saveGame(game);
            return {};
        }
        case 'DICE_PLACE_STONE': {
            if (game.gameStatus !== 'dice_placing' || !isMyTurn) return { error: '상대방의 차례입니다.' };
            if ((game.stonesToPlace ?? 0) <= 0) return { error: 'No stones left to place.' };

            const { x, y } = payload;
            
            // 치명적 버그 방지: 상대방 돌 위에 착점하는 것을 명시적으로 차단
            const stoneAtTarget = game.boardState[y][x];
            const opponentPlayerEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
            
            if (stoneAtTarget === opponentPlayerEnum) {
                console.error(`[handleDiceGoAction] CRITICAL BUG PREVENTION: Attempted to place stone on opponent stone at (${x}, ${y}), gameId=${game.id}, stoneAtTarget=${stoneAtTarget}, opponentPlayerEnum=${opponentPlayerEnum}`);
                return { error: '상대방이 둔 자리에는 돌을 놓을 수 없습니다.' };
            }
            
            if (stoneAtTarget === myPlayerEnum) {
                console.error(`[handleDiceGoAction] CRITICAL BUG PREVENTION: Attempted to place stone on own stone at (${x}, ${y}), gameId=${game.id}, stoneAtTarget=${stoneAtTarget}, myPlayerEnum=${myPlayerEnum}`);
                return { error: '이미 돌이 놓인 자리입니다.' };
            }
            
            const logic = getGoLogic(game);
            const liberties = logic.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
            
            const anyWhiteStones = game.boardState.flat().some(s => s === types.Player.White);

            if (anyWhiteStones && liberties.length > 0 && !liberties.some(p => p.x === x && p.y === y)) {
                return { error: '백돌의 활로에만 착수할 수 있습니다.' };
            }

            const move = { x, y, player: types.Player.Black };
            const result = processMove(game.boardState, move, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });

            if (!result.isValid) {
                console.error(`[handleDiceGoAction] CRITICAL BUG PREVENTION: processMove returned invalid at (${x}, ${y}), gameId=${game.id}, reason=${result.reason}`);
                return { error: `Invalid move: ${result.reason}` };
            }

            if (!game.stonesPlacedThisTurn) {
                game.stonesPlacedThisTurn = [];
            }
            game.stonesPlacedThisTurn.push({ x, y });

            game.diceCapturesThisTurn = (game.diceCapturesThisTurn || 0) + result.capturedStones.length;
            if (result.capturedStones.length > 0) {
                game.diceLastCaptureStones = result.capturedStones;
            }

            game.boardState = result.newBoardState;
            game.lastMove = { x, y };
            
            const logicForWhiteGroup = getGoLogic(game);
            const allWhiteLiberties = logicForWhiteGroup.getAllLibertiesOfPlayer(types.Player.White, game.boardState);
            const whiteStoneCount = game.boardState.flat().filter(s => s === types.Player.White).length;

            if (whiteStoneCount > 0) {
                game.lastWhiteGroupInfo = { size: whiteStoneCount, liberties: allWhiteLiberties.length };
            } else {
                game.lastWhiteGroupInfo = null;
            }

            game.stonesToPlace = (game.stonesToPlace ?? 1) - 1;
            const whiteStonesLeft = game.boardState.flat().filter(s => s === types.Player.White).length;

            if (game.isDeathmatch && whiteStonesLeft === 0) {
                endGame(game, myPlayerEnum, 'dice_win');
                return {};
            }

            if (whiteStonesLeft === 0 || game.stonesToPlace <= 0) {
                finishPlacingTurn(game, user.id);
            }
            await db.saveGame(game);
            return {};
        }
        case 'CONFIRM_ROUND_END': {
            if (game.gameStatus !== 'dice_round_end') return { error: "Not in round end confirmation phase." };
            if (!game.roundEndConfirmations) game.roundEndConfirmations = {};
            game.roundEndConfirmations[user.id] = now;
            await db.saveGame(game);
            return {};
        }
    }
};