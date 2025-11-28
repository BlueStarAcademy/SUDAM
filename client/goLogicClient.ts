/**
 * 클라이언트 측 바둑 로직
 * 도전의 탑 게임에서 클라이언트에서만 실행되도록 서버 부하를 최소화
 */

import { Player, Point, BoardState } from '../types/index.js';

export interface ProcessMoveResult {
    isValid: boolean;
    newBoardState: BoardState;
    capturedStones: Point[];
    newKoInfo: { point: Point; turn: number } | null;
    reason?: 'ko' | 'suicide' | 'occupied';
}

/**
 * 클라이언트 측 move 처리 함수 (서버의 processMove와 동일한 로직)
 */
export function processMoveClient(
    boardState: BoardState,
    move: { x: number, y: number, player: Player },
    koInfo: { point: Point; turn: number } | null,
    moveHistoryLength: number,
    options?: { ignoreSuicide?: boolean, isSinglePlayer?: boolean, opponentPlayer?: Player }
): ProcessMoveResult {
    const { x, y, player } = move;
    const boardSize = boardState.length;
    const opponent = player === Player.Black ? Player.White : Player.Black;

    // 치명적 버그 방지: 패 위치(-1, -1)에 돌을 놓으려는 시도 차단
    if (x === -1 || y === -1) {
        console.error(`[processMoveClient] CRITICAL BUG PREVENTION: Attempted to place stone at pass position (${x}, ${y}), player=${player}`);
        return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }

    // 치명적 버그 방지: 보드 범위를 벗어나는 위치에 돌을 놓으려는 시도 차단
    if (y < 0 || y >= boardSize || x < 0 || x >= boardSize) {
        console.error(`[processMoveClient] CRITICAL BUG PREVENTION: Attempted to place stone out of bounds (${x}, ${y}), boardSize=${boardSize}, player=${player}`);
        return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }

    // 치명적 버그 방지: 자신의 돌 위에 착점하는 것을 최우선으로 차단
    const stoneAtPosition = boardState[y][x];
    if (stoneAtPosition === player) {
        console.error(`[processMoveClient] CRITICAL BUG PREVENTION: Attempted to place stone on own stone at (${x}, ${y}), player=${player}, boardState[${y}][${x}]=${stoneAtPosition}`);
        return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }
    
    // 싱글플레이 모드에서 상대방(AI) 돌 위에 놓는 것을 차단
    if (options?.isSinglePlayer && options?.opponentPlayer) {
        if (stoneAtPosition === options.opponentPlayer) {
            console.error(`[processMoveClient] CRITICAL BUG PREVENTION: Attempted to place stone on opponent (AI) stone in single player mode at (${x}, ${y}), player=${player}, opponent=${options.opponentPlayer}, boardState[${y}][${x}]=${stoneAtPosition}`);
            return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
        }
    }

    // PVP 모드에서도 상대방 돌 위에 착점하는 것을 명시적으로 차단
    if (!options?.isSinglePlayer && stoneAtPosition === opponent) {
        console.error(`[processMoveClient] CRITICAL BUG PREVENTION: Attempted to place stone on opponent stone in PVP mode at (${x}, ${y}), player=${player}, opponent=${opponent}, boardState[${y}][${x}]=${stoneAtPosition}`);
        return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }

    // 일반적인 빈 칸 체크 (모든 경우에 적용)
    if (stoneAtPosition !== Player.None) {
        return { isValid: false, reason: 'occupied', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }
    
    // 코 금지 체크
    if (koInfo && koInfo.point.x === x && koInfo.point.y === y && koInfo.turn === moveHistoryLength) {
        return { isValid: false, reason: 'ko', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }

    const tempBoard = JSON.parse(JSON.stringify(boardState));
    tempBoard[y][x] = player;

    const getNeighbors = (px: number, py: number) => {
        const neighbors: Point[] = [];
        if (px > 0) neighbors.push({ x: px - 1, y: py });
        if (px < boardSize - 1) neighbors.push({ x: px + 1, y: py });
        if (py > 0) neighbors.push({ x: px, y: py - 1 });
        if (py < boardSize - 1) neighbors.push({ x: px, y: py + 1 });
        return neighbors;
    };

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
        return { stones, liberties: libertyPoints.size };
    };

    let capturedStones: Point[] = [];
    let singleCapturePoint: Point | null = null;
    const checkedOpponentNeighbors = new Set<string>();

    for (const n of getNeighbors(x, y)) {
        const key = `${n.x},${n.y}`;
        if (tempBoard[n.y][n.x] === opponent && !checkedOpponentNeighbors.has(key)) {
            const group = findGroup(n.x, n.y, opponent, tempBoard);
            if (group && group.liberties === 0) {
                capturedStones.push(...group.stones);
                if (group.stones.length === 1) {
                    singleCapturePoint = group.stones[0];
                }
                group.stones.forEach(s => checkedOpponentNeighbors.add(`${s.x},${s.y}`));
            }
        }
    }

    if (capturedStones.length > 0) {
        for (const stone of capturedStones) {
            tempBoard[stone.y][stone.x] = Player.None;
        }
    }

    const myGroup = findGroup(x, y, player, tempBoard);
    if (!options?.ignoreSuicide && myGroup && myGroup.liberties === 0) {
        return { isValid: false, reason: 'suicide', newBoardState: boardState, capturedStones: [], newKoInfo: koInfo };
    }

    let newKoInfo: { point: Point; turn: number } | null = null;
    if (myGroup && capturedStones.length === 1 && myGroup.stones.length === 1 && myGroup.liberties === 1) {
        newKoInfo = { point: singleCapturePoint!, turn: moveHistoryLength + 1 };
    }

    return { isValid: true, newBoardState: tempBoard, capturedStones, newKoInfo };
}

