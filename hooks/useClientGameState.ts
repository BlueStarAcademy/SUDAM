/**
 * 싱글플레이와 도전의 탑 게임의 공통 클라이언트 상태 관리 유틸리티
 * 서로 간섭하는 문제를 방지하기 위해 공통 로직을 여기로 추출
 */

import { Player, LiveGameSession, Point, GameMode } from '../types/index.js';

export type GameType = 'tower' | 'singleplayer';

export interface ClientMovePayload {
    gameId: string;
    x: number;
    y: number;
    newBoardState: any[][];
    capturedStones: Point[];
    newKoInfo: any;
}

export interface GameStateUpdateResult {
    updatedGame: LiveGameSession;
    shouldCheckVictory: boolean;
    checkInfo?: {
        towerFloor?: number;
        stageId: string;
        newCaptures: { [key in Player]?: number };
        gameType: GameType;
    };
}

/**
 * 클라이언트 이동 처리 후 게임 상태 업데이트
 */
export function updateGameStateAfterMove(
    game: LiveGameSession,
    payload: ClientMovePayload & { isPass?: boolean },
    gameType: GameType
): GameStateUpdateResult {
    const { x, y, newBoardState, capturedStones, newKoInfo, isPass } = payload;
    
    // 패스 처리
    if (isPass && x === -1 && y === -1) {
        const movePlayer = game.currentPlayer;
        const updatedGame = {
            ...game,
            passCount: (game.passCount || 0) + 1,
            lastMove: { x: -1, y: -1 },
            lastTurnStones: null,
            moveHistory: [...(game.moveHistory || []), { player: movePlayer, x: -1, y: -1 }],
            currentPlayer: movePlayer === Player.Black ? Player.White : Player.Black,
            koInfo: newKoInfo || game.koInfo
        };
        
        return {
            updatedGame,
            shouldCheckVictory: false,
            checkInfo: undefined
        };
    }
    
    // 이동한 플레이어의 포획 수 업데이트
    // 문양돌은 2점, 일반 돌은 1점
    const movePlayer = game.currentPlayer;
    const opponentPlayer = movePlayer === Player.Black ? Player.White : Player.Black;
    
    let capturePoints = 0;
    for (const stone of capturedStones) {
        // 문양돌 확인: 상대방의 문양돌 목록에서 확인
        const patternStones = opponentPlayer === Player.Black ? game.blackPatternStones : game.whitePatternStones;
        const isPatternStone = patternStones?.some(p => p.x === stone.x && p.y === stone.y) ?? false;
        capturePoints += isPatternStone ? 2 : 1;
    }
    
    const newCaptures = {
        ...game.captures,
        [movePlayer]: (game.captures[movePlayer] || 0) + capturePoints
    };
    
    // 살리기 바둑 모드: 백이 수를 둔 경우 whiteTurnsPlayed 증가
    let updatedWhiteTurnsPlayed = (game as any).whiteTurnsPlayed;
    if (gameType === 'singleplayer' && movePlayer === Player.White) {
        updatedWhiteTurnsPlayed = ((game as any).whiteTurnsPlayed || 0) + 1;
    }
    
    // 도전의 탑 또는 싱글플레이: 목표 달성 체크 준비
    let checkInfo: { towerFloor?: number; stageId: string; newCaptures: { [key in Player]?: number }; gameType: GameType } | undefined;
    
    if (gameType === 'tower' && game.towerFloor !== undefined && game.towerFloor >= 1 && game.towerFloor <= 20 && game.stageId) {
        // 도전의 탑: 1~20층 사이에서 목표 달성 체크
        checkInfo = {
            towerFloor: game.towerFloor,
            stageId: game.stageId,
            newCaptures: newCaptures,
            gameType: 'tower'
        };
    } else if (gameType === 'singleplayer' && game.stageId) {
        // 싱글플레이 따내기 바둑: 목표 달성 체크
        // 살리기 바둑 모드가 아닌 경우에만 체크 (살리기 바둑은 서버에서 처리)
        // effectiveCaptureTargets로 판단 (살리기 바둑은 effectiveCaptureTargets가 999로 설정됨)
        const hasTargetScore = game.effectiveCaptureTargets && (
            (game.effectiveCaptureTargets[Player.Black] !== undefined && game.effectiveCaptureTargets[Player.Black] !== 999) ||
            (game.effectiveCaptureTargets[Player.White] !== undefined && game.effectiveCaptureTargets[Player.White] !== 999)
        );
        // 또는 mode가 Capture인 경우
        const isCaptureMode = game.mode === '따내기 바둑' || (game.mode as any) === 'capture';
        if (hasTargetScore || isCaptureMode) {
            checkInfo = {
                stageId: game.stageId,
                newCaptures: newCaptures,
                gameType: 'singleplayer'
            };
        }
    }
    
    // 문양돌 목록 업데이트: 따낸 문양돌 제거
    // 상대방의 문양돌 목록에서 따낸 돌 제거
    let updatedBlackPatternStones = game.blackPatternStones;
    let updatedWhitePatternStones = game.whitePatternStones;
    
    if (opponentPlayer === Player.Black && game.blackPatternStones) {
        updatedBlackPatternStones = game.blackPatternStones.filter(p => 
            !capturedStones.some(s => s.x === p.x && s.y === p.y)
        );
    }
    
    if (opponentPlayer === Player.White && game.whitePatternStones) {
        updatedWhitePatternStones = game.whitePatternStones.filter(p => 
            !capturedStones.some(s => s.x === p.x && s.y === p.y)
        );
    }
    
    // 싱글플레이: totalTurns 업데이트 (흑/백 모두 카운팅)
    let updatedTotalTurns = game.totalTurns;
    if (gameType === 'singleplayer' && game.stageId) {
        const newMoveHistory = [...(game.moveHistory || []), { x, y, player: movePlayer }];
        // validMoves: x !== -1인 수만 카운팅 (패스 제외)
        const validMoves = newMoveHistory.filter(m => m.x !== -1 && m.y !== -1);
        updatedTotalTurns = validMoves.length;
    }
    
    // 피셔 방식 시간 연장: 스피드 바둑 모드에서 착수한 플레이어의 시간에 increment 추가
    let updatedBlackTimeLeft = game.blackTimeLeft;
    let updatedWhiteTimeLeft = game.whiteTimeLeft;
    let updatedBlackByoyomiPeriodsLeft = game.blackByoyomiPeriodsLeft ?? game.settings?.byoyomiCount ?? 0;
    let updatedWhiteByoyomiPeriodsLeft = game.whiteByoyomiPeriodsLeft ?? game.settings?.byoyomiCount ?? 0;
    let updatedTurnDeadline = game.turnDeadline;
    let updatedTurnStartTime = game.turnStartTime;
    
    const isFischer = game.mode === GameMode.Speed || (game.mode === GameMode.Mix && game.settings?.mixedModes?.includes(GameMode.Speed));
    const timeIncrement = isFischer ? (game.settings?.timeIncrement || 0) : 0;
    const byoyomiTime = game.settings?.byoyomiTime ?? 0;
    const byoyomiCount = game.settings?.byoyomiCount ?? 0;
    
    // 수를 둔 플레이어의 시간 업데이트
    if (movePlayer === Player.Black) {
        // 현재 시간 계산: turnDeadline이 있으면 남은 시간, 없으면 blackTimeLeft 사용
        let currentTime = game.turnDeadline 
            ? Math.max(0, (game.turnDeadline - Date.now()) / 1000)
            : (game.blackTimeLeft || 0);
        
        // 피셔 방식이면 increment 추가
        if (timeIncrement > 0) {
            currentTime = currentTime + timeIncrement;
        }
        
        // 메인 시간이 0이 되었고 초읽기가 남아있으면 초읽기로 전환
        if (currentTime <= 0 && updatedBlackByoyomiPeriodsLeft > 0 && byoyomiTime > 0) {
            // 초읽기 시작: 초읽기 시간으로 설정하고 초읽기 횟수 감소
            updatedBlackTimeLeft = 0;
            updatedBlackByoyomiPeriodsLeft = Math.max(0, updatedBlackByoyomiPeriodsLeft - 1);
        } else {
            // 메인 시간 업데이트
            updatedBlackTimeLeft = Math.max(0, currentTime);
        }
    } else if (movePlayer === Player.White) {
        // 현재 시간 계산: turnDeadline이 있으면 남은 시간, 없으면 whiteTimeLeft 사용
        let currentTime = game.turnDeadline 
            ? Math.max(0, (game.turnDeadline - Date.now()) / 1000)
            : (game.whiteTimeLeft || 0);
        
        // 피셔 방식이면 increment 추가
        if (timeIncrement > 0) {
            currentTime = currentTime + timeIncrement;
        }
        
        // 메인 시간이 0이 되었고 초읽기가 남아있으면 초읽기로 전환
        if (currentTime <= 0 && updatedWhiteByoyomiPeriodsLeft > 0 && byoyomiTime > 0) {
            // 초읽기 시작: 초읽기 시간으로 설정하고 초읽기 횟수 감소
            updatedWhiteTimeLeft = 0;
            updatedWhiteByoyomiPeriodsLeft = Math.max(0, updatedWhiteByoyomiPeriodsLeft - 1);
        } else {
            // 메인 시간 업데이트
            updatedWhiteTimeLeft = Math.max(0, currentTime);
        }
    }
    
    // 다음 플레이어의 turnDeadline 설정
    const nextPlayer = movePlayer === Player.Black ? Player.White : Player.Black;
    const nextTimeKey = nextPlayer === Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
    const nextByoyomiKey = nextPlayer === Player.Black ? 'blackByoyomiPeriodsLeft' : 'whiteByoyomiPeriodsLeft';
    
    // 다음 플레이어의 시간은 업데이트된 시간 사용
    let nextTime = nextPlayer === Player.Black ? updatedBlackTimeLeft : updatedWhiteTimeLeft;
    const nextByoyomiPeriods = nextPlayer === Player.Black ? updatedBlackByoyomiPeriodsLeft : updatedWhiteByoyomiPeriodsLeft;
    
    // 시간이 없으면 설정에서 기본값 사용
    if (nextTime <= 0 && nextByoyomiPeriods <= 0) {
        nextTime = game.settings?.timeLimit ? game.settings.timeLimit * 60 : 0;
    }
    
    // 메인 시간이 0이고 초읽기가 남아있으면 초읽기로 전환
    if (nextTime <= 0 && nextByoyomiPeriods > 0 && byoyomiTime > 0) {
        // 초읽기 시작: 초읽기 시간으로 deadline 설정
        updatedTurnDeadline = Date.now() + (byoyomiTime * 1000);
        updatedTurnStartTime = Date.now();
        // 메인 시간은 0으로 유지
        if (nextPlayer === Player.Black) {
            updatedBlackTimeLeft = 0;
        } else {
            updatedWhiteTimeLeft = 0;
        }
    } else if (nextTime > 0) {
        // 메인 시간이 남아있으면 메인 시간으로 deadline 설정
        updatedTurnDeadline = Date.now() + (nextTime * 1000);
        updatedTurnStartTime = Date.now();
    }
    
    // 패 처리: 새로운 패가 발생하면 설정, 패가 발생하지 않으면 해제
    // 패는 바로 다음 수에서만 유효하고, 그 이후에는 자동으로 해제됨
    let finalKoInfo = newKoInfo || null;
    
    // 게임 상태 업데이트
    const updatedGame: LiveGameSession = {
        ...game,
        boardState: newBoardState,
        koInfo: finalKoInfo,
        lastMove: { x, y },
        moveHistory: [...(game.moveHistory || []), { x, y, player: movePlayer }],
        captures: newCaptures,
        blackPatternStones: updatedBlackPatternStones,
        whitePatternStones: updatedWhitePatternStones,
        currentPlayer: game.currentPlayer === Player.Black ? Player.White : Player.Black,
        serverRevision: (game.serverRevision || 0) + 1,
        blackTimeLeft: updatedBlackTimeLeft,
        whiteTimeLeft: updatedWhiteTimeLeft,
        blackByoyomiPeriodsLeft: updatedBlackByoyomiPeriodsLeft,
        whiteByoyomiPeriodsLeft: updatedWhiteByoyomiPeriodsLeft,
        turnDeadline: updatedTurnDeadline,
        turnStartTime: updatedTurnStartTime,
        ...(updatedWhiteTurnsPlayed !== undefined ? { whiteTurnsPlayed: updatedWhiteTurnsPlayed } as any : {}),
        ...(updatedTotalTurns !== undefined ? { totalTurns: updatedTotalTurns } as any : {}),
    };
    
    return {
        updatedGame,
        shouldCheckVictory: !!checkInfo,
        checkInfo
    };
}

/**
 * 승리 조건 체크 (도전의 탑 및 싱글플레이)
 */
export async function checkVictoryCondition(
    checkInfo: { towerFloor?: number; stageId: string; newCaptures: { [key in Player]?: number }; gameType: GameType },
    gameId: string,
    effectiveCaptureTargets?: { [key in Player]?: number }
): Promise<{ winner: Player; winReason: string } | null> {
    try {
        if (checkInfo.gameType === 'tower') {
            // 도전의 탑 승리 조건 체크
            const { TOWER_STAGES } = await import('../constants/towerConstants.js');
            const stage = TOWER_STAGES.find((s: any) => s.id === checkInfo.stageId);
            
            if (!stage || !stage.targetScore) {
                return null;
            }
            
            const blackCaptures = checkInfo.newCaptures[Player.Black] || 0;
            const whiteCaptures = checkInfo.newCaptures[Player.White] || 0;
            
            // 흑(유저)이 목표 따낸 돌의 수를 달성하면 승리
            if (blackCaptures >= stage.targetScore.black) {
                return { winner: Player.Black, winReason: 'capture_limit' };
            }
            
            // 백(AI)이 목표 점수를 달성하면 패배
            if (whiteCaptures >= stage.targetScore.white) {
                return { winner: Player.White, winReason: 'capture_limit' };
            }
        } else if (checkInfo.gameType === 'singleplayer') {
            // 싱글플레이 승리 조건 체크
            const { SINGLE_PLAYER_STAGES } = await import('../constants/singlePlayerConstants.js');
            const stage = SINGLE_PLAYER_STAGES.find((s: any) => s.id === checkInfo.stageId);
            
            if (!stage) {
                return null;
            }
            
            // 살리기 바둑 모드: 백의 남은 턴 체크
            if (stage.survivalTurns) {
                // 살리기 바둑은 클라이언트에서 백의 턴 수를 추적할 수 없으므로 서버에서만 처리
                // 하지만 백이 수를 둔 후 클라이언트에서도 체크 가능
                return null;
            }
            
            // effectiveCaptureTargets가 있으면 사용, 없으면 stage.targetScore 사용
            const blackTarget = effectiveCaptureTargets?.[Player.Black] ?? stage.targetScore?.black ?? 999;
            const whiteTarget = effectiveCaptureTargets?.[Player.White] ?? stage.targetScore?.white ?? 999;
            
            const blackCaptures = checkInfo.newCaptures[Player.Black] || 0;
            const whiteCaptures = checkInfo.newCaptures[Player.White] || 0;
            
            // NO_CAPTURE_TARGET (999)은 목표가 없음을 의미
            const NO_CAPTURE_TARGET = 999;
            
            // 흑(유저)이 목표 따낸 돌의 수를 달성하면 승리
            if (blackTarget !== NO_CAPTURE_TARGET && blackCaptures >= blackTarget) {
                return { winner: Player.Black, winReason: 'capture_limit' };
            }
            
            // 백(AI)이 목표 점수를 달성하면 패배
            if (whiteTarget !== NO_CAPTURE_TARGET && whiteCaptures >= whiteTarget) {
                return { winner: Player.White, winReason: 'capture_limit' };
            }
        }
        
        return null;
    } catch (err) {
        console.error('[checkVictoryCondition] Failed to import stages:', err);
        return null;
    }
}

/**
 * 게임 타입 판단
 */
export function getGameType(game: LiveGameSession): GameType | null {
    if (game.gameCategory === 'tower') {
        return 'tower';
    }
    if (game.isSinglePlayer) {
        return 'singleplayer';
    }
    return null;
}

