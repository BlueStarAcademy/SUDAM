import * as types from '../../types/index.js';
import * as db from '../db.js';

type HandleActionResult = types.HandleActionResult;

export const initializeSinglePlayerMissile = (game: types.LiveGameSession) => {
    const isMissileMode = game.mode === types.GameMode.Missile || (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Missile));
    if (isMissileMode && game.isSinglePlayer) {
        game.missiles_p1 = game.settings.missileCount;
        game.missiles_p2 = game.settings.missileCount;
    }
};

/**
 * 싱글플레이용 미사일 경로 계산: 가장 먼 곳으로 이동
 * - 중간에 바둑돌이 있으면 그 앞에서 멈춤
 * - 상대방의 히든 돌은 통과
 * - 도착지점에 상대방의 히든 돌이 있으면 그 이전 자리로 이동
 */
function calculateSinglePlayerMissilePath(
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
        
        // 싱글플레이어 모드에서는 moveHistory도 확인하여 AI가 착점한 돌을 감지
        const moveAtNext = game.moveHistory.find(m => m.x === next.x && m.y === next.y);
        const isOpponentMoveAtNext = moveAtNext && moveAtNext.player === opponentEnum;
        
        // 빈 칸이면 계속 이동 (단, moveHistory에 상대방 돌이 있으면 멈춤)
        if (stoneAtNext === types.Player.None) {
            // moveHistory에 상대방 돌이 있으면 멈춤 (AI가 착점했지만 boardState에 반영되지 않은 경우)
            if (isOpponentMoveAtNext) {
                // 히든 돌인지 확인
                const moveIndex = game.moveHistory.findIndex(m => m.x === next.x && m.y === next.y);
                const isHiddenStone = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
                const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === next.x && p.y === next.y);
                
                // 히든 돌이고 아직 공개되지 않았으면 통과
                if (isHiddenStone && !isPermanentlyRevealed) {
                    current = next;
                    continue;
                }
                
                // 공개된 돌이면 멈춤 (AI가 착점한 돌이므로)
                break;
            }
            current = next;
            continue;
        }
        
        // 내 돌이면 멈춤 (현재 위치에서 멈춤, next 위치로 가지 않음)
        // 싱글플레이에서는 moveHistory도 확인하여 유저가 직접 착수한 돌도 체크
        if (stoneAtNext === myPlayerEnum) {
            // moveHistory에서도 확인 (유저가 직접 착수한 돌인지 확인)
            const moveIndexAtNext = game.moveHistory.findIndex(m => m.x === next.x && m.y === next.y && m.player === myPlayerEnum);
            // 내 돌이면 멈춤 (배치돌이든 유저가 직접 착수한 돌이든 상관없이)
            // 단, current가 아직 from 위치라면 (즉, 한 칸도 이동하지 못했다면) 
            // 이는 이동 불가능한 상태이므로 break
            if (current.x === from.x && current.y === from.y) {
                // 한 칸도 이동하지 못했으므로 이동 불가능
                break;
            }
            // 이미 한 칸 이상 이동했다면 현재 위치에서 멈춤
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

export const updateSinglePlayerMissileState = async (game: types.LiveGameSession, now: number): Promise<boolean> => {
    // 싱글플레이 게임이 아니면 처리하지 않음
    if (!game.isSinglePlayer) {
        return false;
    }

    // 아이템 사용 시간 초과 처리
    if (game.gameStatus === 'missile_selecting' && game.itemUseDeadline && now > game.itemUseDeadline) {
        const timedOutPlayerEnum = game.currentPlayer;
        const timedOutPlayerId = timedOutPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
        
        console.log(`[SinglePlayer Missile] Item use deadline expired for game ${game.id}, player ${timedOutPlayerId}, restoring game state`);
        
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
    
    // 애니메이션 처리 - 최우선 처리
    if (game.gameStatus === 'missile_animating') {
        console.log(`[SinglePlayer Missile] updateSinglePlayerMissileState: Checking animation, gameId=${game.id}, animation=${game.animation ? 'exists' : 'null'}, now=${now}`);
            // animation이 null인데 gameStatus가 여전히 missile_animating인 경우 정리
            if (!game.animation) {
                console.warn(`[SinglePlayer Missile] Game ${game.id} has missile_animating status but no animation, cleaning up...`);
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
            
            // 강제 종료: 애니메이션이 시작된 지 3초가 지나면 무조건 종료
            if (elapsed > 3000) {
                console.warn(`[SinglePlayer Missile] FORCING animation end: elapsed=${elapsed}ms > 3000ms, gameId=${game.id}`);
                // 처리된 애니메이션의 startTime을 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (animNonNull as any).from as types.Point | undefined;
                const animationTo = (animNonNull as any).to as types.Point | undefined;
                const revealedHiddenStone = (animNonNull as any).revealedHiddenStone as types.Point | null | undefined;
                
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
                    // 싱글플레이 모드에서 목적지에 AI 돌이 있는지 확인
                    const opponentPlayer = playerWhoMoved === types.Player.Black ? types.Player.White : types.Player.Black;
                    const stoneAtTo = game.boardState[at.y]?.[at.x];
                    if (game.isSinglePlayer && stoneAtTo === opponentPlayer) {
                        console.error(`[SinglePlayer Missile] CRITICAL: Attempted to place stone on AI stone at (${at.x}, ${at.y}) during animation completion, gameId=${game.id}`);
                        // AI 돌 위에 덮어씌우지 않음
                        return false;
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
                console.log(`[SinglePlayer Missile] FORCED animation end, gameStatus=playing, gameId=${game.id}`);
                return true;
            }
            
            // 이미 처리된 애니메이션인지 확인 (중복 처리 방지)
            const lastProcessedAnimationTime = (game as any).lastProcessedMissileAnimationTime;
            if (lastProcessedAnimationTime === animationStartTime) {
                // 이미 처리된 애니메이션 - 게임 상태가 여전히 missile_animating이면 정리
                if (game.gameStatus === 'missile_animating') {
                    console.log(`[SinglePlayer Missile] Cleaning up already processed animation, gameId=${game.id}`);
                    game.animation = null;
                    game.gameStatus = 'playing';
                    // 타이머 복원
                    const playerWhoMoved = game.currentPlayer;
                    resumeGameTimer(game, now, playerWhoMoved);
                    return true; // 상태 변경이 있었으므로 true 반환
                }
                // 이미 playing 상태면 변경 없음
                return false;
            }
            
            // 애니메이션이 종료되었는지 확인 (정상 종료: elapsed >= duration)
            // 멀티플레이어와 동일하게 서버 루프에서 자동으로 처리
            // 더 빠른 종료를 위해 duration보다 조금만 지나도 종료 처리
            // 또는 애니메이션이 시작된 지 2.5초가 지나면 무조건 종료
            console.log(`[SinglePlayer Missile] Animation check: elapsed=${elapsed}ms, duration=${duration}ms, startTime=${animationStartTime}, now=${now}, gameId=${game.id}`);
            if (elapsed >= duration - 100 || elapsed >= 2500) { // 100ms 여유를 두고 조금 일찍 종료, 또는 2.5초 경과 시 무조건 종료
                console.log(`[SinglePlayer Missile] Animation should end: elapsed=${elapsed}ms >= duration-100=${duration-100}ms or elapsed >= 2500ms, gameId=${game.id}`);
                // 이미 처리된 애니메이션인지 확인 (중복 처리 방지)
                const lastProcessedAnimationTime = (game as any).lastProcessedMissileAnimationTime;
                if (lastProcessedAnimationTime === animationStartTime) {
                    // 이미 처리된 애니메이션 - 게임 상태가 여전히 missile_animating이면 정리
                    if (game.gameStatus === 'missile_animating') {
                        console.log(`[SinglePlayer Missile] Cleaning up already processed animation, gameId=${game.id}`);
                        game.animation = null;
                        game.gameStatus = 'playing';
                        // 타이머 복원
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
                        return true; // 상태 변경이 있었으므로 true 반환
                    }
                    return false; // 이미 처리되었고 상태도 playing이면 더 이상 변경 없음
                }
                
                // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                // totalTurns와 captures 보존 (애니메이션 완료 시 초기화 방지)
                const preservedTotalTurns = game.totalTurns;
                const preservedCaptures = { ...game.captures };
                const preservedBaseStoneCaptures = game.baseStoneCaptures ? { ...game.baseStoneCaptures } : undefined;
                const preservedHiddenStoneCaptures = game.hiddenStoneCaptures ? { ...game.hiddenStoneCaptures } : undefined;
                
                // 애니메이션 정보를 먼저 저장 (null 설정 전에)
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (animNonNull as any).from as types.Point | undefined;
                const animationTo = (animNonNull as any).to as types.Point | undefined;
                const revealedHiddenStone = (animNonNull as any).revealedHiddenStone as types.Point | null | undefined;
                
                // 애니메이션 제거
                game.animation = null;
                
                // 게임 상태를 playing으로 변경
                game.gameStatus = 'playing';
                
                // 히든 돌 공개 처리
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
                
                // 보드 상태는 이미 LAUNCH_MISSILE에서 변경되었으므로 여기서는 확인만
                // (LAUNCH_MISSILE에서 이미 원래 자리의 돌을 제거하고 목적지에 돌을 배치했음)
                if (animationFrom && animationTo) {
                    // 보드 상태 확인 (이미 변경되어 있어야 함)
                    const stoneAtTo = game.boardState[animationTo.y]?.[animationTo.x];
                    const stoneAtFrom = game.boardState[animationFrom.y]?.[animationFrom.x];
                    
                    // 보드 상태가 올바르지 않으면 수정 (단, 싱글플레이 모드에서 AI 돌 위에 덮어씌우지 않음)
                    if (stoneAtTo !== playerWhoMoved) {
                        const opponentPlayer = playerWhoMoved === types.Player.Black ? types.Player.White : types.Player.Black;
                        if (game.isSinglePlayer && stoneAtTo === opponentPlayer) {
                            console.error(`[SinglePlayer Missile] CRITICAL: Cannot fix board state - AI stone at (${animationTo.x}, ${animationTo.y}), gameId=${game.id}`);
                            // AI 돌 위에 덮어씌우지 않음
                        } else {
                            console.warn(`[SinglePlayer Missile] Board state mismatch at destination, fixing... gameId=${game.id}`);
                            game.boardState[animationTo.y][animationTo.x] = playerWhoMoved;
                        }
                    }
                    if (stoneAtFrom !== types.Player.None) {
                        console.warn(`[SinglePlayer Missile] Board state mismatch at source, fixing... gameId=${game.id}`);
                        game.boardState[animationFrom.y][animationFrom.x] = types.Player.None;
                    }
                }
                
                // 타이머 복원 (LAUNCH_MISSILE에서 이미 복원했으므로, 애니메이션 중 경과한 시간을 반영)
                if (game.settings.timeLimit > 0 && game.turnDeadline) {
                    // turnDeadline이 이미 설정되어 있으면, 경과한 시간을 반영하여 timeLeft 업데이트
                    const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                    const remainingTime = Math.max(0, (game.turnDeadline - now) / 1000);
                    game[currentPlayerTimeKey] = remainingTime;
                    // turnDeadline과 turnStartTime은 이미 설정되어 있으므로 그대로 유지
                } else if (game.pausedTurnTimeLeft !== undefined) {
                    // turnDeadline이 없으면 pausedTurnTimeLeft를 사용하여 복원
                    if (playerWhoMoved === types.Player.Black) {
                        game.blackTimeLeft = game.pausedTurnTimeLeft;
                    } else {
                        game.whiteTimeLeft = game.pausedTurnTimeLeft;
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
                    }
                } else {
                    game.turnDeadline = undefined;
                    game.turnStartTime = undefined;
                }
                
                game.pausedTurnTimeLeft = undefined;
                game.itemUseDeadline = undefined;
                
                // totalTurns와 captures 보존 확인 (애니메이션 완료 시 초기화 방지)
                if (game.totalTurns !== preservedTotalTurns) {
                    console.warn(`[SinglePlayer Missile] updateSinglePlayerMissileState: totalTurns changed from ${preservedTotalTurns} to ${game.totalTurns}, restoring...`);
                    game.totalTurns = preservedTotalTurns;
                }
                if (JSON.stringify(game.captures) !== JSON.stringify(preservedCaptures)) {
                    console.warn(`[SinglePlayer Missile] updateSinglePlayerMissileState: captures changed, restoring...`);
                    game.captures = preservedCaptures;
                }
                if (preservedBaseStoneCaptures && JSON.stringify(game.baseStoneCaptures) !== JSON.stringify(preservedBaseStoneCaptures)) {
                    console.warn(`[SinglePlayer Missile] updateSinglePlayerMissileState: baseStoneCaptures changed, restoring...`);
                    game.baseStoneCaptures = preservedBaseStoneCaptures;
                }
                if (preservedHiddenStoneCaptures && JSON.stringify(game.hiddenStoneCaptures) !== JSON.stringify(preservedHiddenStoneCaptures)) {
                    console.warn(`[SinglePlayer Missile] updateSinglePlayerMissileState: hiddenStoneCaptures changed, restoring...`);
                    game.hiddenStoneCaptures = preservedHiddenStoneCaptures;
                }
                
                console.log(`[SinglePlayer Missile] Animation completed, gameStatus changed to playing: gameId=${game.id}, playerWhoMoved=${playerWhoMoved === types.Player.Black ? 'Black' : 'White'}, from=(${animationFrom?.x},${animationFrom?.y}), to=(${animationTo?.x},${animationTo?.y}), totalTurns=${preservedTotalTurns}, captures=${JSON.stringify(preservedCaptures)}`);
                
                // 게임 캐시 업데이트 (다음 미사일 아이템 사용 시 게임을 찾을 수 있도록)
                const { updateGameCache } = await import('../gameCache.js');
                updateGameCache(game);
                // 애니메이션 종료 후 즉시 브로드캐스트 (싱글플레이에서는 서버 루프에서 브로드캐스트하지 않으므로)
                const db = await import('../db.js');
                await db.saveGame(game);
                const { broadcastToGameParticipants } = await import('../socket.js');
                console.log(`[SinglePlayer Missile] Broadcasting GAME_UPDATE after animation completion: gameId=${game.id}, gameStatus=${game.gameStatus}`);
                broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
                
                return true; // 상태 변경이 있었으므로 true 반환하여 브로드캐스트 트리거
            }
            
            // 애니메이션이 이미 종료되었어야 하는 경우 즉시 정리 (DB에서 다시 읽혀서 이전 상태로 돌아온 경우 대비)
            // 더 짧은 시간(500ms)에도 강제 종료
            if (elapsed > duration + 500) {
                // 처리된 애니메이션의 startTime을 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                console.warn(`[SinglePlayer Missile] Game ${game.id} animation should have ended (elapsed=${elapsed}ms, duration=${duration}ms), forcing cleanup...`);
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (animNonNull as any).from as types.Point | undefined;
                const animationTo = (animNonNull as any).to as types.Point | undefined;
                const revealedHiddenStone = (animNonNull as any).revealedHiddenStone as types.Point | null | undefined;
                
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
                    // 싱글플레이 모드에서 목적지에 AI 돌이 있는지 확인
                    const opponentPlayer = playerWhoMoved === types.Player.Black ? types.Player.White : types.Player.Black;
                    const stoneAtTo = game.boardState[at.y]?.[at.x];
                    if (game.isSinglePlayer && stoneAtTo === opponentPlayer) {
                        console.error(`[SinglePlayer Missile] CRITICAL: Attempted to place stone on AI stone at (${at.x}, ${at.y}) during animation completion, gameId=${game.id}`);
                        // AI 돌 위에 덮어씌우지 않음
                        return false;
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
            
            // 애니메이션이 너무 오래 지속된 경우 강제로 정리 (서버 재시작 등으로 인한 문제 방지)
            // 더 짧은 시간(3초)에도 강제 종료
            const MAX_ANIMATION_DURATION = 3000; // 3초
            if (elapsed > MAX_ANIMATION_DURATION) {
                // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
                (game as any).lastProcessedMissileAnimationTime = animationStartTime;
                
                console.warn(`[SinglePlayer Missile] Game ${game.id} animation exceeded max duration (elapsed=${elapsed}ms), forcing cleanup...`);
                const playerWhoMoved = game.currentPlayer;
                const animationFrom = (animNonNull as any).from as types.Point | undefined;
                const animationTo = (animNonNull as any).to as types.Point | undefined;
                const revealedHiddenStone = (animNonNull as any).revealedHiddenStone as types.Point | null | undefined;
                
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
                    // 싱글플레이 모드에서 목적지에 AI 돌이 있는지 확인
                    const opponentPlayer = playerWhoMoved === types.Player.Black ? types.Player.White : types.Player.Black;
                    const stoneAtTo = game.boardState[at.y]?.[at.x];
                    if (game.isSinglePlayer && stoneAtTo === opponentPlayer) {
                        console.error(`[SinglePlayer Missile] CRITICAL: Attempted to place stone on AI stone at (${at.x}, ${at.y}) during animation completion, gameId=${game.id}`);
                        // AI 돌 위에 덮어씌우지 않음
                        return false;
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
        } else {
            // 미사일 애니메이션이 아닌 경우, 상태가 잘못된 것일 수 있음
            if (game.animation) {
                console.warn(`[SinglePlayer Missile] Game ${game.id} has missile_animating status but animation type is ${game.animation!.type}, cleaning up...`);
            }
            game.animation = null;
            game.gameStatus = 'playing';
            return true;
        }
    }
    
    return false; // 게임 상태가 변경되지 않았음을 반환
};

export const handleSinglePlayerMissileAction = async (game: types.LiveGameSession, action: types.ServerAction & { userId: string }, user: types.User): Promise<HandleActionResult | null> => {
    // 싱글플레이 게임이 아니면 처리하지 않음
    if (!game.isSinglePlayer) {
        return null;
    }

    const { type, payload } = action;
    const now = Date.now();
    const myPlayerEnum = user.id === game.blackPlayerId ? types.Player.Black : (user.id === game.whitePlayerId ? types.Player.White : types.Player.None);
    const isMyTurn = myPlayerEnum === game.currentPlayer;

    switch (type) {
        case 'START_MISSILE_SELECTION': {
            // 싱글플레이 게임은 캐시에서 최신 상태 먼저 확인 (애니메이션 완료 후 상태 반영 확인)
            if (game.isSinglePlayer && game.id.startsWith('sp-game-')) {
                const { getCachedGame } = await import('../gameCache.js');
                const cachedGame = await getCachedGame(game.id);
                if (cachedGame) {
                    // 캐시된 게임의 상태와 미사일 개수를 사용 (더 최신일 수 있음)
                    game.gameStatus = cachedGame.gameStatus;
                    game.animation = cachedGame.animation;
                    game.missiles_p1 = cachedGame.missiles_p1 ?? game.missiles_p1;
                    game.missiles_p2 = cachedGame.missiles_p2 ?? game.missiles_p2;
                    game.pausedTurnTimeLeft = cachedGame.pausedTurnTimeLeft;
                    game.itemUseDeadline = cachedGame.itemUseDeadline;
                    console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Using cached game state, gameStatus=${game.gameStatus}, missiles_p1=${game.missiles_p1}, missiles_p2=${game.missiles_p2}, gameId=${game.id}`);
                }
            }
            
            // missile_animating 상태일 때 애니메이션 완료 체크 및 자동 정리
            if (game.gameStatus === 'missile_animating') {
                // 애니메이션이 없거나 완료된 경우
                if (!game.animation || (game.animation.type !== 'missile' && game.animation.type !== 'hidden_missile')) {
                    console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Cleaning up stuck missile_animating state (no animation), gameId=${game.id}`);
                    game.gameStatus = 'playing';
                    const playerWhoMoved = game.currentPlayer;
                    resumeGameTimer(game, now, playerWhoMoved);
                } else {
                    // 애니메이션이 있지만 시간이 초과한 경우 (5초 이상 경과)
                    const animDuration = now - game.animation.startTime;
                    const ANIMATION_TIMEOUT = 5000; // 5초
                    if (animDuration > ANIMATION_TIMEOUT) {
                        console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Animation timeout (${animDuration}ms > ${ANIMATION_TIMEOUT}ms), cleaning up, gameId=${game.id}`);
                        // 애니메이션 완료 처리 (MISSILE_ANIMATION_COMPLETE 로직과 동일)
                        const playerWhoMoved = game.currentPlayer;
                        game.animation = null;
                        game.gameStatus = 'playing';
                        resumeGameTimer(game, now, playerWhoMoved);
                    } else {
                        // 애니메이션이 아직 진행 중인 경우
                        console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION failed: animation in progress (${animDuration}ms), gameId=${game.id}`);
                        return { error: "미사일 애니메이션이 진행 중입니다. 잠시 후 다시 시도해주세요." };
                    }
                }
                // 상태 정리 후 캐시 업데이트 및 저장
                const { updateGameCache } = await import('../gameCache.js');
                updateGameCache(game);
                const db = await import('../db.js');
                await db.saveGame(game);
            }
            
            if (!isMyTurn || game.gameStatus !== 'playing') {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION failed: isMyTurn=${isMyTurn}, gameStatus=${game.gameStatus}, gameId=${game.id}`);
                return { error: "Not your turn to use an item." };
            }
            
            // 미사일 아이템 개수 확인 (캐시에서 최신 값 사용)
            const missileKey = user.id === game.player1.id ? 'missiles_p1' : 'missiles_p2';
            // 캐시에서 최신 미사일 개수 확인
            if (game.isSinglePlayer && game.id.startsWith('sp-game-')) {
                const { getCachedGame } = await import('../gameCache.js');
                const cachedGame = await getCachedGame(game.id);
                if (cachedGame && cachedGame[missileKey] !== undefined) {
                    game[missileKey] = cachedGame[missileKey];
                    console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Updated missile count from cache, ${missileKey}=${game[missileKey]}, gameId=${game.id}`);
                }
            }
            const myMissilesLeft = game[missileKey] ?? game.settings.missileCount ?? 0;
            console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Checking missiles, ${missileKey}=${myMissilesLeft}, gameId=${game.id}`);
            if (myMissilesLeft <= 0) {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION failed: no missiles left, ${missileKey}=${myMissilesLeft}, gameId=${game.id}`);
                return { error: "No missiles left." };
            }
            
            // totalTurns와 captures 보존 (미사일 아이템 사용 시 초기화 방지)
            const preservedTotalTurns = game.totalTurns;
            const preservedCaptures = { ...game.captures };
            const preservedBaseStoneCaptures = game.baseStoneCaptures ? { ...game.baseStoneCaptures } : undefined;
            const preservedHiddenStoneCaptures = game.hiddenStoneCaptures ? { ...game.hiddenStoneCaptures } : undefined;
            
            // 게임 상태를 missile_selecting으로 변경
            game.gameStatus = 'missile_selecting';
            
            // 원래 경기 시간 일시 정지 및 아이템 사용 시간 부여
            const pausedTime = pauseGameTimer(game, now, 30000);
            console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: Paused time for ${myPlayerEnum === types.Player.Black ? 'Black' : 'White'}, pausedTurnTimeLeft=${pausedTime}`);
            
            // totalTurns와 captures 보존 확인
            if (game.totalTurns !== preservedTotalTurns) {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION: totalTurns changed from ${preservedTotalTurns} to ${game.totalTurns}, restoring...`);
                game.totalTurns = preservedTotalTurns;
            }
            if (JSON.stringify(game.captures) !== JSON.stringify(preservedCaptures)) {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION: captures changed, restoring...`);
                game.captures = preservedCaptures;
            }
            if (preservedBaseStoneCaptures && JSON.stringify(game.baseStoneCaptures) !== JSON.stringify(preservedBaseStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION: baseStoneCaptures changed, restoring...`);
                game.baseStoneCaptures = preservedBaseStoneCaptures;
            }
            if (preservedHiddenStoneCaptures && JSON.stringify(game.hiddenStoneCaptures) !== JSON.stringify(preservedHiddenStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] START_MISSILE_SELECTION: hiddenStoneCaptures changed, restoring...`);
                game.hiddenStoneCaptures = preservedHiddenStoneCaptures;
            }
            
            // 게임 캐시 업데이트 (다음 미사일 아이템 사용 시 게임을 찾을 수 있도록)
            const { updateGameCache } = await import('../gameCache.js');
            updateGameCache(game);
            // 게임 상태 저장 (totalTurns와 captures 보존)
            await db.saveGame(game);
            
            console.log(`[SinglePlayer Missile] START_MISSILE_SELECTION: gameStatus changed to missile_selecting, gameId=${game.id}, totalTurns=${game.totalTurns}, captures=${JSON.stringify(game.captures)}, missilesLeft=${game[missileKey]}`);
            return { clientResponse: { gameUpdated: true } };
        }
        
        case 'LAUNCH_MISSILE': {
            if (game.gameStatus !== 'missile_selecting') {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: gameStatus=${game.gameStatus}, expected=missile_selecting, gameId=${game.id}`);
                return { error: "Not in missile selection mode." };
            }
            
            // 아이템 사용 시간 확인
            if (game.itemUseDeadline && now > game.itemUseDeadline) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: item use time expired, gameId=${game.id}`);
                return { error: "Item use time expired." };
            }
            
            // 이미 애니메이션이 진행 중인 경우 무시 (중복 방지)
            if (game.animation) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: animation already exists, gameId=${game.id}`);
                return { error: "Animation already in progress." };
            }
            
            // totalTurns와 captures 보존 (미사일 아이템 사용 시 초기화 방지)
            const preservedTotalTurns = game.totalTurns;
            const preservedCaptures = { ...game.captures };
            const preservedBaseStoneCaptures = game.baseStoneCaptures ? { ...game.baseStoneCaptures } : undefined;
            const preservedHiddenStoneCaptures = game.hiddenStoneCaptures ? { ...game.hiddenStoneCaptures } : undefined;
            
            const { from, direction } = payload;
            const clientBoardState = (payload as any).boardState;
            const clientMoveHistory = (payload as any).moveHistory;
            if (!from || !direction) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: missing from or direction, payload=${JSON.stringify(payload)}, gameId=${game.id}`);
                return { error: "Invalid payload: missing from or direction." };
            }
            
            if (from.x < 0 || from.x >= game.settings.boardSize || from.y < 0 || from.y >= game.settings.boardSize) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: invalid from coordinates, from=${JSON.stringify(from)}, boardSize=${game.settings.boardSize}, gameId=${game.id}`);
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
                console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: using client boardState for validation, gameId=${game.id}`);
                game.boardState = clientBoardState;
            }
            if (clientMoveHistory && Array.isArray(clientMoveHistory) && clientMoveHistory.length > 0) {
                console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: using client moveHistory for validation, gameId=${game.id}`);
                game.moveHistory = clientMoveHistory;
            }
            
            // 싱글플레이어 게임에서는 boardState, moveHistory, baseStones_p1/baseStones_p2를 모두 확인
            // (클라이언트에서 새로 놓은 돌이 서버의 boardState에 아직 반영되지 않았을 수 있음)
            const stoneAtFrom = boardStateToUse[from.y]?.[from.x];
            
            // moveHistory에서 정확한 좌표로 찾기 (클라이언트의 moveHistory 우선 사용)
            let moveAtFrom = moveHistoryToUse.find(m => m.x === from.x && m.y === from.y && m.player === myPlayerEnum);
            
            // moveHistory에서 정확한 좌표를 찾지 못한 경우, 해당 플레이어의 최근 이동 기록 확인
            // (싱글플레이어 모드에서는 클라이언트가 보낸 좌표를 더 신뢰)
            if (!moveAtFrom) {
                // 해당 플레이어의 최근 이동 기록 확인 (최근 10개)
                const myRecentMoves = moveHistoryToUse
                    .filter(m => m.player === myPlayerEnum && m.x !== -1 && m.y !== -1)
                    .slice(-10);
                
                // 최근 이동 기록 중에서 해당 좌표와 일치하는 것이 있는지 확인
                moveAtFrom = myRecentMoves.find(m => m.x === from.x && m.y === from.y);
            }
            
            // baseStones_p1, baseStones_p2도 확인 (랜덤 배치된 돌)
            const playerId = myPlayerEnum === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
            const baseStonesKey = playerId === game.player1.id ? 'baseStones_p1' : 'baseStones_p2';
            const baseStonesArray = (game as any)[baseStonesKey] as types.Point[] | undefined;
            const isBaseStone = baseStonesArray?.some(bs => bs.x === from.x && bs.y === from.y) || false;
            
            // 싱글플레이어 모드에서는 클라이언트가 보낸 좌표를 더 신뢰
            // boardState가 비어있고, moveHistory나 baseStones에 없어도 클라이언트가 보낸 좌표를 신뢰
            // 단, 상대방 돌이 있는 경우는 제외
            const opponentEnum = myPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
            const isOpponentStone = stoneAtFrom === opponentEnum;
            
            // 내 돌인지 확인: boardState에 내 돌이 있거나, moveHistory에 있거나, baseStones에 있거나, 
            // 또는 boardState가 비어있고 상대방 돌이 아닌 경우 (싱글플레이어 모드에서 클라이언트 신뢰)
            const isMyStone = stoneAtFrom === myPlayerEnum || !!moveAtFrom || isBaseStone || 
                (stoneAtFrom === types.Player.None && !isOpponentStone && game.isSinglePlayer);
            
            if (!isMyStone) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: not your stone, from=${JSON.stringify(from)}, stoneAtFrom=${stoneAtFrom}, myPlayerEnum=${myPlayerEnum}, hasMoveHistory=${!!moveAtFrom}, isBaseStone=${isBaseStone}, isOpponentStone=${isOpponentStone}, gameId=${game.id}`);
                console.warn(`[SinglePlayer Missile] moveHistory length=${game.moveHistory.length}, myRecentMoves=${game.moveHistory.filter(m => m.player === myPlayerEnum && m.x !== -1 && m.y !== -1).length}`);
                return { error: "Not your stone." };
            }
            
            // moveHistory나 baseStones에는 있지만 boardState에 반영되지 않은 경우 boardState 업데이트
            // 또는 싱글플레이어 모드에서 boardState가 비어있는 경우 업데이트
            if ((moveAtFrom || isBaseStone || (stoneAtFrom === types.Player.None && game.isSinglePlayer)) && stoneAtFrom !== myPlayerEnum) {
                console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: updating boardState for stone, from=${JSON.stringify(from)}, stoneAtFrom=${stoneAtFrom}, hasMoveHistory=${!!moveAtFrom}, isBaseStone=${isBaseStone}, gameId=${game.id}`);
                game.boardState[from.y][from.x] = myPlayerEnum;
            }
            
            // 미사일 경로 계산 (클라이언트의 boardState와 moveHistory를 사용)
            // 클라이언트의 boardState를 서버에 반영한 상태로 경로 계산
            const { to, revealedHiddenStone } = calculateSinglePlayerMissilePath(game, from, direction, myPlayerEnum);
            
            if (to.x === from.x && to.y === from.y) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE failed: cannot move stone, from=${JSON.stringify(from)}, to=${JSON.stringify(to)}, direction=${direction}, gameId=${game.id}`);
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
            
            // 목적지에 상대방 돌이 있는지 확인 (미사일로 따내기)
            const stoneAtTo = game.boardState[to.y]?.[to.x];
            // opponentEnum은 이미 위에서 선언됨 (918번째 줄)
            const moveAtTo = game.moveHistory.find(m => m.x === to.x && m.y === to.y);
            const isOpponentMoveAtTo = moveAtTo && moveAtTo.player === opponentEnum;
            
            // 목적지에 상대방 돌이 있는 경우 따내기 처리
            let capturedStones: types.Point[] = [];
            if (stoneAtTo === opponentEnum || isOpponentMoveAtTo) {
                // 상대방 돌이 있는 경우, 히든 돌인지 확인
                const moveIndexAtTo = game.moveHistory.findIndex(m => m.x === to.x && m.y === to.y);
                const isHiddenStoneAtTo = moveIndexAtTo !== -1 && !!game.hiddenMoves?.[moveIndexAtTo];
                const isPermanentlyRevealedAtTo = game.permanentlyRevealedStones?.some(p => p.x === to.x && p.y === to.y);
                
                // 히든 돌이고 아직 공개되지 않은 경우만 통과 (이미 경로 계산에서 처리됨)
                // 공개된 상대방 돌이면 따내기
                if (isHiddenStoneAtTo && !isPermanentlyRevealedAtTo) {
                    // 히든 돌은 이미 처리되었으므로 여기서는 추가 처리 없음
                } else {
                    // 공개된 상대방 돌을 따내기
                    capturedStones.push({ x: to.x, y: to.y });
                    console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: Capturing opponent stone at (${to.x}, ${to.y}), gameId=${game.id}`);
                    
                    // 점수 추가 (기본 점수 1점, 배치돌이면 5점)
                    const isBaseStone = (game.baseStones?.some(bs => bs.x === to.x && bs.y === to.y)) ||
                                       ((game as any).baseStones_p1?.some((bs: types.Point) => bs.x === to.x && bs.y === to.y)) ||
                                       ((game as any).baseStones_p2?.some((bs: types.Point) => bs.x === to.x && bs.y === to.y));
                    if (isBaseStone) {
                        if (!game.baseStoneCaptures) {
                            game.baseStoneCaptures = { [types.Player.Black]: 0, [types.Player.White]: 0, [types.Player.None]: 0 };
                        }
                        game.baseStoneCaptures[myPlayerEnum]++;
                        game.captures[myPlayerEnum] += 5;
                    } else {
                        game.captures[myPlayerEnum]++;
                    }
                    
                    // justCaptured에 추가
                    if (!game.justCaptured) game.justCaptured = [];
                    game.justCaptured.push({ point: { x: to.x, y: to.y }, player: opponentEnum, wasHidden: false });
                }
            }
            
            // 보드 상태 변경: 원래 자리의 돌 제거, 목적지에 돌 배치 (상대방 돌이 있으면 제거 후 배치)
            // 원래 자리의 돌 제거
            game.boardState[from.y][from.x] = types.Player.None;
            // 목적지에 돌 배치 (상대방 돌이 있었으면 이미 제거됨)
            game.boardState[to.y][to.x] = myPlayerEnum;
            
            // 배치돌 업데이트: 원래 자리의 배치돌을 목적지로 이동
            if (game.baseStones) {
                const baseStoneIndex = game.baseStones.findIndex(bs => bs.x === from.x && bs.y === from.y);
                if (baseStoneIndex !== -1) {
                    game.baseStones[baseStoneIndex].x = to.x;
                    game.baseStones[baseStoneIndex].y = to.y;
                }
            }
            
            // 싱글플레이에서 baseStones_p1, baseStones_p2도 확인 (이미 위에서 선언된 변수 재사용)
            if (baseStonesArray) {
                const baseStoneIndex = baseStonesArray.findIndex(bs => bs.x === from.x && bs.y === from.y);
                if (baseStoneIndex !== -1) {
                    baseStonesArray[baseStoneIndex].x = to.x;
                    baseStonesArray[baseStoneIndex].y = to.y;
                }
            }
            
            // moveHistory 업데이트: 원래 자리의 이동 기록을 목적지로 변경
            const fromMoveIndex = game.moveHistory.findIndex(m => m.x === from.x && m.y === from.y && m.player === myPlayerEnum);
            if (fromMoveIndex !== -1) {
                // 원래 자리의 이동 기록이 있으면 목적지로 변경
                game.moveHistory[fromMoveIndex].x = to.x;
                game.moveHistory[fromMoveIndex].y = to.y;
            } else {
                // 원래 자리의 이동 기록이 없으면 (배치돌인 경우) 새로 추가하지 않음
                // 배치돌은 moveHistory에 없으므로 추가하지 않음
                // 유저가 직접 착수한 돌만 moveHistory에 있음
            }
            
            // 아이템 사용 시간 일시 정지 (애니메이션 중)
            game.itemUseDeadline = undefined;
            
            // 턴 시간 복원 (애니메이션 중에도 턴이 유지되도록)
            resumeGameTimer(game, now, myPlayerEnum);
            
            // 미사일 아이템은 턴을 사용하는 행동이 아니므로 totalTurns를 증가시키지 않음
            // totalTurns는 유지되어야 함 (자동계가까지 남은 턴이 초기화되지 않도록)
            
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
            const missilesBefore = game[missileKey] ?? game.settings.missileCount ?? 0;
            game[missileKey] = Math.max(0, missilesBefore - 1);
            const missilesAfter = game[missileKey];
            console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: Missile count decreased, ${missileKey}: ${missilesBefore} -> ${missilesAfter}, gameId=${game.id}`);
            
            // totalTurns와 captures 보존 확인 (애니메이션 시작 시 초기화 방지)
            if (game.totalTurns !== preservedTotalTurns) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE: totalTurns changed from ${preservedTotalTurns} to ${game.totalTurns}, restoring...`);
                game.totalTurns = preservedTotalTurns;
            }
            if (JSON.stringify(game.captures) !== JSON.stringify(preservedCaptures)) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE: captures changed, restoring...`);
                game.captures = preservedCaptures;
            }
            if (preservedBaseStoneCaptures && JSON.stringify(game.baseStoneCaptures) !== JSON.stringify(preservedBaseStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE: baseStoneCaptures changed, restoring...`);
                game.baseStoneCaptures = preservedBaseStoneCaptures;
            }
            if (preservedHiddenStoneCaptures && JSON.stringify(game.hiddenStoneCaptures) !== JSON.stringify(preservedHiddenStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] LAUNCH_MISSILE: hiddenStoneCaptures changed, restoring...`);
                game.hiddenStoneCaptures = preservedHiddenStoneCaptures;
            }
            
            console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: Animation started, preserved totalTurns=${preservedTotalTurns}, captures=${JSON.stringify(preservedCaptures)}, missilesLeft=${missilesAfter}, gameId=${game.id}`);
            
            // 게임 캐시 업데이트 (다음 미사일 아이템 사용 시 게임을 찾을 수 있도록) - 저장 전에 먼저 업데이트
            const { updateGameCache } = await import('../gameCache.js');
            updateGameCache(game);
            // 게임 상태 저장 및 브로드캐스트 (클라이언트가 보드 상태 업데이트를 받을 수 있도록)
            const db = await import('../db.js');
            await db.saveGame(game);
            // 저장 후 다시 캐시 업데이트 (DB 저장 후 최신 상태 보장)
            updateGameCache(game);
            const { broadcastToGameParticipants } = await import('../socket.js');
            console.log(`[SinglePlayer Missile] LAUNCH_MISSILE: Broadcasting GAME_UPDATE after launch, gameId=${game.id}, missilesLeft=${missilesAfter}`);
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            
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
            // 클라이언트가 애니메이션 완료를 알림
            if (game.gameStatus !== 'missile_animating' && game.gameStatus !== 'playing') {
                console.warn(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE failed: gameStatus=${game.gameStatus}, expected=missile_animating or playing, gameId=${game.id}`);
                return { error: "Not in missile animation state." };
            }
            
            // 애니메이션이 이미 완료되었거나 없는 경우, 게임 상태만 확인하고 정리
            if (!game.animation || (game.animation.type !== 'missile' && game.animation.type !== 'hidden_missile')) {
                // 애니메이션이 없는데 게임 상태가 missile_animating인 경우 정리
                if (game.gameStatus === 'missile_animating') {
                    console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: cleaning up stuck missile_animating state, gameId=${game.id}`);
                    game.gameStatus = 'playing';
                    const playerWhoMoved = game.currentPlayer;
                    resumeGameTimer(game, now, playerWhoMoved);
                    console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: cleaned up stuck state, gameId=${game.id}, gameStatus=${game.gameStatus}`);
                    return { clientResponse: { gameUpdated: true } };
                }
                // 이미 완료된 경우 성공으로 반환
                console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: animation already completed, gameId=${game.id}`);
                return { clientResponse: { gameUpdated: true } };
            }
            
            // 애니메이션 완료 처리
            const animationStartTime = game.animation.startTime;
            const lastProcessedAnimationTime = (game as any).lastProcessedMissileAnimationTime;
            
            // 이미 처리된 애니메이션인지 확인
            if (lastProcessedAnimationTime === animationStartTime) {
                console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: animation already processed, gameId=${game.id}`);
                // 이미 처리되었어도 게임 상태가 여전히 missile_animating이면 정리
                if (game.gameStatus === 'missile_animating') {
                    console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: gameStatus still missile_animating after processing, cleaning up, gameId=${game.id}`);
                    game.gameStatus = 'playing';
                    game.animation = null;
                    return { clientResponse: { gameUpdated: true } };
                }
                return { clientResponse: { gameUpdated: true } };
            }
            
            // 처리된 애니메이션의 startTime을 먼저 기록 (중복 처리 방지)
            (game as any).lastProcessedMissileAnimationTime = animationStartTime;
            
            // totalTurns와 captures 보존 (애니메이션 완료 시 초기화 방지)
            const preservedTotalTurns = game.totalTurns;
            const preservedCaptures = { ...game.captures };
            const preservedBaseStoneCaptures = game.baseStoneCaptures ? { ...game.baseStoneCaptures } : undefined;
            const preservedHiddenStoneCaptures = game.hiddenStoneCaptures ? { ...game.hiddenStoneCaptures } : undefined;
            
            // 애니메이션 정보를 먼저 저장 (null 설정 전에)
            const playerWhoMoved = game.currentPlayer;
            const animationFrom = game.animation.from;
            const animationTo = game.animation.to;
            const revealedHiddenStone = (game.animation as any).revealedHiddenStone as types.Point | null | undefined;
            
            // 애니메이션 제거
            game.animation = null;
            
            // 게임 상태를 playing으로 변경
            game.gameStatus = 'playing';
            
            // 멀티플레이어 로직과 동일: 애니메이션이 끝나면 원래 자리의 돌만 제거
            // (목적지의 돌은 이미 LAUNCH_MISSILE에서 배치되었으므로 그대로 유지)
            if (animationFrom && animationTo) {
                const stoneAtFrom = game.boardState[animationFrom.y]?.[animationFrom.x];
                // 원래 자리의 돌 제거 (목적지의 돌은 이미 배치되어 있음)
                if (stoneAtFrom === playerWhoMoved) {
                    game.boardState[animationFrom.y][animationFrom.x] = types.Player.None;
                }
                
                // 배치돌 업데이트: 원래 자리의 배치돌 제거 (싱글플레이 특성 고려)
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
                
                // moveHistory 업데이트: 원래 자리의 이동 기록을 목적지로 변경
                // (제거하지 않고 변경하는 이유: totalTurns 계산을 위해 moveHistory 길이를 유지해야 함)
                const fromMoveIndex = game.moveHistory.findIndex(m => m.x === animationFrom.x && m.y === animationFrom.y && m.player === playerWhoMoved);
                if (fromMoveIndex !== -1) {
                    // 원래 자리의 이동 기록을 목적지로 변경 (제거하지 않음)
                    game.moveHistory[fromMoveIndex].x = animationTo.x;
                    game.moveHistory[fromMoveIndex].y = animationTo.y;
                } else {
                    // 원래 자리의 이동 기록이 없으면 (배치돌인 경우) 목적지에 새로 추가하지 않음
                    // 배치돌은 moveHistory에 없으므로 추가하지 않음
                }
            }
            
            // 히든 돌 공개 처리
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
            
            // 타이머 복원 (LAUNCH_MISSILE에서 이미 복원했으므로, 애니메이션 중 경과한 시간을 반영)
            if (game.settings.timeLimit > 0 && game.turnDeadline) {
                // turnDeadline이 이미 설정되어 있으면, 경과한 시간을 반영하여 timeLeft 업데이트
                const elapsed = now - (game.turnStartTime || now);
                const currentPlayerTimeKey = playerWhoMoved === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
                const remainingTime = Math.max(0, (game.turnDeadline - now) / 1000);
                game[currentPlayerTimeKey] = remainingTime;
                // turnDeadline과 turnStartTime은 이미 설정되어 있으므로 그대로 유지
                console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: Updated time for ${playerWhoMoved === types.Player.Black ? 'Black' : 'White'}, timeLeft=${remainingTime}, elapsed=${elapsed}`);
                // pausedTurnTimeLeft와 itemUseDeadline만 정리
                game.pausedTurnTimeLeft = undefined;
                game.itemUseDeadline = undefined;
            } else {
                // turnDeadline이 없으면 resumeGameTimer 사용
                resumeGameTimer(game, now, playerWhoMoved);
                console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: Restored time for ${playerWhoMoved === types.Player.Black ? 'Black' : 'White'}`);
            }
            
            // totalTurns와 captures 보존 확인 (애니메이션 완료 시 초기화 방지)
            if (game.totalTurns !== preservedTotalTurns) {
                console.warn(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: totalTurns changed from ${preservedTotalTurns} to ${game.totalTurns}, restoring...`);
                game.totalTurns = preservedTotalTurns;
            }
            if (JSON.stringify(game.captures) !== JSON.stringify(preservedCaptures)) {
                console.warn(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: captures changed, restoring...`);
                game.captures = preservedCaptures;
            }
            if (preservedBaseStoneCaptures && JSON.stringify(game.baseStoneCaptures) !== JSON.stringify(preservedBaseStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: baseStoneCaptures changed, restoring...`);
                game.baseStoneCaptures = preservedBaseStoneCaptures;
            }
            if (preservedHiddenStoneCaptures && JSON.stringify(game.hiddenStoneCaptures) !== JSON.stringify(preservedHiddenStoneCaptures)) {
                console.warn(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: hiddenStoneCaptures changed, restoring...`);
                game.hiddenStoneCaptures = preservedHiddenStoneCaptures;
            }
            
            // 미사일 개수 확인 및 로깅 (애니메이션 완료 후 정확한 값 확인)
            const playerId = playerWhoMoved === types.Player.Black ? game.blackPlayerId! : game.whitePlayerId!;
            const missileKey = playerId === game.player1.id ? 'missiles_p1' : 'missiles_p2';
            const missilesLeft = game[missileKey] ?? 0;
            
            console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: animation completed, gameId=${game.id}, gameStatus=${game.gameStatus}, totalTurns=${preservedTotalTurns}, captures=${JSON.stringify(preservedCaptures)}, missilesLeft=${missilesLeft} (${missileKey})`);
            
            // 게임 캐시 업데이트 (다음 미사일 아이템 사용 시 게임을 찾을 수 있도록) - 반드시 저장 전에 업데이트
            const { updateGameCache } = await import('../gameCache.js');
            updateGameCache(game);
            // 싱글플레이어 모드에서는 클라이언트에 게임 상태 업데이트를 알려야 함
            // 서버에서 게임 상태를 저장하고 브로드캐스트
            const db = await import('../db.js');
            await db.saveGame(game);
            // 저장 후 다시 캐시 업데이트 (DB 저장 후 최신 상태 보장)
            updateGameCache(game);
            
            const { broadcastToGameParticipants } = await import('../socket.js');
            console.log(`[SinglePlayer Missile] MISSILE_ANIMATION_COMPLETE: Broadcasting GAME_UPDATE to client, gameId=${game.id}, gameStatus=${game.gameStatus}, missilesLeft=${missilesLeft}`);
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            
            return { clientResponse: { gameUpdated: true } };
        }
    }
    
    return null;
};

