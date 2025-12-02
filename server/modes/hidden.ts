import * as types from '../../types/index.js';
import * as db from '../db.js';
import { getGameResult } from '../gameModes.js';

type HandleActionResult = types.HandleActionResult;

export const initializeHidden = (game: types.LiveGameSession) => {
    const isHiddenMode = game.mode === types.GameMode.Hidden || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Hidden));
    if (isHiddenMode) {
        game.scans_p1 = (game.settings.scanCount || 0);
        game.scans_p2 = (game.settings.scanCount || 0);
        game.hidden_stones_used_p1 = 0;
        game.hidden_stones_used_p2 = 0;
    }
};

export const updateHiddenState = (game: types.LiveGameSession, now: number) => {
    const isItemMode = ['hidden_placing', 'scanning'].includes(game.gameStatus);

    if (isItemMode && game.itemUseDeadline && now > game.itemUseDeadline) {
        // Item use timed out. 아이템 소멸하고 턴 유지
        const timedOutPlayerEnum = game.currentPlayer;
        const timedOutPlayerId = timedOutPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
        const currentItemMode = game.gameStatus; // 현재 아이템 모드 저장 (hidden_placing 또는 scanning)
        
        game.foulInfo = { message: `${game.player1.id === timedOutPlayerId ? game.player1.nickname : game.player2.nickname}님의 아이템 시간 초과!`, expiry: now + 4000 };
        game.gameStatus = 'playing';
        
        // 아이템 소멸 처리
        if (currentItemMode === 'hidden_placing') {
            // 히든 아이템 소멸
            const hiddenKey = timedOutPlayerId === game.player1.id ? 'hidden_stones_used_p1' : 'hidden_stones_used_p2';
            game[hiddenKey] = (game[hiddenKey] || 0) + 1;
        } else if (currentItemMode === 'scanning') {
            // 스캔 아이템 소멸
            const scanKey = timedOutPlayerId === game.player1.id ? 'scans_p1' : 'scans_p2';
            const currentScans = game[scanKey] ?? 0;
            if (currentScans > 0) {
                game[scanKey] = currentScans - 1;
            }
        }
        
        // 원래 경기 시간 복원 (턴 유지)
        if (game.settings.timeLimit > 0 && game.pausedTurnTimeLeft !== undefined) {
            const currentPlayerTimeKey = timedOutPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
            game[currentPlayerTimeKey] = game.pausedTurnTimeLeft;
            game.turnDeadline = now + game[currentPlayerTimeKey] * 1000;
            game.turnStartTime = now;
        } else {
            game.turnDeadline = undefined;
            game.turnStartTime = undefined;
        }
        
        game.itemUseDeadline = undefined;
        game.pausedTurnTimeLeft = undefined;
        
        return;
    }

    switch (game.gameStatus) {
        case 'scanning_animating':
            // 애니메이션이 없거나 시간이 지났으면 playing으로 전환
            if (!game.animation || (game.animation && now > game.animation.startTime + game.animation.duration)) {
                game.animation = null;
                // After animation, the game is already in 'playing' state with timer running for the correct player.
                // We just need to ensure the status is clean.
                game.gameStatus = 'playing';
            }
            break;
        case 'hidden_reveal_animating':
            if (game.revealAnimationEndTime && now >= game.revealAnimationEndTime) {
                const { pendingCapture } = game;
                if (pendingCapture) {
                    const myPlayerEnum = pendingCapture.move.player;
                    const opponentPlayerEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
        
                    if (!game.justCaptured) game.justCaptured = [];
        
                    for (const stone of pendingCapture.stones) {
                        game.boardState[stone.y][stone.x] = types.Player.None; // Remove stone from board
        
                        const isBaseStone = game.baseStones?.some(bs => bs.x === stone.x && bs.y === stone.y);
                        const moveIndex = game.moveHistory.findIndex(m => m.x === stone.x && m.y === stone.y);
                        const wasHidden = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
                        
                        let points = 1;
                        if (isBaseStone) {
                            game.baseStoneCaptures[myPlayerEnum]++;
                            points = 5;
                        } else if (wasHidden) {
                            game.hiddenStoneCaptures[myPlayerEnum]++;
                            points = 5;
                        }
                        game.captures[myPlayerEnum] += points;
        
                        game.justCaptured.push({ point: stone, player: opponentPlayerEnum, wasHidden });
                    }
                    
                    if (!game.newlyRevealed) game.newlyRevealed = [];
                    game.newlyRevealed.push(...pendingCapture.hiddenContributors.map(p => ({ point: p, player: myPlayerEnum })));
                }

                game.animation = null;
                game.gameStatus = 'playing';
                game.revealAnimationEndTime = undefined;
                game.pendingCapture = null;
                
                // Resume timer for the next player
                const playerWhoMoved = game.currentPlayer;
                const nextPlayer = playerWhoMoved === types.Player.Black ? types.Player.White : types.Player.Black;
                
                if (game.settings.timeLimit > 0) {
                    const timeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                    const fischerIncrement = (game.mode === types.GameMode.Speed || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Speed))) ? (game.settings.timeIncrement || 0) : 0;
                    
                    if (game.pausedTurnTimeLeft) {
                        game[timeKey] = game.pausedTurnTimeLeft + fischerIncrement;
                    }
                }
                
                game.currentPlayer = nextPlayer;
                
                if (game.settings.timeLimit > 0) {
                    const nextTimeKey = game.currentPlayer === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                    const isFischer = game.mode === types.GameMode.Speed || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Speed));
                    const isNextInByoyomi = game[nextTimeKey] <= 0 && game.settings.byoyomiCount > 0 && !isFischer;
                    if (isNextInByoyomi) {
                        game.turnDeadline = now + game.settings.byoyomiTime * 1000;
                    } else {
                        game.turnDeadline = now + game[nextTimeKey] * 1000;
                    }
                    game.turnStartTime = now;
                } else {
                     game.turnDeadline = undefined;
                     game.turnStartTime = undefined;
                }

                 game.pausedTurnTimeLeft = undefined;
            }
            break;
        case 'hidden_final_reveal':
            if (game.revealAnimationEndTime && now >= game.revealAnimationEndTime) {
                game.animation = null;
                game.revealAnimationEndTime = undefined;
                getGameResult(game); // Now trigger scoring
            }
            break;
    }
};

export const handleHiddenAction = (volatileState: types.VolatileState, game: types.LiveGameSession, action: types.ServerAction & { userId: string }, user: types.User): HandleActionResult | null => {
    const { type, payload } = action;
    const now = Date.now();
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const isMyTurn = myPlayerEnum === game.currentPlayer;

    switch(type) {
        case 'START_HIDDEN_PLACEMENT':
            if (!isMyTurn || game.gameStatus !== 'playing') return { error: "Not your turn to use an item." };
            game.gameStatus = 'hidden_placing';
            if(game.turnDeadline) {
                game.pausedTurnTimeLeft = (game.turnDeadline - now) / 1000;
            }
            game.turnDeadline = undefined;
            game.turnStartTime = undefined;
            game.itemUseDeadline = now + 30000;
            return {};
        case 'START_SCANNING':
            if (!isMyTurn || game.gameStatus !== 'playing') return { error: "Not your turn to use an item." };
            game.gameStatus = 'scanning';
             if(game.turnDeadline) {
                game.pausedTurnTimeLeft = (game.turnDeadline - now) / 1000;
            }
            game.turnDeadline = undefined;
            game.turnStartTime = undefined;
            game.itemUseDeadline = now + 30000;
            return {};
        case 'SCAN_BOARD':
            if (game.gameStatus !== 'scanning') return { error: "Not in scanning mode." };
            const { x, y } = payload;
            const scanKey = user.id === game.player1.id ? 'scans_p1' : 'scans_p2';
            if ((game[scanKey] ?? 0) <= 0) return { error: "No scans left." };
            game[scanKey] = (game[scanKey] ?? 0) - 1;

            const moveIndex = game.moveHistory.findIndex(m => m.x === x && m.y === y);
            const success = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];

            if (success) {
                if (!game.revealedHiddenMoves) game.revealedHiddenMoves = {};
                if (!game.revealedHiddenMoves[user.id]) game.revealedHiddenMoves[user.id] = [];
                if (!game.revealedHiddenMoves[user.id].includes(moveIndex)) {
                    game.revealedHiddenMoves[user.id].push(moveIndex);
                }
            }
            game.animation = { type: 'scan', point: { x, y }, success, startTime: now, duration: 2000, playerId: user.id };
            game.gameStatus = 'scanning_animating';

            // After using the item, restore my time, reset timers and KEEP THE TURN
            if (game.pausedTurnTimeLeft) {
                if (myPlayerEnum === types.Player.Black) {
                    game.blackTimeLeft = game.pausedTurnTimeLeft;
                } else {
                    game.whiteTimeLeft = game.pausedTurnTimeLeft;
                }
            }
            game.itemUseDeadline = undefined;
            game.pausedTurnTimeLeft = undefined;

            const currentPlayerTimeKey = myPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
            game.turnDeadline = now + game[currentPlayerTimeKey] * 1000;
            game.turnStartTime = now;
            
            // The `updateHiddenState` will transition from 'scanning_animating' to 'playing'
            // after the animation, but the timer is already correctly running for the current player.
            return {};
    }

    return null;
}
