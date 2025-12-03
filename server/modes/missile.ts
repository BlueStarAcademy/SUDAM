
import * as types from '../../types/index.js';
import { getGoLogic } from '../goLogic.js';
import { pauseGameTimer, resumeGameTimer } from './shared.js';

type HandleActionResult = types.HandleActionResult;

export const initializeMissile = (game: types.LiveGameSession) => {
    const isMissileMode = game.mode === types.GameMode.Missile || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Missile));
    if (isMissileMode) {
        game.missiles_p1 = game.settings.missileCount;
        game.missiles_p2 = game.settings.missileCount;
    }
};

/**
 * 미사일 경로 계산: 가장 먼 곳으로 이동
 * - 중간에 바둑돌이 있으면 그 앞에서 멈춤
 * - 상대방의 히든 돌은 통과
 * - 도착지점에 상대방의 히든 돌이 있으면 그 이전 자리로 이동
 */
function calculateMissilePath(
    game: types.LiveGameSession,
    from: types.Point,
    direction: 'up' | 'down' | 'left' | 'right',
    myPlayerEnum: types.Player
): { to: types.Point; revealedHiddenStone: types.Point | null } {
    const boardSize = game.settings.boardSize;
    const opponentEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
    
    // 방향 벡터 계산
    const dir: types.Point = { x: 0, y: 0 };
    if (direction === 'up') dir.y = -1;
    else if (direction === 'down') dir.y = 1;
    else if (direction === 'left') dir.x = -1;
    else if (direction === 'right') dir.x = 1;
    
    let current = { ...from };
    let revealedHiddenStone: types.Point | null = null;
    
    // 경로를 따라 이동하면서 확인
    while (true) {
        const next = { x: current.x + dir.x, y: current.y + dir.y };
        
        // 보드 범위를 벗어나면 멈춤
        if (next.x < 0 || next.x >= boardSize || next.y < 0 || next.y >= boardSize) {
            break;
        }
        
        const stoneAtNext = game.boardState[next.y]?.[next.x];
        
        // 빈 칸이면 계속 이동
        if (stoneAtNext === types.Player.None) {
            current = next;
            continue;
        }
        
        // 내 돌이면 멈춤
        if (stoneAtNext === myPlayerEnum) {
            break;
        }
        
        // 상대방 돌인 경우
        if (stoneAtNext === opponentEnum) {
            // 히든 돌인지 확인
            const moveIndex = game.moveHistory.findIndex(m => m.x === next.x && m.y === next.y);
            const isHiddenStone = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
            const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === next.x && p.y === next.y);
            
            // 히든 돌이고 아직 공개되지 않았으면 통과
            if (isHiddenStone && !isPermanentlyRevealed) {
                current = next;
                continue;
            }
            
            // 공개된 돌이면 멈춤 (현재 위치에서 멈춤, next 위치로 가지 않음)
            break;
        }
        
        // 알 수 없는 플레이어 값이 있으면 멈춤 (안전장치)
        // 타입 단언을 사용하여 TypeScript 경고를 무시 (실제로는 런타임에 예상치 못한 값이 올 수 있음)
        const stoneValue = stoneAtNext as types.Player | undefined;
        if (stoneValue !== undefined && stoneValue !== types.Player.None && stoneValue !== myPlayerEnum && stoneValue !== opponentEnum) {
            break;
        }
    }
    
    // 도착지점에 상대방의 히든 돌이 있는지 확인
    const finalMoveIndex = game.moveHistory.findIndex(m => m.x === current.x && m.y === current.y);
    const finalStone = game.boardState[current.y]?.[current.x];
    const isFinalHiddenStone = 
        finalStone === opponentEnum &&
        finalMoveIndex !== -1 &&
        !!game.hiddenMoves?.[finalMoveIndex] &&
        !game.permanentlyRevealedStones?.some(p => p.x === current.x && p.y === current.y);
    
    if (isFinalHiddenStone) {
        // 히든 돌을 공개하고, 그 이전 자리로 이동
        revealedHiddenStone = { ...current };
        
        // 이전 자리로 이동 (방향 반대)
        const prev = { x: current.x - dir.x, y: current.y - dir.y };
        if (prev.x >= 0 && prev.x < boardSize && prev.y >= 0 && prev.y < boardSize) {
            current = prev;
        } else {
            // 이전 자리가 보드 밖이면 현재 자리에서 멈춤 (히든 돌은 공개됨)
            current = { ...from }; // 원래 자리로 돌아감
        }
    }
    
    return { to: current, revealedHiddenStone };
}

export const updateMissileState = (game: types.LiveGameSession, now: number): boolean => {
    // 아이템 사용 시간 초과 처리
    if (game.gameStatus === 'missile_selecting' && game.itemUseDeadline && now > game.itemUseDeadline) {
        const timedOutPlayerEnum = game.currentPlayer;
        const timedOutPlayerId = timedOutPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
        
        console.log(`[Missile Go] Item use deadline expired for game ${game.id}, player ${timedOutPlayerId}, restoring game state`);
        
        game.foulInfo = { 
            message: `${game.player1.id === timedOutPlayerId ? game.player1.nickname : game.player2.nickname}님의 아이템 시간 초과!`, 
            expiry: now + 4000 
        };
        game.gameStatus = 'playing';
        
        // 미사일 아이템 소멸
        const missileKey = timedOutPlayerId === game.player1.id ? 'missiles_p1' : 'missiles_p2';
        const currentMissiles = game[missileKey] ?? 0;
        if (currentMissiles > 0) {
            game[missileKey] = currentMissiles - 1;
        }
        
        // 원래 경기 시간 복원 (턴 유지)
        resumeGameTimer(game, now, timedOutPlayerEnum);
        return true; // 게임 상태가 변경되었음을 반환
    }
    
    // 애니메이션 처리
    if (game.gameStatus === 'missile_animating') {
            // animation이 null인데 gameStatus가 여전히 missile_animating인 경우 정리
            if (!game.animation) {
                console.warn(`[updateMissileState] Game ${game.id} has missile_animating status but no animation, cleaning up...`);
                game.gameStatus = 'playing';
                const playerWhoMoved = game.currentPlayer;
                resumeGameTimer(game, now, playerWhoMoved);
                return true;
            }
        
        // 미사일 애니메이션인 경우에만 처리
        const anim = game.animation;
        if (anim && (anim!.type === 'missile' || anim!.type === 'hidden_missile')) {
            // TypeScript가 타입 가드를 인식하지 못하므로 명시적으로 타입 단언
            const animNonNull = anim!;
            const elapsed = now - animNonNull.startTime;
            const duration = animNonNull.duration;
            const animationStartTime = animNonNull.startTime;
            
            // 이미 처리된 애니메이션인지 확인 (중복 처리 방지)
            const lastProcessedAnimationTime = (game as any).lastProcessedMissileAnimationTime;
            if (lastProcessedAnimationTime === animationStartTime) {
                // 이미 처리된 애니메이션 - 즉시 정리하고 반환
                game.animation = null;
                game.gameStatus = 'playing';
                return false;
            }
            
            // 애니메이션이 종료되었는지 확인 (정상 종료: elapsed >= duration)
            if (elapsed >= duration) {
                // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                // 애니메이션 정보를 먼저 저장 (null 설정 전에)
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (game.animation as any).from as types.Point | undefined;
                const animationTo = (game.animation as any).to as types.Point | undefined;
                const revealedHiddenStone = (game.animation as any).revealedHiddenStone as types.Point | null | undefined;
                
                // 애니메이션 제거
                game.animation = null;
                
                // 게임 상태를 playing으로 변경
                game.gameStatus = 'playing';
                
                // 히든 돌 공개 처리
                if (revealedHiddenStone) {
                    const rs = revealedHiddenStone!;
                    const moveIndex = game.moveHistory.findIndex(m => m.x === rs.x && m.y === rs.y);
                    if (moveIndex !== -1) {
                        // permanentlyRevealedStones에 추가
                        if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
                        if (!game.permanentlyRevealedStones!.some(p => p.x === rs.x && p.y === rs.y)) {
                            game.permanentlyRevealedStones!.push({ x: rs.x, y: rs.y });
                        }
                    }
                }
                
                // 보드 상태 변경: 기존 자리의 돌 삭제, 이동된 자리에 돌 배치
                if (animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    const stoneAtFrom = game.boardState[af.y]?.[af.x];
                    if (stoneAtFrom === playerWhoMoved) {
                        game.boardState[af.y][af.x] = types.Player.None;
                    }
                    game.boardState[at.y][at.x] = playerWhoMoved;
                }
                
                // 배치돌 업데이트
                if (game.baseStones && animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    const baseStoneIndex = game.baseStones!.findIndex(bs => bs.x === af.x && bs.y === af.y);
                    if (baseStoneIndex !== -1) {
                        game.baseStones![baseStoneIndex].x = at.x;
                        game.baseStones![baseStoneIndex].y = at.y;
                    }
                }
                
                // 싱글플레이에서 baseStones_p1, baseStones_p2도 확인
                if (animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    const playerId = playerWhoMoved === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                    const baseStonesKey = playerId === game.player1.id ? 'baseStones_p1' : 'baseStones_p2';
                    const baseStonesArray = (game as any)[baseStonesKey] as types.Point[] | undefined;
                    if (baseStonesArray) {
                        const baseStoneIndex = baseStonesArray!.findIndex(bs => bs.x === af.x && bs.y === af.y);
                        if (baseStoneIndex !== -1) {
                            baseStonesArray![baseStoneIndex].x = at.x;
                            baseStonesArray![baseStoneIndex].y = at.y;
                        }
                    }
                }
                
                // moveHistory 업데이트
                if (animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    let moveIndexToUpdate = -1;
                    for (let i = game.moveHistory.length - 1; i >= 0; i--) {
                        const move = game.moveHistory[i];
                        if (move.x === af.x && move.y === af.y) {
                            if (game.boardState[at.y]?.[at.x] === move.player) {
                                moveIndexToUpdate = i;
                                break;
                            }
                        }
                    }
                    if (moveIndexToUpdate !== -1) {
                        game.moveHistory[moveIndexToUpdate].x = at.x;
                        game.moveHistory[moveIndexToUpdate].y = at.y;
                    }
                }
                
                // 타이머 복원 및 재개 (턴 유지)
                resumeGameTimer(game, now, playerWhoMoved);
                
                return true;
            }
            
            // 애니메이션이 이미 종료되었어야 하는 경우 즉시 정리 (DB에서 다시 읽혀서 이전 상태로 돌아온 경우 대비)
            if (elapsed > duration + 1000) {
                // 처리된 애니메이션의 startTime을 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                console.warn(`[updateMissileState] Game ${game.id} animation should have ended (elapsed=${elapsed}ms, duration=${duration}ms), forcing cleanup...`);
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (game.animation as any).from as types.Point | undefined;
                const animationTo = (game.animation as any).to as types.Point | undefined;
                const revealedHiddenStone = (game.animation as any).revealedHiddenStone as types.Point | null | undefined;
                
                // 히든 돌 공개 처리
                if (revealedHiddenStone) {
                    const rs = revealedHiddenStone!;
                    const moveIndex = game.moveHistory.findIndex(m => m.x === rs.x && m.y === rs.y);
                    if (moveIndex !== -1) {
                        if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
                        if (!game.permanentlyRevealedStones!.some(p => p.x === rs.x && p.y === rs.y)) {
                            game.permanentlyRevealedStones!.push({ x: rs.x, y: rs.y });
                        }
                    }
                }
                
                // 보드 상태 정리
                if (animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    const stoneAtFrom = game.boardState[af.y]?.[af.x];
                    if (stoneAtFrom === playerWhoMoved) {
                        game.boardState[af.y][af.x] = types.Player.None;
                    }
                    game.boardState[at.y][at.x] = playerWhoMoved;
                }
                
                game.animation = null;
                game.gameStatus = 'playing';
                
                // 타이머 복원
                if (game.pausedTurnTimeLeft !== undefined) {
                    if (playerWhoMoved === types.Player.Black) {
                        game.blackTimeLeft = game.pausedTurnTimeLeft ?? 0;
                    } else {
                        game.whiteTimeLeft = game.pausedTurnTimeLeft ?? 0;
                    }
                    if (game.settings.timeLimit > 0) {
                        const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                        const timeLeft = (game[currentPlayerTimeKey] ?? 0) as number;
                        if (timeLeft > 0) {
                            game.turnDeadline = now + timeLeft * 1000;
                            game.turnStartTime = now;
                        } else {
                            game.turnDeadline = undefined;
                            game.turnStartTime = undefined;
                        }
                    } else {
                        game.turnDeadline = undefined;
                        game.turnStartTime = undefined;
                    }
                    game.pausedTurnTimeLeft = undefined;
                }
                game.itemUseDeadline = undefined;
                return true;
            }
            
            // 애니메이션이 아직 진행 중인 경우 (아무것도 하지 않음)
            // 애니메이션이 너무 오래 지속된 경우 강제로 정리 (서버 재시작 등으로 인한 문제 방지)
            const MAX_ANIMATION_DURATION = 10000; // 10초
            if (elapsed > MAX_ANIMATION_DURATION) {
                // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                console.warn(`[updateMissileState] Game ${game.id} animation exceeded max duration (elapsed=${elapsed}ms), forcing cleanup...`);
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (game.animation as any).from as types.Point | undefined;
                const animationTo = (game.animation as any).to as types.Point | undefined;
                const revealedHiddenStone = (game.animation as any).revealedHiddenStone as types.Point | null | undefined;
                
                // 히든 돌 공개 처리
                if (revealedHiddenStone) {
                    const rs = revealedHiddenStone!;
                    const moveIndex = game.moveHistory.findIndex(m => m.x === rs.x && m.y === rs.y);
                    if (moveIndex !== -1) {
                        if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
                        if (!game.permanentlyRevealedStones!.some(p => p.x === rs.x && p.y === rs.y)) {
                            game.permanentlyRevealedStones!.push({ x: rs.x, y: rs.y });
                        }
                    }
                }
                
                // 보드 상태 정리
                if (animationFrom && animationTo) {
                    const af = animationFrom!;
                    const at = animationTo!;
                    const stoneAtFrom = game.boardState[af.y]?.[af.x];
                    if (stoneAtFrom === playerWhoMoved) {
                        game.boardState[af.y][af.x] = types.Player.None;
                    }
                    game.boardState[at.y][at.x] = playerWhoMoved;
                }
                
                game.animation = null;
                game.gameStatus = 'playing';
                
                // 타이머 복원
                if (game.pausedTurnTimeLeft !== undefined) {
                    if (playerWhoMoved === types.Player.Black) {
                        game.blackTimeLeft = game.pausedTurnTimeLeft ?? 0;
                    } else {
                        game.whiteTimeLeft = game.pausedTurnTimeLeft ?? 0;
                    }
                    if (game.settings.timeLimit > 0) {
                        const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                        const timeLeft = (game[currentPlayerTimeKey] ?? 0) as number;
                        if (timeLeft > 0) {
                            game.turnDeadline = now + timeLeft * 1000;
                            game.turnStartTime = now;
                        } else {
                            game.turnDeadline = undefined;
                            game.turnStartTime = undefined;
                        }
                    } else {
                        game.turnDeadline = undefined;
                        game.turnStartTime = undefined;
                    }
                    game.pausedTurnTimeLeft = undefined;
                }
                game.itemUseDeadline = undefined;
                return true;
            }
            
            // 애니메이션이 아직 진행 중인 경우 (elapsed < duration && elapsed <= duration + 1000 && elapsed <= MAX_ANIMATION_DURATION)
            // 아무것도 하지 않고 false 반환 (게임 상태 변경 없음)
            return false;
        } else {
            // 미사일 애니메이션이 아닌 경우, 상태가 잘못된 것일 수 있음
            if (game.animation) {
                console.warn(`[updateMissileState] Game ${game.id} has missile_animating status but animation type is ${game.animation!.type}, cleaning up...`);
            }
            game.animation = null;
            game.gameStatus = 'playing';
            return true;
        }
    }
    
    // 게임 상태가 변경되지 않았음을 반환
    return false;
};

export const handleMissileAction = (game: types.LiveGameSession, action: types.ServerAction & { userId: string }, user: types.User): HandleActionResult | null => {
    const { type, payload } = action;
    const now = Date.now();
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const isMyTurn = myPlayerEnum === game.currentPlayer;

    switch (type) {
        case 'START_MISSILE_SELECTION': {
            if (!isMyTurn || game.gameStatus !== 'playing') {
                console.warn(`[Missile Go] START_MISSILE_SELECTION failed: isMyTurn=${isMyTurn}, gameStatus=${game.gameStatus}, gameId=${game.id}`);
                return { error: "Not your turn to use an item." };
            }
            
            // 미사일 아이템 개수 확인 (인벤토리에서 확인)
            // TODO: 인벤토리에서 미사일 아이템 개수 확인 로직 추가 필요
            // 현재는 게임 모드의 미사일 개수로 확인
            const missileKey = user.id === game.player1.id ? 'missiles_p1' : 'missiles_p2';
            const myMissilesLeft = game[missileKey] ?? game.settings.missileCount ?? 0;
            if (myMissilesLeft <= 0) {
                console.warn(`[Missile Go] START_MISSILE_SELECTION failed: no missiles left, gameId=${game.id}`);
                return { error: "No missiles left." };
            }
            
            // 게임 상태를 missile_selecting으로 변경
            game.gameStatus = 'missile_selecting';
            
            // 원래 경기 시간 일시 정지 및 아이템 사용 시간 부여
            pauseGameTimer(game, now, 30000);
            
            console.log(`[Missile Go] START_MISSILE_SELECTION: gameStatus changed to missile_selecting, gameId=${game.id}`);
            return { clientResponse: { gameUpdated: true } };
        }
        
        case 'LAUNCH_MISSILE': {
            if (game.gameStatus !== 'missile_selecting') {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: gameStatus=${game.gameStatus}, expected=missile_selecting, gameId=${game.id}`);
                return { error: "Not in missile selection mode." };
            }
            
            // 아이템 사용 시간 확인
            if (game.itemUseDeadline && now > game.itemUseDeadline) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: item use time expired, gameId=${game.id}`);
                return { error: "Item use time expired." };
            }
            
            // 이미 애니메이션이 진행 중인 경우 무시 (중복 방지)
            if (game.animation) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: animation already exists, gameId=${game.id}`);
                return { error: "Animation already in progress." };
            }
            
            const { from, direction } = payload;
            const clientBoardState = (payload as any).boardState;
            const clientMoveHistory = (payload as any).moveHistory;
            if (!from || !direction) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: missing from or direction, payload=${JSON.stringify(payload)}, gameId=${game.id}`);
                return { error: "Invalid payload: missing from or direction." };
            }
            
            if (from.x < 0 || from.x >= game.settings.boardSize || from.y < 0 || from.y >= game.settings.boardSize) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: invalid from coordinates, from=${JSON.stringify(from)}, boardSize=${game.settings.boardSize}, gameId=${game.id}`);
                return { error: "Invalid stone position." };
            }
            
            // 클라이언트에서 보낸 boardState를 우선적으로 사용 (더 최신 상태일 수 있음)
            const boardStateToUse = (clientBoardState && Array.isArray(clientBoardState) && clientBoardState.length > 0) 
                ? clientBoardState 
                : game.boardState;
            const moveHistoryToUse = (clientMoveHistory && Array.isArray(clientMoveHistory) && clientMoveHistory.length > 0)
                ? clientMoveHistory
                : game.moveHistory;
            
            // 클라이언트의 boardState를 서버의 boardState에 반영 (동기화)
            if (clientBoardState && Array.isArray(clientBoardState) && clientBoardState.length > 0) {
                console.log(`[Missile Go] LAUNCH_MISSILE: using client boardState for validation, gameId=${game.id}`);
                game.boardState = clientBoardState;
            }
            if (clientMoveHistory && Array.isArray(clientMoveHistory) && clientMoveHistory.length > 0) {
                console.log(`[Missile Go] LAUNCH_MISSILE: using client moveHistory for validation, gameId=${game.id}`);
                game.moveHistory = clientMoveHistory;
            }
            
            // 미사일 바둑에서는 boardState와 moveHistory를 모두 확인
            // (새로 놓은 돌이 boardState에 아직 반영되지 않았을 수 있음)
            const stoneAtFrom = boardStateToUse[from.y]?.[from.x];
            const moveAtFrom = moveHistoryToUse.find(m => m.x === from.x && m.y === from.y && m.player === myPlayerEnum);
            const isMyStone = stoneAtFrom === myPlayerEnum || !!moveAtFrom;
            
            if (!isMyStone) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: not your stone, from=${JSON.stringify(from)}, stoneAtFrom=${stoneAtFrom}, myPlayerEnum=${myPlayerEnum}, hasMoveHistory=${!!moveAtFrom}, gameId=${game.id}`);
                return { error: "Not your stone." };
            }
            
            // moveHistory에는 있지만 boardState에 반영되지 않은 경우 boardState 업데이트
            if (moveAtFrom && stoneAtFrom !== myPlayerEnum) {
                console.log(`[Missile Go] LAUNCH_MISSILE: updating boardState for newly placed stone, from=${JSON.stringify(from)}, gameId=${game.id}`);
                game.boardState[from.y][from.x] = myPlayerEnum;
            }
            
            // 미사일 경로 계산 (클라이언트의 boardState와 moveHistory를 사용)
            // 클라이언트의 boardState를 서버에 반영한 상태로 경로 계산
            const { to, revealedHiddenStone } = calculateMissilePath(game, from, direction, myPlayerEnum);
            
            if (to.x === from.x && to.y === from.y) {
                console.warn(`[Missile Go] LAUNCH_MISSILE failed: cannot move stone, from=${JSON.stringify(from)}, to=${JSON.stringify(to)}, direction=${direction}, gameId=${game.id}`);
                return { error: "Cannot move stone." };
            }
            
            // 히든 돌 공개 처리 (목적지에 히든 돌이 있는 경우)
            if (revealedHiddenStone) {
                const moveIndex = game.moveHistory.findIndex(m => m.x === revealedHiddenStone.x && m.y === revealedHiddenStone.y);
                if (moveIndex !== -1) {
                    // permanentlyRevealedStones에 추가
                    if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
                    if (!game.permanentlyRevealedStones.some(p => p.x === revealedHiddenStone.x && p.y === revealedHiddenStone.y)) {
                        game.permanentlyRevealedStones.push({ x: revealedHiddenStone.x, y: revealedHiddenStone.y });
                    }
                }
            }
            
            // 목적지에 이미 상대방 돌이 있는지 확인 (덮어씌우기 방지)
            const stoneAtTo = game.boardState[to.y]?.[to.x];
            const opponentEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
            const moveAtTo = game.moveHistory.find(m => m.x === to.x && m.y === to.y);
            const isOpponentMoveAtTo = moveAtTo && moveAtTo.player === opponentEnum;
            
            // boardState에 상대방 돌이 있거나, moveHistory에 상대방 돌이 있는 경우 확인
            if (stoneAtTo === opponentEnum || isOpponentMoveAtTo) {
                // 상대방 돌이 있는 경우, 히든 돌이 아닌지 확인
                const moveIndexAtTo = game.moveHistory.findIndex(m => m.x === to.x && m.y === to.y);
                const isHiddenStoneAtTo = moveIndexAtTo !== -1 && !!game.hiddenMoves?.[moveIndexAtTo];
                const isPermanentlyRevealedAtTo = game.permanentlyRevealedStones?.some(p => p.x === to.x && p.y === to.y);
                
                // 히든 돌이 아니거나 이미 공개된 돌이면 에러 반환
                if (!isHiddenStoneAtTo || isPermanentlyRevealedAtTo) {
                    console.warn(`[Missile Go] LAUNCH_MISSILE failed: destination has opponent stone, to=${JSON.stringify(to)}, stoneAtTo=${stoneAtTo}, isOpponentMoveAtTo=${isOpponentMoveAtTo}, gameId=${game.id}`);
                    return { error: "Cannot move to a position occupied by opponent stone." };
                }
            }
            
            // 보드 상태 변경: 목적지에 돌을 먼저 배치 (예전 방식 복원)
            // 원래 자리의 돌은 아직 유지 (애니메이션 중에는 두 곳에 모두 보임)
            game.boardState[to.y][to.x] = myPlayerEnum;
            
            // 배치돌 업데이트 (목적지에 배치)
            if (game.baseStones) {
                const baseStoneIndex = game.baseStones.findIndex(bs => bs.x === from.x && bs.y === from.y);
                if (baseStoneIndex !== -1) {
                    // 목적지에 배치돌 복사 (원래 자리는 아직 유지)
                    game.baseStones.push({ x: to.x, y: to.y, player: myPlayerEnum });
                }
            }
            
            // 싱글플레이에서 baseStones_p1, baseStones_p2도 확인
            const playerId = myPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
            const baseStonesKey = playerId === game.player1.id ? 'baseStones_p1' : 'baseStones_p2';
            const baseStonesArray = (game as any)[baseStonesKey] as types.Point[] | undefined;
            if (baseStonesArray) {
                const baseStoneIndex = baseStonesArray.findIndex(bs => bs.x === from.x && bs.y === from.y);
                if (baseStoneIndex !== -1) {
                    // 목적지에 배치돌 복사 (원래 자리는 아직 유지)
                    baseStonesArray.push({ x: to.x, y: to.y });
                }
            }
            
            // moveHistory에 새 이동 추가 (목적지에)
            game.moveHistory.push({
                x: to.x,
                y: to.y,
                player: myPlayerEnum
            });
            
            // 아이템 사용 시간 일시 정지 (애니메이션 중)
            game.itemUseDeadline = undefined;
            
            // 턴 시간 복원 (애니메이션 중에도 턴이 유지되도록)
            if (game.settings.timeLimit > 0 && game.pausedTurnTimeLeft !== undefined) {
                const currentPlayerTimeKey = myPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                game[currentPlayerTimeKey] = game.pausedTurnTimeLeft;
                game.turnDeadline = now + game.pausedTurnTimeLeft * 1000;
                game.turnStartTime = now;
            }
            
            // 애니메이션 설정 (2초)
            // 새로운 애니메이션 시작 시 이전 처리 기록 초기화
            (game as any).lastProcessedMissileAnimationTime = undefined;
            
            const animationData: any = {
                type: revealedHiddenStone ? 'hidden_missile' : 'missile',
                from,
                to,
                player: myPlayerEnum,
                startTime: now,
                duration: 2000
            };
            
            if (revealedHiddenStone) {
                animationData.revealedHiddenStone = revealedHiddenStone;
            }
            
            game.animation = animationData;
            game.gameStatus = 'missile_animating';
            
            // 미사일 아이템 개수 감소
            const missileKey = user.id === game.player1.id ? 'missiles_p1' : 'missiles_p2';
            game[missileKey] = (game[missileKey] ?? 0) - 1;
            
            // 미사일 아이템은 턴을 사용하는 행동이 아니므로 totalTurns를 증가시키지 않음
            
            return {};
        }
        
        case 'MISSILE_INVALID_SELECTION': {
            if (game.gameStatus !== 'missile_selecting') {
                return { error: "Not in missile selection mode." };
            }
            game.foulInfo = { message: '움직일 수 없는 돌입니다.', expiry: now + 4000 };
            return {};
        }
        
        case 'CANCEL_MISSILE_SELECTION': {
            // 아이템 사용은 취소할 수 없음
            return { error: "아이템 사용은 취소할 수 없습니다." };
        }
        
        case 'MISSILE_ANIMATION_COMPLETE' as any: {
            // 클라이언트가 애니메이션 완료를 알림 (모든 게임 모드에서 사용)
            // 게임 상태가 이미 playing으로 변경되었거나 애니메이션이 없는 경우에도 처리 (이미 완료된 경우 대비)
            if (game.gameStatus !== 'missile_animating' && game.gameStatus !== 'playing') {
                console.warn(`[Missile Go] MISSILE_ANIMATION_COMPLETE failed: gameStatus=${game.gameStatus}, expected=missile_animating or playing, gameId=${game.id}`);
                return { error: "Not in missile animation state." };
            }
            
            // 애니메이션이 이미 완료되었거나 없는 경우, 게임 상태만 확인하고 정리
            if (!game.animation || (game.animation.type !== 'missile' && game.animation.type !== 'hidden_missile')) {
                // 애니메이션이 없는데 게임 상태가 missile_animating인 경우 정리
                if (game.gameStatus === 'missile_animating') {
                    console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: cleaning up stuck missile_animating state, gameId=${game.id}`);
                    game.gameStatus = 'playing';
                    const playerWhoMoved = game.currentPlayer;
                    if (game.pausedTurnTimeLeft !== undefined) {
                        if (playerWhoMoved === types.Player.Black) {
                            game.blackTimeLeft = game.pausedTurnTimeLeft;
                        } else {
                            game.whiteTimeLeft = game.pausedTurnTimeLeft;
                        }
                    }
                    if (game.settings.timeLimit > 0) {
                        const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                        const timeLeft = game[currentPlayerTimeKey] ?? 0;
                        if (timeLeft > 0) {
                            game.turnDeadline = now + timeLeft * 1000;
                            game.turnStartTime = now;
                        } else {
                            game.turnDeadline = undefined;
                            game.turnStartTime = undefined;
                        }
                    } else {
                        game.turnDeadline = undefined;
                        game.turnStartTime = undefined;
                    }
                    game.pausedTurnTimeLeft = undefined;
                    game.itemUseDeadline = undefined;
                    console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: cleaned up stuck state, gameId=${game.id}, gameStatus=${game.gameStatus}`);
                    return { clientResponse: { gameUpdated: true } };
                }
                // 이미 완료된 경우 성공으로 반환
                console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: animation already completed, gameId=${game.id}`);
                return { clientResponse: { gameUpdated: true } };
            }
            
            // updateMissileState의 애니메이션 완료 로직을 직접 실행
            const animationStartTime = game.animation.startTime;
            const lastProcessedAnimationTime = (game as any).lastProcessedMissileAnimationTime;
            
            // 이미 처리된 애니메이션인지 확인
            if (lastProcessedAnimationTime === animationStartTime) {
                console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: animation already processed, gameId=${game.id}`);
                // 이미 처리되었어도 게임 상태가 여전히 missile_animating이면 정리
                if (game.gameStatus === 'missile_animating') {
                    console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: gameStatus still missile_animating after processing, cleaning up, gameId=${game.id}`);
                    game.gameStatus = 'playing';
                    game.animation = null;
                    return { clientResponse: { gameUpdated: true } };
                }
                return { clientResponse: { gameUpdated: true } };
            }
            
            // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
            (game as any).lastProcessedMissileAnimationTime = animationStartTime;
            
            // 애니메이션 정보를 먼저 저장 (null 설정 전에)
            const playerWhoMoved = game.currentPlayer;
            const animationFrom = game.animation.from;
            const animationTo = game.animation.to;
            const revealedHiddenStone = (game.animation as any).revealedHiddenStone as types.Point | null | undefined;
            
            // 애니메이션 제거
            game.animation = null;
            
            // 게임 상태를 playing으로 변경
            game.gameStatus = 'playing';
            
            // 예전 방식: 애니메이션이 끝나면 원래 자리의 돌만 제거
            // (목적지의 돌은 이미 LAUNCH_MISSILE에서 배치되었으므로 그대로 유지)
            if (animationFrom && animationTo) {
                const stoneAtFrom = game.boardState[animationFrom.y]?.[animationFrom.x];
                // 원래 자리의 돌 제거 (목적지의 돌은 이미 배치되어 있음)
                if (stoneAtFrom === playerWhoMoved) {
                    game.boardState[animationFrom.y][animationFrom.x] = types.Player.None;
                }
                
                // 배치돌 업데이트: 원래 자리의 배치돌 제거
                if (game.baseStones) {
                    const baseStoneIndex = game.baseStones.findIndex(bs => bs.x === animationFrom.x && bs.y === animationFrom.y);
                    if (baseStoneIndex !== -1) {
                        game.baseStones.splice(baseStoneIndex, 1);
                    }
                }
                
                // 싱글플레이에서 baseStones_p1, baseStones_p2도 확인
                const playerId = playerWhoMoved === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
                const baseStonesKey = playerId === game.player1.id ? 'baseStones_p1' : 'baseStones_p2';
                const baseStonesArray = (game as any)[baseStonesKey] as types.Point[] | undefined;
                if (baseStonesArray) {
                    const baseStoneIndex = baseStonesArray.findIndex(bs => bs.x === animationFrom.x && bs.y === animationFrom.y);
                    if (baseStoneIndex !== -1) {
                        baseStonesArray.splice(baseStoneIndex, 1);
                    }
                }
                
                // moveHistory에서 원래 자리의 이동 기록 제거 (목적지의 이동 기록은 이미 추가됨)
                const fromMoveIndex = game.moveHistory.findIndex(m => m.x === animationFrom.x && m.y === animationFrom.y && m.player === playerWhoMoved);
                if (fromMoveIndex !== -1) {
                    // 원래 자리의 이동 기록 제거 (목적지의 이동 기록은 유지)
                    game.moveHistory.splice(fromMoveIndex, 1);
                }
            }
            
            // 타이머 복원 (아이템 사용 시간이 마감되고 원래 턴 시간으로 복귀)
            if (game.pausedTurnTimeLeft !== undefined) {
                if (playerWhoMoved === types.Player.Black) {
                    game.blackTimeLeft = game.pausedTurnTimeLeft;
                } else {
                    game.whiteTimeLeft = game.pausedTurnTimeLeft;
                }
            }
            
            // 타이머 재개 (턴 유지)
            if (game.settings.timeLimit > 0) {
                const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                const timeLeft = game[currentPlayerTimeKey] ?? 0;
                if (timeLeft > 0) {
                    game.turnDeadline = now + timeLeft * 1000;
                    game.turnStartTime = now;
                } else {
                    game.turnDeadline = undefined;
                    game.turnStartTime = undefined;
                }
            } else {
                game.turnDeadline = undefined;
                game.turnStartTime = undefined;
            }
            
            game.pausedTurnTimeLeft = undefined;
            game.itemUseDeadline = undefined;
            
            console.log(`[Missile Go] MISSILE_ANIMATION_COMPLETE: animation completed, gameId=${game.id}, gameStatus=${game.gameStatus}`);
            // 게임 상태가 변경되었으므로 반드시 저장하고 브로드캐스트해야 함을 표시
            return { clientResponse: { gameUpdated: true } };
        }
    }
    
    return null;
};
