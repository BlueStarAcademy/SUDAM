import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, LiveGameSession, Player, GameMode, Point, BoardState, SinglePlayerStageInfo, UserStatus, GameCategory } from '../../types/index.js';
import { TOWER_STAGES } from '../../constants/towerConstants.js';
import { getAiUser } from '../aiPlayer.js';
import { broadcast } from '../socket.js';
import { processMove } from '../goLogic.js';

type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

// Helper function to check if a stone placement would result in immediate capture
const wouldBeImmediatelyCaptured = (board: BoardState, x: number, y: number, player: Player): boolean => {
    // Try placing the stone
    const result = processMove(
        board,
        { x, y, player },
        null, // no ko info for initial placement
        0, // move history length
        { ignoreSuicide: true } // allow suicide for initial check
    );

    if (!result.isValid) {
        return true; // Invalid move, skip this position
    }

    // Check if the placed stone's group has only one liberty
    // If so, check if opponent can capture it by playing at that liberty
    const opponent = player === Player.Black ? Player.White : Player.Black;
    const boardSize = board.length;
    
    // Get neighbors of the placed stone
    const getNeighbors = (px: number, py: number) => {
        const neighbors = [];
        if (px > 0) neighbors.push({ x: px - 1, y: py });
        if (px < boardSize - 1) neighbors.push({ x: px + 1, y: py });
        if (py > 0) neighbors.push({ x: px, y: py - 1 });
        if (py < boardSize - 1) neighbors.push({ x: px, y: py + 1 });
        return neighbors;
    };

    // Find the group containing the placed stone
    const findGroup = (startX: number, startY: number, playerColor: Player, currentBoard: BoardState) => {
        if (currentBoard[startY]?.[startX] !== playerColor) return null;
        const q: Point[] = [{ x: startX, y: startY }];
        const visitedStones = new Set([`${startX},${startY}`]);
        const libertyPoints = new Set<string>();
        const stones: Point[] = [{ x: startX, y: startY }];

        while (q.length > 0) {
            const { x: cx, y: cy } = q.shift()!;
            for (const n of getNeighbors(cx, cy)) {
                const key = `${n.x},${n.y}`;
                const neighborContent = currentBoard[n.y][n.x];

                if (neighborContent === Player.None) {
                    libertyPoints.add(key);
                } else if (neighborContent === playerColor) {
                    if (!visitedStones.has(key)) {
                        visitedStones.add(key);
                        q.push(n);
                        stones.push(n);
                    }
                }
            }
        }
        return { stones, liberties: Array.from(libertyPoints).map(k => {
            const [nx, ny] = k.split(',').map(Number);
            return { x: nx, y: ny };
        }) };
    };

    const myGroup = findGroup(x, y, player, result.newBoardState);
    if (!myGroup) {
        return true; // Couldn't find group, skip
    }

    // If the group has only one liberty, check if opponent can capture by playing there
    if (myGroup.liberties.length === 1) {
        const liberty = myGroup.liberties[0];
        const opponentResult = processMove(
            result.newBoardState,
            { x: liberty.x, y: liberty.y, player: opponent },
            null,
            1,
            { ignoreSuicide: false }
        );

        // If opponent can capture our stone by playing at the liberty, it's a bad placement
        if (opponentResult.isValid && opponentResult.capturedStones.some(s => s.x === x && s.y === y)) {
            return true;
        }
    }

    return false;
};

// Helper function to place stones randomly without overlap and without immediate capture
const placeStonesOnBoard = (board: BoardState, boardSize: number, count: number, player: Player): Point[] => {
    const placedStones: Point[] = [];
    let placedCount = 0;
    let attempts = 0;
    while (placedCount < count && attempts < 200) {
        attempts++;
        const x = Math.floor(Math.random() * boardSize);
        const y = Math.floor(Math.random() * boardSize);
        if (board[y][x] === Player.None) {
            // Check if this placement would result in immediate capture
            if (wouldBeImmediatelyCaptured(board, x, y, player)) {
                continue; // Skip this position
            }
            board[y][x] = player;
            placedStones.push({ x, y });
            placedCount++;
        }
    }
    return placedStones;
};

// Helper function to place pattern stones randomly without overlap
const placePatternStonesOnBoard = (board: BoardState, boardSize: number, count: number, player: Player, existingStones: Point[]): Point[] => {
    const placedStones: Point[] = [];
    let placedCount = 0;
    let attempts = 0;
    while (placedCount < count && attempts < 200) {
        attempts++;
        const x = Math.floor(Math.random() * boardSize);
        const y = Math.floor(Math.random() * boardSize);
        if (board[y][x] === Player.None && !existingStones.some(s => s.x === x && s.y === y)) {
            placedStones.push({ x, y });
            placedCount++;
        }
    }
    return placedStones;
};

const generateTowerBoard = (stage: SinglePlayerStageInfo): { board: BoardState, blackPattern: Point[], whitePattern: Point[] } => {
    const board = Array(stage.boardSize).fill(null).map(() => Array(stage.boardSize).fill(Player.None));
    
    // 흑돌 배치
    const blackStones = placeStonesOnBoard(board, stage.boardSize, stage.placements.black, Player.Black);
    
    // 백돌 배치
    const whiteStones = placeStonesOnBoard(board, stage.boardSize, stage.placements.white, Player.White);
    
    // 흑 문양돌 배치
    const blackPattern = placePatternStonesOnBoard(board, stage.boardSize, stage.placements.blackPattern, Player.Black, blackStones);
    
    // 백 문양돌 배치
    const whitePattern = placePatternStonesOnBoard(board, stage.boardSize, stage.placements.whitePattern, Player.White, whiteStones);
    
    return { board, blackPattern, whitePattern };
};

// AI 레벨 결정 (도전의 탑은 층수에 따라 AI 레벨 설정)
const getAiLevelFromFloor = (floor: number): number => {
    if (floor <= 20) return 8; // 1-20층: 8단계
    if (floor <= 60) return 9; // 21-60층: 9단계
    return 10; // 61-100층: 10단계
};

export const handleTowerAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    const now = Date.now();

    switch(type) {
        case 'START_TOWER_GAME': {
            const { floor } = payload;
            const stage = TOWER_STAGES.find(s => {
                const stageFloor = parseInt(s.id.replace('tower-', ''));
                return stageFloor === floor;
            });

            if (!stage) {
                return { error: 'Stage not found.' };
            }
            
            // 관리자 여부 확인
            const isAdmin = user.isAdmin ?? false;
            
            // 잠금 검증: 1층은 항상 열림, 2층 이상은 이전 층이 클리어되어야 함 (관리자는 예외)
            const userTowerFloor = (user as any).towerFloor ?? 0;
            const isLocked = !isAdmin && floor > 1 && floor > userTowerFloor + 1;
            
            if (isLocked) {
                return { error: `아래층을 먼저 클리어해야 합니다. (현재 클리어: ${userTowerFloor}층)` };
            }
            
            // 클리어한 층은 행동력 소모가 0
            const isCleared = floor <= userTowerFloor;
            const effectiveActionPointCost = isCleared ? 0 : stage.actionPointCost;
            
            if (user.actionPoints.current < effectiveActionPointCost) {
                return { error: `액션 포인트가 부족합니다. (필요: ${effectiveActionPointCost})` };
            }

            // 행동력 소모 (클리어한 층은 0)
            if (effectiveActionPointCost > 0) {
                user.actionPoints.current -= effectiveActionPointCost;
                user.lastActionPointUpdate = now;
            }
            
            // 게임 모드 결정
            let gameMode: GameMode;
            const isSpeedMode = stage.timeControl.type === 'fischer';

            if (stage.autoScoringTurns && stage.missileCount && stage.hiddenCount) {
                // 자동계가 + 미사일 + 히든 합쳐진 형태
                gameMode = GameMode.Mix;
            } else if (stage.hiddenCount !== undefined) {
                gameMode = GameMode.Hidden;
            } else if (stage.missileCount !== undefined) {
                gameMode = GameMode.Missile;
            } else if (stage.blackTurnLimit !== undefined || stage.targetScore) {
                // 따내기 바둑: blackTurnLimit이 있거나 targetScore가 있는 경우
                gameMode = GameMode.Capture;
            } else if (isSpeedMode) {
                gameMode = GameMode.Speed;
            } else {
                gameMode = GameMode.Standard;
            }

            // 도전의 탑용 AI 유저 생성
            const aiLevel = getAiLevelFromFloor(floor);
            const botNickname = `탑봇 Lv.${floor}`;
            const botLevel = aiLevel * 10;
            
            const aiUser = {
                ...getAiUser(gameMode),
                nickname: botNickname,
                strategyLevel: botLevel,
                playfulLevel: botLevel,
            };
            
            const { board, blackPattern, whitePattern } = generateTowerBoard(stage);

            // 시간룰 설정: 스피드바둑은 피셔, 나머지는 1분+초읽기30초 3회
			const enforcedMainTimeMinutes = isSpeedMode ? (stage.timeControl.mainTime ?? 5) : 1;
            const enforcedByoyomiTimeSeconds = isSpeedMode ? (stage.timeControl.byoyomiTime ?? 0) : 30;
            const enforcedByoyomiCount = isSpeedMode ? 0 : 3;
            const enforcedIncrement = isSpeedMode ? (stage.timeControl.increment ?? 0) : 0;

            const gameId = `tower-game-${randomUUID()}`;
            const baseCaptureTargetBlack = stage.targetScore?.black && stage.targetScore.black > 0 ? stage.targetScore.black : 999;
            const baseCaptureTargetWhite = stage.targetScore?.white && stage.targetScore.white > 0 ? stage.targetScore.white : 999;

            // Mix 모드인 경우 mixedModes 설정
            const mixedModes: GameMode[] = [];
            if (stage.autoScoringTurns && stage.missileCount && stage.hiddenCount) {
                mixedModes.push(GameMode.Missile, GameMode.Hidden);
            }

            const game: LiveGameSession = {
                id: gameId,
                mode: gameMode,
                isSinglePlayer: false, // 도전의 탑은 별도 카테고리
                gameCategory: 'tower' as GameCategory,
                stageId: stage.id,
                towerFloor: floor,
                isAiGame: true,
                settings: {
                    boardSize: stage.boardSize,
                    komi: 0.5,
                    timeLimit: enforcedMainTimeMinutes,
                    byoyomiTime: enforcedByoyomiTimeSeconds,
                    byoyomiCount: enforcedByoyomiCount,
                    timeIncrement: enforcedIncrement,
                    captureTarget: stage.targetScore?.black,
                    aiDifficulty: aiLevel,
                    blackTurnLimit: stage.blackTurnLimit,
                    autoScoringTurns: stage.autoScoringTurns,
                    hiddenStoneCount: stage.hiddenCount,
                    scanCount: stage.scanCount,
                    missileCount: stage.missileCount,
                    mixedModes: mixedModes.length > 0 ? mixedModes : undefined,
                } as any,
                player1: user,
                player2: aiUser,
                blackPlayerId: user.id,
                whitePlayerId: aiUser.id,
                gameStatus: 'pending',
                currentPlayer: Player.Black,
                boardState: board,
                blackPatternStones: blackPattern,
                whitePatternStones: whitePattern,
                moveHistory: [],
                captures: { [Player.Black]: 0, [Player.White]: 0, [Player.None]: 0 },
                baseStoneCaptures: { [Player.Black]: 0, [Player.White]: 0, [Player.None]: 0 },
                hiddenStoneCaptures: { [Player.Black]: 0, [Player.White]: 0, [Player.None]: 0 },
                koInfo: null,
                lastMove: null,
                createdAt: now,
                startTime: undefined,
                endTime: undefined,
                serverRevision: 0,
                totalTurns: 0,
            };

            // 1~20층: 따내기 목표점수 직접 설정(입찰 생략, 흑은 사용자 고정)
            if (gameMode === GameMode.Capture) {
                const blackTarget = stage.targetScore?.black && stage.targetScore.black > 0 ? stage.targetScore.black : 999;
                const whiteTarget = stage.targetScore?.white && stage.targetScore.white > 0 ? stage.targetScore.white : 999;
                (game as any).effectiveCaptureTargets = {
                    [Player.None]: 0,
                    [Player.Black]: blackTarget,
                    [Player.White]: whiteTarget
                };
                // 캡처 모드의 사전 단계(입찰/공개)를 사용하지 않고 바로 플레이로 전환할 수 있도록 준비
                // 실제 시작은 CONFIRM_TOWER_GAME_START에서 처리
            }

            await db.saveGame(game);
            
            volatileState.userStatuses[game.player1.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id, gameCategory: 'tower' as GameCategory };
            // AI 플레이어는 userStatuses에 포함하지 않음 (실제 유저가 아니므로)
            
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(user).catch(err => {
                console.error(`[START_TOWER_GAME] Failed to save user ${user.id}:`, err);
            });
            
            // 게임 생성 후 게임 정보를 먼저 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants, broadcastUserUpdate } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            // 그 다음 사용자 상태 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            broadcastUserUpdate(user);

            return {
                clientResponse: {
                    gameId: game.id,
                    game: game
                }
            };
        }
        case 'CONFIRM_TOWER_GAME_START': {
            const { gameId } = payload;
            if (!gameId || typeof gameId !== 'string') {
                console.error('[CONFIRM_TOWER_GAME_START] Invalid gameId:', { gameId, payload, userId: user.id });
                return { error: 'Invalid gameId in payload.' };
            }
            
            const game = await db.getLiveGame(gameId);
            if (!game) {
                console.error('[CONFIRM_TOWER_GAME_START] Game not found:', { gameId, userId: user.id });
                return { error: 'Game not found.' };
            }
            
            if (game.gameCategory !== 'tower') {
                console.error('[CONFIRM_TOWER_GAME_START] Not a tower game:', { gameId, gameCategory: game.gameCategory, userId: user.id });
                return { error: 'Not a tower game.' };
            }
            
            if (game.gameStatus !== 'pending') {
                console.warn('[CONFIRM_TOWER_GAME_START] Game already started:', { gameId, gameStatus: game.gameStatus, userId: user.id });
                return { error: `Game already started. Current status: ${game.gameStatus}` };
            }
            
            console.log('[CONFIRM_TOWER_GAME_START] Starting tower game:', { gameId, floor: game.towerFloor, userId: user.id });
            
            game.gameStatus = 'playing';
            game.startTime = now;
            // currentPlayer를 Black으로 설정 (유저가 항상 Black으로 시작)
            game.currentPlayer = Player.Black;
            
            if (game.settings.timeLimit > 0) {
                const blackTimeLeft = game.settings.timeLimit * 60;
                const whiteTimeLeft = game.settings.timeLimit * 60;
                game.blackTimeLeft = blackTimeLeft;
                game.whiteTimeLeft = whiteTimeLeft;
                // 초읽기 횟수 초기화
                game.blackByoyomiPeriodsLeft = game.settings.byoyomiCount ?? 3;
                game.whiteByoyomiPeriodsLeft = game.settings.byoyomiCount ?? 3;
                game.turnStartTime = now;
                game.turnDeadline = now + blackTimeLeft * 1000;
            } else {
                // 시간 제한이 없어도 turnStartTime은 설정
                game.turnStartTime = now;
            }
            
            await db.saveGame(game);
            
            // 사용자 상태 업데이트
            volatileState.userStatuses[game.player1.id] = { status: UserStatus.InGame, mode: game.mode, gameId: game.id, gameCategory: 'tower' as GameCategory };
            
            // 게임 업데이트 먼저 브로드캐스트 (게임 참가자에게만 전송)
            const { broadcastToGameParticipants } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            // 그 다음 사용자 상태 브로드캐스트
            broadcast({ type: 'USER_STATUS_UPDATE', payload: volatileState.userStatuses });
            
            // 게임 객체를 응답에 포함하여 클라이언트가 즉시 업데이트할 수 있도록 함
            return {
                clientResponse: {
                    gameId: game.id,
                    game: game
                }
            };
            
            // 클라이언트가 즉시 게임 상태를 업데이트할 수 있도록 게임 데이터를 응답에 포함
            const gameCopy = JSON.parse(JSON.stringify(game));
            return { clientResponse: { gameId: game.id, game: gameCopy } };
        }
        case 'TOWER_REFRESH_PLACEMENT': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) {
                return { error: 'Game not found.' };
            }
            
            if (game.gameCategory !== 'tower') {
                return { error: 'Not a tower game.' };
            }
            
            // 첫 수를 두기 전에만 배치변경 가능
            if (game.gameStatus !== 'playing' || game.currentPlayer !== Player.Black || (game.moveHistory && game.moveHistory.length > 0)) {
                return { error: '배치는 첫 수 전에만 새로고침할 수 있습니다.' };
            }
            
            // 배치변경 아이템 사용 가능 여부 확인 및 소모
            const itemName = '배치 새로고침';
            const inventory = user.inventory || [];
            const itemIndex = inventory.findIndex((item: any) => 
                item.name === itemName || item.name === '배치변경' || item.id === 'reflesh' || item.id === 'refresh'
            );
            
            if (itemIndex === -1) {
                return { error: '배치 새로고침 아이템이 없습니다.' };
            }
            
            const item = inventory[itemIndex];
            if ((item.quantity || 1) <= 0) {
                return { error: '배치 새로고침 아이템이 없습니다.' };
            }
            
            // 아이템 개수 감소
            if ((item.quantity || 1) > 1) {
                item.quantity = (item.quantity || 1) - 1;
            } else {
                inventory.splice(itemIndex, 1);
            }
            
            const stage = TOWER_STAGES.find(s => s.id === game.stageId);
            if (!stage) {
                return { error: 'Stage data not found for refresh.' };
            }

            const { board, blackPattern, whitePattern } = generateTowerBoard(stage);
            game.boardState = board;
            game.blackPatternStones = blackPattern;
            game.whitePatternStones = whitePattern;

            await db.saveGame(game);
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[TOWER_BATTLE] Failed to save user ${user.id}:`, err);
            });

            const { broadcastToGameParticipants, broadcastUserUpdate } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            broadcastUserUpdate(user, ['actionPoints', 'towerFloor']);
            
            return { clientResponse: { updatedUser: user } };
        }
        case 'TOWER_ADD_TURNS': {
            const { gameId } = payload;
            const game = await db.getLiveGame(gameId);
            if (!game) {
                return { error: 'Game not found.' };
            }
            
            if (game.gameCategory !== 'tower') {
                return { error: 'Not a tower game.' };
            }
            
            // 1~20층에서만 사용 가능
            const floor = game.towerFloor ?? 1;
            if (floor > 20) {
                return { error: '턴 추가 아이템은 1~20층에서만 사용 가능합니다.' };
            }
            
            if (game.gameStatus !== 'playing') {
                return { error: '게임이 진행 중이 아닙니다.' };
            }
            
            // 턴 추가 아이템 사용 가능 여부 확인 및 소모
            const itemName = '턴 추가';
            const inventory = user.inventory || [];
            const itemIndex = inventory.findIndex((item: any) => 
                item.name === itemName || 
                item.name === '턴증가' || 
                item.id === 'turn_add' || 
                item.id === 'turn_add_item'
            );
            
            if (itemIndex === -1) {
                return { error: '턴 추가 아이템이 없습니다.' };
            }
            
            const item = inventory[itemIndex];
            if ((item.quantity || 1) <= 0) {
                return { error: '턴 추가 아이템이 없습니다.' };
            }
            
            // 아이템 개수 감소
            if ((item.quantity || 1) > 1) {
                item.quantity = (item.quantity || 1) - 1;
            } else {
                inventory.splice(itemIndex, 1);
            }
            
            // 게임 세션에 blackTurnLimitBonus 추가 (초기화되지 않은 경우)
            if (!(game as any).blackTurnLimitBonus) {
                (game as any).blackTurnLimitBonus = 0;
            }
            
            // 3턴 추가
            (game as any).blackTurnLimitBonus += 3;

            await db.saveGame(game);
            // DB 업데이트를 비동기로 처리 (응답 지연 최소화)
            db.updateUser(user).catch(err => {
                console.error(`[TOWER_REWARD] Failed to save user ${user.id}:`, err);
            });

            const { broadcastToGameParticipants, broadcastUserUpdate } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            broadcastUserUpdate(user, ['inventory', 'gold', 'diamonds', 'towerFloor']);
            
            return { clientResponse: { updatedUser: user, game } };
        }
        case 'END_TOWER_GAME': {
            const { gameId, winner, winReason } = payload;
            if (!gameId || typeof gameId !== 'string') {
                return { error: 'Invalid gameId in payload.' };
            }
            
            const game = await db.getLiveGame(gameId);
            if (!game) {
                return { error: 'Game not found.' };
            }
            
            if (game.gameCategory !== 'tower') {
                return { error: 'Not a tower game.' };
            }
            
            // 게임이 이미 종료되었는지 확인
            if (game.gameStatus === 'ended') {
                console.log('[END_TOWER_GAME] Game already ended, ignoring:', { gameId, currentWinner: game.winner, requestedWinner: winner });
                return { clientResponse: { gameId: game.id, game } };
            }
            
            // 클라이언트에서 전달한 승자 정보를 사용 (클라이언트가 승리 조건을 정확히 체크함)
            // 단, winner가 유효한지 확인
            if (winner !== Player.Black && winner !== Player.White) {
                console.error('[END_TOWER_GAME] Invalid winner:', { gameId, winner, winReason });
                return { error: 'Invalid winner in payload.' };
            }
            
            console.log('[END_TOWER_GAME] Ending tower game:', { gameId, winner: winner === Player.Black ? 'Black' : 'White', winReason, currentCaptures: game.captures });
            
            // 게임 종료 상태 업데이트 (endGame 호출 전에 설정하지 않음 - endGame 내부에서 설정됨)
            game.winner = winner;
            game.winReason = winReason;
            game.endTime = now;
            
            // 서버에서 endGame 호출하여 클리어 정보 저장 및 towerFloor 업데이트
            // endGame 함수가 game.gameStatus를 'ended'로 설정하고 towerFloor를 업데이트함
            const { endGame } = await import('../summaryService.js');
            await endGame(game, winner, winReason);
            
            await db.saveGame(game);
            const { broadcastToGameParticipants } = await import('../socket.js');
            broadcastToGameParticipants(game.id, { type: 'GAME_UPDATE', payload: { [game.id]: game } }, game);
            
            return { clientResponse: { gameId: game.id, game } };
        }
        default:
            return { error: 'Unknown action type.' };
    }
};

