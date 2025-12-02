import * as types from '../../types/index.js';
import * as db from '../db.js';
import { getGoLogic, processMove } from '../goLogic.js';
import { handleSharedAction, updateSharedGameState, handleTimeoutFoul } from './shared.js';
import { DICE_GO_MAIN_ROLL_TIME, DICE_GO_MAIN_PLACE_TIME } from '../../constants';
import { endGame } from '../summaryService.js';
import { aiUserId } from '../aiPlayer.js';

export const initializeThief = (game: types.LiveGameSession, neg: types.Negotiation, now: number) => {
    const p1 = game.player1;
    const p2 = game.player2;
    game.blackPlayerId = null;
    game.whitePlayerId = null;

    if (game.isAiGame) {
        // Human (p1) chooses their role via player1Color setting.
        // Thief is Black, Police is White.
        const humanIsThief = neg.settings.player1Color === types.Player.Black;

        if (humanIsThief) {
            game.thiefPlayerId = p1.id;
            game.policePlayerId = p2.id;
        } else { // Human is Police
            game.policePlayerId = p1.id;
            game.thiefPlayerId = p2.id;
        }

        game.blackPlayerId = game.thiefPlayerId;
        game.whitePlayerId = game.policePlayerId;
        
        // Directly start the game
        game.gameStatus = 'thief_rolling';
        game.currentPlayer = types.Player.Black; // Thief always starts
        game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
        game.turnStartTime = now;
        game.round = 1; // Initialize round
        game.scores = { [p1.id]: 0, [p2.id]: 0 }; // Initialize scores
        game.turnInRound = 1; // Initialize turn in round
    } else {
        // Original logic for human players
        game.gameStatus = 'thief_role_selection';
        game.roleChoices = { [p1.id]: null, [p2.id]: null };
        game.turnChoiceDeadline = now + 10000; // 10s
    }
};

export const updateThiefState = (game: types.LiveGameSession, now: number) => {
    const p1Id = game.player1.id;
    const p2Id = game.player2.id;

    if (game.gameStatus === 'thief_role_selection') {
        const p1Choice = game.roleChoices?.[p1Id];
        const p2Choice = game.roleChoices?.[p2Id];
        const deadlinePassed = game.turnChoiceDeadline && now > game.turnChoiceDeadline;

        if ((p1Choice && p2Choice) || deadlinePassed) {
            const choices = ['thief', 'police'] as const;
            
            let finalP1Choice = p1Choice;
            let finalP2Choice = p2Choice;

            if (deadlinePassed) {
                if (!game.roleChoices) game.roleChoices = {};
                if (!finalP1Choice) {
                    finalP1Choice = choices[Math.floor(Math.random() * 2)];
                    game.roleChoices[p1Id] = finalP1Choice;
                }
                if (!finalP2Choice) {
                    finalP2Choice = choices[Math.floor(Math.random() * 2)];
                    game.roleChoices[p2Id] = finalP2Choice;
                }
            }

            if (finalP1Choice && finalP2Choice) { // Type guard for safety
                if (finalP1Choice === finalP2Choice) {
                    game.gameStatus = 'thief_rps';
                    game.rpsState = { [p1Id]: null, [p2Id]: null };
                    game.rpsRound = 1;
                    game.turnDeadline = now + 30000;
                } else {
                    if (finalP1Choice === 'thief') {
                        game.thiefPlayerId = p1Id;
                        game.policePlayerId = p2Id;
                    } else { // p1c must be 'police'
                        game.thiefPlayerId = p2Id;
                        game.policePlayerId = p1Id;
                    }
                    game.blackPlayerId = game.thiefPlayerId;
                    game.whitePlayerId = game.policePlayerId;
                    game.gameStatus = 'thief_role_confirmed';
                    game.revealEndTime = now + 10000;
                }
            }
        }
    } else if (game.gameStatus === 'thief_rps_reveal') {
        if (game.revealEndTime && now > game.revealEndTime) {
            const p1Choice = game.rpsState?.[p1Id];
            const p2Choice = game.rpsState?.[p2Id];

            if (p1Choice && p2Choice) {
                 let winnerId: string;
                if (p1Choice === p2Choice) {
                    winnerId = Math.random() < 0.5 ? p1Id : p2Id;
                } else {
                    const p1Wins = (p1Choice === 'rock' && p2Choice === 'scissors') ||
                                   (p1Choice === 'scissors' && p2Choice === 'paper') ||
                                   (p1Choice === 'paper' && p2Choice === 'rock');
                    winnerId = p1Wins ? p1Id : p2Id;
                }
                
                const loserId = winnerId === p1Id ? p2Id : p1Id;
                const winnerChoice = game.roleChoices![winnerId]!;
                
                if(winnerChoice === 'thief') {
                    game.thiefPlayerId = winnerId;
                    game.policePlayerId = loserId;
                } else {
                    game.policePlayerId = winnerId;
                    game.thiefPlayerId = loserId;
                }
                
                game.blackPlayerId = game.thiefPlayerId;
                game.whitePlayerId = game.policePlayerId;
                game.gameStatus = 'thief_role_confirmed';
                game.revealEndTime = now + 10000;
            }
        }
    } else if (game.gameStatus === 'thief_role_confirmed') {
        if (game.isAiGame) {
            if (!game.preGameConfirmations) game.preGameConfirmations = {};
            game.preGameConfirmations[aiUserId] = true;
        }
        const bothConfirmed = game.preGameConfirmations?.[p1Id] && game.preGameConfirmations?.[p2Id];
        const deadlinePassed = game.revealEndTime && now > game.revealEndTime;
        if (bothConfirmed || deadlinePassed) {
            game.gameStatus = 'thief_rolling';
            game.currentPlayer = types.Player.Black; // Thief always starts
            game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
            game.turnStartTime = now;
            game.round = 1; // Initialize round
            game.scores = { [p1Id]: 0, [p2Id]: 0 }; // Initialize scores
            game.turnInRound = 1; // Initialize turn in round
            game.thiefCapturesThisRound = 0;
            game.preGameConfirmations = {};
            game.revealEndTime = undefined;
        }
    } else if (game.gameStatus === 'thief_rolling') {
        // turnDeadline이 없으면 설정 (게임 로드 시나 상태 불일치 시 대비)
        if (!game.turnDeadline) {
            console.log(`[updateThiefState] Setting turnDeadline for thief_rolling: gameId=${game.id}, currentPlayer=${game.currentPlayer}`);
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
            console.log(`[updateThiefState] Timeout detected in thief_rolling: gameId=${game.id}, timedOutPlayerId=${timedOutPlayerId}, timeOver=${timeOver}ms`);
            
            const gameEnded = handleTimeoutFoul(game, timedOutPlayerId, now);
            if (gameEnded) {
                console.log(`[updateThiefState] Game ended due to timeout foul limit`);
                return;
            }

            // 타임아웃 시 자동으로 주사위 굴리기
            const myRole = timedOutPlayerId === game.thiefPlayerId ? 'thief' : 'police';
            const dice1 = Math.floor(Math.random() * 6) + 1;
            let dice2 = 0;
            let stonesToPlace: number;
            
            if (myRole === 'police') {
                dice2 = Math.floor(Math.random() * 6) + 1;
                stonesToPlace = dice1 + dice2;
            } else {
                stonesToPlace = dice1;
            }
            
            console.log(`[updateThiefState] Auto-rolling dice due to timeout: role=${myRole}, dice1=${dice1}, dice2=${dice2}, stonesToPlace=${stonesToPlace}`);
            
            game.animation = { type: 'dice_roll_main', dice: { dice1, dice2, dice3: 0 }, startTime: now, duration: 1500 };
            game.gameStatus = 'thief_rolling_animating';
            game.turnDeadline = undefined;
            game.turnStartTime = undefined;
            game.dice = undefined;
            game.stonesToPlace = stonesToPlace;
            
            if (!game.thiefDiceRollHistory) game.thiefDiceRollHistory = { [p1Id]: [], [p2Id]: [] };
            game.thiefDiceRollHistory[timedOutPlayerId].push(dice1);
            if (dice2 > 0) game.thiefDiceRollHistory[timedOutPlayerId].push(dice2);
        }
    } else if (game.gameStatus === 'thief_rolling_animating') {
        if (game.animation && game.animation.type === 'dice_roll_main' && now > game.animation.startTime + game.animation.duration) {
            game.dice = game.animation.dice;
            game.animation = null;
            game.gameStatus = 'thief_placing';
            game.stonesPlacedThisTurn = []; // Initialize for the new turn
            game.turnDeadline = now + DICE_GO_MAIN_PLACE_TIME * 1000;
            game.turnStartTime = now;
        }
    } else if (game.gameStatus === 'thief_placing') {
        // turnDeadline이 없으면 설정 (게임 로드 시나 상태 불일치 시 대비)
        if (!game.turnDeadline) {
            console.log(`[updateThiefState] Setting turnDeadline for thief_placing: gameId=${game.id}, currentPlayer=${game.currentPlayer}`);
            game.turnDeadline = now + DICE_GO_MAIN_PLACE_TIME * 1000;
            game.turnStartTime = now;
        }
        
        // AI 턴일 때는 타임아웃 체크를 건너뛰기
        const isAiTurnPlacing = game.isAiGame && game.currentPlayer !== types.Player.None && 
                               (game.currentPlayer === types.Player.Black ? game.blackPlayerId === aiUserId : game.whitePlayerId === aiUserId);
        
        // 타임아웃 체크 및 자동 착점
        if (game.turnDeadline && now > game.turnDeadline && !isAiTurnPlacing) {
            const timedOutPlayerId = game.currentPlayer === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
            const timeOver = now - game.turnDeadline;
            console.log(`[updateThiefState] Timeout detected in thief_placing: gameId=${game.id}, timedOutPlayerId=${timedOutPlayerId}, timeOver=${timeOver}ms`);
            
            const gameEnded = handleTimeoutFoul(game, timedOutPlayerId, now);
            if (gameEnded) {
                console.log(`[updateThiefState] Game ended due to timeout foul limit`);
                return;
            }

            // 타임아웃 시 자동으로 랜덤 착점 (남은 돌 수만큼)
            let stonesToPlace = game.stonesToPlace || 0;
            const myRole = timedOutPlayerId === game.thiefPlayerId ? 'thief' : 'police';
            let tempBoardState = JSON.parse(JSON.stringify(game.boardState));
            let totalCapturesThisTurn = 0;
            let lastCaptureStones: types.Point[] = [];
    
            while (stonesToPlace > 0) {
                const logicForLiberty = getGoLogic({ ...game, boardState: tempBoardState });
                let move: types.Point | null = null;
                
                if (myRole === 'thief') {
                    // 도둑: 기존 돌의 활로에만 놓을 수 있음
                    const liberties = logicForLiberty.getAllLibertiesOfPlayer(types.Player.Black, tempBoardState);
                    const noBlackStonesOnBoard = !tempBoardState.flat().includes(types.Player.Black);
                    const canPlaceFreely = (game.turnInRound === 1 || noBlackStonesOnBoard);
                    
                    if (canPlaceFreely) {
                        // 자유롭게 놓을 수 있음
                        const emptySpots: types.Point[] = [];
                        for (let y = 0; y < game.settings.boardSize; y++) {
                            for (let x = 0; x < game.settings.boardSize; x++) {
                                if (tempBoardState[y][x] === types.Player.None) {
                                    emptySpots.push({ x, y });
                                }
                            }
                        }
                        if (emptySpots.length > 0) {
                            move = emptySpots[Math.floor(Math.random() * emptySpots.length)];
                        }
                    } else {
                        // 활로에만 놓을 수 있음
                        const liberties = logicForLiberty.getAllLibertiesOfPlayer(types.Player.Black, tempBoardState);
                        if (liberties.length > 0) {
                            move = liberties[Math.floor(Math.random() * liberties.length)];
                        }
                    }
                } else {
                    // 경찰: 흰 돌의 활로에 놓을 수 있음
                    const liberties = logicForLiberty.getAllLibertiesOfPlayer(types.Player.White, tempBoardState);
                    if (liberties.length > 0) {
                        move = liberties[Math.floor(Math.random() * liberties.length)];
                    }
                }
                
                if (!move) break;
                
                const result = processMove(tempBoardState, { ...move, player: types.Player.Black }, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
    
                if (result.isValid) {
                    tempBoardState = result.newBoardState;
                    if (result.capturedStones.length > 0) {
                        totalCapturesThisTurn += result.capturedStones.length;
                        lastCaptureStones = result.capturedStones;
                        if (!game.thiefCapturesThisRound) game.thiefCapturesThisRound = 0;
                        game.thiefCapturesThisRound += result.capturedStones.length;
                    }
                    if (!game.stonesPlacedThisTurn) game.stonesPlacedThisTurn = [];
                    game.stonesPlacedThisTurn.push(move);
                } else {
                    console.error(`[updateThiefState] Timeout random placement failed. Move: ${JSON.stringify(move)}, Reason: ${result.reason}`);
                    break;
                }
                stonesToPlace--;
            }
            
            game.boardState = tempBoardState;
            game.stonesToPlace = stonesToPlace;
            
            // 턴 종료 처리 (THIEF_PLACE_STONE과 동일한 로직)
            if (game.stonesToPlace <= 0) {
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
                    
                    const p1IsThief = game.player1.id === game.thiefPlayerId;
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
                        endGame(game, winnerEnum, 'total_score');
                    } else {
                        game.gameStatus = 'thief_round_end';
                        game.revealEndTime = now + 20000;
                        if(game.isAiGame) game.roundEndConfirmations = { [aiUserId]: now };
                    }
                } else {
                    game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
                    game.gameStatus = 'thief_rolling';
                    game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                    game.turnStartTime = now;
                }
            }
        }
    } else if (game.gameStatus === 'thief_round_end') {
         if (game.isAiGame) {
            if (!game.roundEndConfirmations) game.roundEndConfirmations = {};
            game.roundEndConfirmations[aiUserId] = now;
         }
         const bothConfirmed = game.roundEndConfirmations?.[p1Id] && game.roundEndConfirmations?.[p2Id];
         const deadlinePassed = game.revealEndTime && now > game.revealEndTime;

         if(bothConfirmed || deadlinePassed) {
             const p1Score = game.thiefRoundSummary!.player1.cumulativeScore;
             const p2Score = game.thiefRoundSummary!.player2.cumulativeScore;

             if ((game.round === 2 && p1Score !== p2Score) || game.isDeathmatch) {
                 const winnerId = p1Score > p2Score ? p1Id : p2Id;
                 const winnerEnum = winnerId === game.blackPlayerId ? types.Player.Black : types.Player.White;
                 endGame(game, winnerEnum, 'total_score');
             } else if (game.round === 2 && p1Score === p2Score) { // Tie after 2 rounds, start deathmatch
                game.round++;
                game.isDeathmatch = true;
                game.boardState = Array(game.settings.boardSize).fill(0).map(() => Array(game.settings.boardSize).fill(types.Player.None));
                game.turnInRound = 1;
                game.thiefCapturesThisRound = 0;
                
                game.gameStatus = 'thief_role_selection';
                game.roleChoices = { [p1Id]: null, [p2Id]: null };
                game.turnChoiceDeadline = now + 10000; // 10s
             } else { // round 1 ended, start round 2
                 game.round++;
                 game.isDeathmatch = game.round > 2;
                 game.boardState = Array(game.settings.boardSize).fill(0).map(() => Array(game.settings.boardSize).fill(types.Player.None));
                 game.turnInRound = 1;
                 game.thiefCapturesThisRound = 0;
                 
                 const p1PrevRole = game.thiefRoundSummary!.player1.role;
                 game.thiefPlayerId = p1PrevRole === 'thief' ? p2Id : p1Id;
                 game.policePlayerId = p1PrevRole === 'thief' ? p1Id : p2Id;

                 game.blackPlayerId = game.thiefPlayerId;
                 game.whitePlayerId = game.policePlayerId;
                 game.currentPlayer = types.Player.Black;
                 game.gameStatus = 'thief_rolling';
                 game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                 game.turnStartTime = now;
             }
         }
    }
};

export const handleThiefAction = async (volatileState: types.VolatileState, game: types.LiveGameSession, action: types.ServerAction & { userId: string }, user: types.User): Promise<types.HandleActionResult | undefined> => {
    const { type, payload } = action;
    const now = Date.now();
    
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const isMyTurn = myPlayerEnum === game.currentPlayer;
    const p1Id = game.player1.id;
    
    if (type === 'SUBMIT_RPS_CHOICE') {
        if (!game.rpsState || typeof game.rpsState[user.id] === 'string') {
            return { error: "Cannot make RPS choice now." };
        }
        game.rpsState[user.id] = payload.choice;
        return {};
    }
    
    // Delegate other shared actions
    const sharedResult = await handleSharedAction(volatileState, game, action, user);
    if (sharedResult) return sharedResult;

    switch (type) {
        case 'THIEF_UPDATE_ROLE_CHOICE': {
            if (game.gameStatus !== 'thief_role_selection') return { error: "Not in role selection phase." };
            if (!game.roleChoices) game.roleChoices = {};
            if (game.roleChoices[user.id]) return { error: "You have already chosen a role." };
            
            const { choice } = payload as { choice: 'thief' | 'police' };
            game.roleChoices[user.id] = choice;

            // The state transition logic is now exclusively handled by the updateThiefState function.
            // We just need to signal that the game state has changed.
            return {};
        }
        case 'CONFIRM_THIEF_ROLE': {
            if (game.gameStatus !== 'thief_role_confirmed') {
                return { error: "Not in role confirmation phase." };
            }
            if (!game.preGameConfirmations) game.preGameConfirmations = {};
            game.preGameConfirmations[user.id] = true;
            return {};
        }
        case 'THIEF_ROLL_DICE': {
            if (game.gameStatus !== 'thief_rolling' || !isMyTurn) {
                return { error: 'Not your turn to roll.' };
            }
        
            const myRole = user.id === game.thiefPlayerId ? 'thief' : 'police';
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
        
            if (!game.thiefDiceRollHistory) game.thiefDiceRollHistory = { [p1Id]: [], [game.player2.id]: [] };
            game.thiefDiceRollHistory[user.id].push(dice1);
            if (dice2 > 0) game.thiefDiceRollHistory[user.id].push(dice2);
            return {};
        }
        case 'THIEF_PLACE_STONE': {
            if (game.gameStatus !== 'thief_placing' || !isMyTurn) {
                return { error: '상대방의 차례입니다.' };
            }
            if ((game.stonesToPlace ?? 0) <= 0) {
                return { error: 'No stones left to place.' };
            }
        
            const { x, y } = payload;
            const logic = getGoLogic(game);
            const myRole = user.id === game.thiefPlayerId ? 'thief' : 'police';
            
            // 치명적 버그 방지: 상대방 돌 위에 착점하는 것을 명시적으로 차단
            const opponentPlayerEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
            const stoneAtTarget = game.boardState[y][x];
            
            if (stoneAtTarget === opponentPlayerEnum) {
                console.error(`[handleThiefAction] CRITICAL BUG PREVENTION: Attempted to place stone on opponent stone at (${x}, ${y}), gameId=${game.id}, stoneAtTarget=${stoneAtTarget}, opponentPlayerEnum=${opponentPlayerEnum}`);
                return { error: '상대방이 둔 자리에는 돌을 놓을 수 없습니다.' };
            }
            
            if (stoneAtTarget === myPlayerEnum) {
                console.error(`[handleThiefAction] CRITICAL BUG PREVENTION: Attempted to place stone on own stone at (${x}, ${y}), gameId=${game.id}, stoneAtTarget=${stoneAtTarget}, myPlayerEnum=${myPlayerEnum}`);
                return { error: '이미 돌이 놓인 자리입니다.' };
            }
        
            if (myRole === 'thief') {
                const noBlackStonesOnBoard = !game.boardState.flat().includes(types.Player.Black);
                const canPlaceFreely = (game.turnInRound === 1 || noBlackStonesOnBoard);

                if (!canPlaceFreely) {
                    const liberties = logic.getAllLibertiesOfPlayer(types.Player.Black, game.boardState);
                    if (liberties.length > 0 && !liberties.some(p => p.x === x && p.y === y)) {
                        return { error: '도둑은 기존 돌의 활로에만 놓을 수 있습니다.' };
                    }
                }
            } else { // Police
                const blackStonesOnBoard = game.boardState.flat().includes(types.Player.Black);
                if (blackStonesOnBoard) {
                     const liberties = logic.getAllLibertiesOfPlayer(types.Player.Black, game.boardState);
                     if (liberties.length > 0 && !liberties.some(p => p.x === x && p.y === y)) {
                         return { error: '경찰은 도둑의 활로에만 놓을 수 있습니다.' };
                     }
                }
            }
        
            const move = { x, y, player: myPlayerEnum };
            const result = processMove(game.boardState, move, game.koInfo, game.moveHistory.length, { ignoreSuicide: true });
            if (!result.isValid) {
                console.error(`[handleThiefAction] CRITICAL BUG PREVENTION: processMove returned invalid at (${x}, ${y}), gameId=${game.id}, reason=${result.reason}`);
                return { error: `Invalid move: ${result.reason}` };
            }
            
            if (!game.stonesPlacedThisTurn) game.stonesPlacedThisTurn = [];
            game.stonesPlacedThisTurn.push({x, y});

            game.boardState = result.newBoardState;
            game.lastMove = { x, y };
        
            if (myRole === 'police' && result.capturedStones.length > 0) {
                if (!game.thiefCapturesThisRound) game.thiefCapturesThisRound = 0;
                game.thiefCapturesThisRound += result.capturedStones.length;
            }
        
            game.stonesToPlace = (game.stonesToPlace ?? 1) - 1;
            const blackStonesLeft = game.boardState.flat().filter(s => s === types.Player.Black).length;
            const allThievesCaptured = blackStonesLeft === 0 && myRole === 'police';

            if (allThievesCaptured) {
                game.stonesToPlace = 0;
            }

            if (game.stonesToPlace <= 0) {
                game.lastTurnStones = game.stonesPlacedThisTurn;
                game.stonesPlacedThisTurn = [];
                game.lastMove = null;
                
                game.turnInRound = (game.turnInRound || 0) + 1;
                const totalTurnsInRound = 10;
        
                if (game.turnInRound > totalTurnsInRound || allThievesCaptured) {
                    const finalThiefStonesLeft = game.boardState.flat().filter(s => s === types.Player.Black).length;
                    const capturesThisRound = game.thiefCapturesThisRound || 0;
                    
                    game.scores[game.thiefPlayerId!] = (game.scores[game.thiefPlayerId!] || 0) + finalThiefStonesLeft;
                    game.scores[game.policePlayerId!] = (game.scores[game.policePlayerId!] || 0) + capturesThisRound;
                    
                    const p1IsThief = game.player1.id === game.thiefPlayerId;

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
                        endGame(game, winnerEnum, 'total_score');
                        return {};
                    }
                    
                    game.gameStatus = 'thief_round_end';
                    game.revealEndTime = now + 20000;
                    if(game.isAiGame) game.roundEndConfirmations = { [aiUserId]: now };
                } else {
                    game.currentPlayer = game.currentPlayer === types.Player.Black ? types.Player.White : types.Player.Black;
                    game.gameStatus = 'thief_rolling';
                    game.turnDeadline = now + DICE_GO_MAIN_ROLL_TIME * 1000;
                    game.turnStartTime = now;
                }
            }
            return {};
        }
        case 'CONFIRM_ROUND_END': {
            if (game.gameStatus !== 'thief_round_end') return { error: "Not in round end confirmation phase." };
            if (!game.roundEndConfirmations) game.roundEndConfirmations = {};
            game.roundEndConfirmations[user.id] = now;
            return {};
        }
    }
    return undefined;
};