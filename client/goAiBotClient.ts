/**
 * 클라이언트 측 경량 바둑 AI
 * 싱글플레이 게임에서 서버 부하를 최소화하기 위해 클라이언트에서 AI 수를 계산
 * 서버는 최종 수만 검증하여 처리
 */

import { Player, Point, BoardState } from '../types/index.js';

interface SimpleAiMove {
    x: number;
    y: number;
}

/**
 * 매우 간단한 바둑 AI (클라이언트 측)
 * 서버 부하 없이 빠르게 수를 계산
 */
export function calculateSimpleAiMove(
    boardState: BoardState,
    aiPlayer: Player,
    opponentPlayer: Player,
    koInfo: { point: Point; turn: number } | null,
    moveHistoryLength: number,
    difficulty: number = 1
): SimpleAiMove | null {
    const boardSize = boardState.length;
    const validMoves: Array<{ move: Point; score: number }> = [];

    // 1. 간단한 유효한 수 찾기 (주변만 검사)
    const checkedPoints = new Set<string>();
    const occupiedPoints: Point[] = [];

    // 기존 돌 위치 찾기
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (boardState[y][x] !== Player.None) {
                occupiedPoints.push({ x, y });
            }
        }
    }

    // 주변 위치만 검사 (성능 최적화)
    const candidates: Point[] = [];
    if (occupiedPoints.length > 0) {
        for (const point of occupiedPoints) {
            const neighbors = getNeighbors(point.x, point.y, boardSize);
            for (const neighbor of neighbors) {
                const key = `${neighbor.x},${neighbor.y}`;
                // 빈 칸만 후보로 추가 (이미 돌이 있는 위치는 제외)
                if (!checkedPoints.has(key)) {
                    const stoneAtPos = boardState[neighbor.y]?.[neighbor.x];
                    if (stoneAtPos === Player.None) {
                        checkedPoints.add(key);
                        candidates.push(neighbor);
                    }
                }
            }
        }
    } else {
        // 빈 보드: 중앙 영역만
        const centerStart = Math.floor(boardSize / 2) - 1;
        const centerEnd = Math.floor(boardSize / 2) + 2;
        for (let y = Math.max(0, centerStart); y < Math.min(boardSize, centerEnd); y++) {
            for (let x = Math.max(0, centerStart); x < Math.min(boardSize, centerEnd); x++) {
                if (boardState[y][x] === Player.None) {
                    candidates.push({ x, y });
                }
            }
        }
    }

    // 2. 각 후보 수에 대한 간단한 점수 계산
    for (const candidate of candidates) {
        // Ko 체크
        if (koInfo && koInfo.point.x === candidate.x && koInfo.point.y === candidate.y && koInfo.turn === moveHistoryLength) {
            continue;
        }

        // 자살수 체크: 자유도가 0이고 상대 돌을 따낼 수 없는 경우 자살수
        const libertyCount = countLiberties(boardState, candidate, aiPlayer, boardSize);
        const captureScore = checkCaptureOpportunity(boardState, candidate, aiPlayer, opponentPlayer, boardSize);
        
        // 자유도가 0이고 상대 돌을 따낼 수 없으면 자살수이므로 제외
        if (libertyCount === 0 && captureScore === 0) {
            continue; // 자살수 필터링
        }

        let score = 0;

        // 즉시 따내기 기회 확인 (최우선)
        if (captureScore > 0) {
            score += 8000 + captureScore * 800; // 매우 높은 점수 (더 공격적)
        }

        // 아타리(단수) 기회 확인
        const atariScore = checkAtariOpportunity(boardState, candidate, aiPlayer, opponentPlayer, boardSize);
        if (atariScore > 0) {
            score += 3500 + atariScore * 350; // 높은 점수 (더 공격적)
        }

        // 연결과 안정성 확인 (생사 개념)
        const connectionScore = checkConnectionAndStability(boardState, candidate, aiPlayer, boardSize);
        score += connectionScore * 250; // 연결과 안정성에 높은 점수

        // 유저 돌 근처로 접근 (공격적 접근)
        const proximityScore = checkProximityToOpponent(boardState, candidate, opponentPlayer, boardSize);
        score += proximityScore * 400; // 유저 돌 근처로 가는 수에 높은 점수 (더 공격적)

        // 유저 그룹 위협 (자유도 감소)
        const threatScore = checkThreatToOpponent(boardState, candidate, aiPlayer, opponentPlayer, boardSize);
        score += threatScore * 500; // 유저 그룹을 위협하는 수에 높은 점수 (더 공격적)

        // 기본 안전성 (간단한 자유도 체크) - 낮은 가중치
        if (libertyCount >= 3) score += 50;
        else if (libertyCount >= 2) score += 30;
        else if (libertyCount >= 1) score += 15;

        // 난이도에 따른 랜덤성 추가
        if (difficulty <= 3 && Math.random() < 0.3) {
            score *= 0.5; // 낮은 난이도는 가끔 나쁜 수 선택
        }

        validMoves.push({ move: candidate, score });
    }

    if (validMoves.length === 0) {
        return null; // 패스
    }

    // 점수 순으로 정렬
    validMoves.sort((a, b) => b.score - a.score);

    // 상위 3개 중에서 선택 (약간의 랜덤성)
    const topMoves = validMoves.slice(0, Math.min(3, validMoves.length));
    const selected = topMoves[Math.floor(Math.random() * topMoves.length)];

    return { x: selected.move.x, y: selected.move.y };
}

/**
 * 이웃 위치 가져오기
 */
function getNeighbors(x: number, y: number, boardSize: number): Point[] {
    const neighbors: Point[] = [];
    if (x > 0) neighbors.push({ x: x - 1, y });
    if (x < boardSize - 1) neighbors.push({ x: x + 1, y });
    if (y > 0) neighbors.push({ x, y: y - 1 });
    if (y < boardSize - 1) neighbors.push({ x, y: y + 1 });
    return neighbors;
}

/**
 * 따내기 기회 확인 (간단한 버전)
 */
function checkCaptureOpportunity(
    boardState: BoardState,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player,
    boardSize: number
): number {
    let captureCount = 0;
    const neighbors = getNeighbors(point.x, point.y, boardSize);

    for (const neighbor of neighbors) {
        if (boardState[neighbor.y][neighbor.x] === opponentPlayer) {
            const group = findGroup(boardState, neighbor.x, neighbor.y, opponentPlayer, boardSize);
            if (group && group.liberties === 1) {
                captureCount += group.stones.length;
            }
        }
    }

    return captureCount;
}

/**
 * 아타리(단수) 기회 확인
 */
function checkAtariOpportunity(
    boardState: BoardState,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player,
    boardSize: number
): number {
    const neighbors = getNeighbors(point.x, point.y, boardSize);
    let atariCount = 0;

    for (const neighbor of neighbors) {
        if (boardState[neighbor.y][neighbor.x] === opponentPlayer) {
            const group = findGroup(boardState, neighbor.x, neighbor.y, opponentPlayer, boardSize);
            if (group && group.liberties === 2) {
                atariCount += group.stones.length; // 그룹 크기도 고려
            }
        }
    }

    return atariCount;
}

/**
 * 유저 돌과의 근접성 확인 (공격적 접근)
 */
function checkProximityToOpponent(
    boardState: BoardState,
    point: Point,
    opponentPlayer: Player,
    boardSize: number
): number {
    let minDistance = Infinity;
    let nearbyOpponentStones = 0;

    // 모든 유저 돌과의 최단 거리 계산
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (boardState[y][x] === opponentPlayer) {
                const distance = Math.abs(point.x - x) + Math.abs(point.y - y);
                minDistance = Math.min(minDistance, distance);
                
                // 근처의 유저 돌 개수 (거리 2 이내)
                if (distance <= 2) {
                    nearbyOpponentStones++;
                }
            }
        }
    }

    // 거리가 가까울수록 높은 점수
    if (minDistance === Infinity) return 0.0; // 유저 돌이 없음
    if (minDistance === 1) return 3.0; // 바로 인접 (최고 점수)
    if (minDistance === 2) return 2.0; // 2칸 거리
    if (minDistance === 3) return 1.0; // 3칸 거리
    if (minDistance === 4) return 0.5; // 4칸 거리
    if (minDistance >= 5) return 0.1; // 멀면 낮은 점수

    // 근처에 유저 돌이 많을수록 더 높은 점수
    return Math.min(3.0, nearbyOpponentStones / 1.5);
}

/**
 * 유저 그룹 위협 확인 (자유도 감소)
 */
function checkThreatToOpponent(
    boardState: BoardState,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player,
    boardSize: number
): number {
    // 임시로 돌을 놓고 유저 그룹의 자유도 확인
    const tempBoard = boardState.map(row => [...row]);
    tempBoard[point.y][point.x] = aiPlayer;

    const neighbors = getNeighbors(point.x, point.y, boardSize);
    let threatScore = 0;

    for (const neighbor of neighbors) {
        if (tempBoard[neighbor.y][neighbor.x] === opponentPlayer) {
            const group = findGroup(tempBoard, neighbor.x, neighbor.y, opponentPlayer, boardSize);
            if (group) {
                const libertyCount = group.liberties;
                const groupSize = group.stones.length;
                // 자유도가 적을수록 위협적, 그룹이 클수록 더 위협적
                if (libertyCount === 1) {
                    threatScore += 8.0 + groupSize * 0.5; // 다음 턴에 잡을 수 있음
                } else if (libertyCount === 2) {
                    threatScore += 5.0 + groupSize * 0.3; // 2턴 안에 잡을 수 있음
                } else if (libertyCount === 3) {
                    threatScore += 2.5 + groupSize * 0.2; // 위협적
                } else if (libertyCount === 4) {
                    threatScore += 1.0 + groupSize * 0.1; // 약간 위협적
                }
            }
        }
    }

    return threatScore;
}

/**
 * 연결과 안정성 확인 (생사 개념)
 */
function checkConnectionAndStability(
    boardState: BoardState,
    point: Point,
    aiPlayer: Player,
    boardSize: number
): number {
    // 임시로 돌을 놓고 연결 상태 확인
    const tempBoard = boardState.map(row => [...row]);
    tempBoard[point.y][point.x] = aiPlayer;

    const neighbors = getNeighbors(point.x, point.y, boardSize);
    let connectionScore = 0;
    let connectedGroups: Array<{ stones: Point[]; liberties: number }> = [];

    // 인접한 AI 그룹 찾기
    for (const neighbor of neighbors) {
        if (tempBoard[neighbor.y][neighbor.x] === aiPlayer) {
            const group = findGroup(tempBoard, neighbor.x, neighbor.y, aiPlayer, boardSize);
            if (group) {
                // 중복 그룹 체크
                const isNewGroup = !connectedGroups.some(g => 
                    g.stones.some(s => group.stones.some(gs => gs.x === s.x && gs.y === s.y))
                );
                if (isNewGroup) {
                    connectedGroups.push(group);
                }
            }
        }
    }

    // 연결된 그룹이 있으면 안정성 증가
    if (connectedGroups.length > 0) {
        const totalStones = connectedGroups.reduce((sum, g) => sum + g.stones.length, 0);
        const minLiberties = Math.min(...connectedGroups.map(g => g.liberties));
        
        // 연결된 그룹이 많을수록, 자유도가 많을수록 안정적
        connectionScore += connectedGroups.length * 2.0;
        connectionScore += totalStones * 0.3;
        connectionScore += minLiberties * 1.5;
    }

    // 고립된 돌이 되지 않도록 (단독 돌은 위험)
    if (connectedGroups.length === 0) {
        connectionScore -= 1.0; // 고립된 돌은 약간 감점
    }

    return Math.max(0, connectionScore);
}

/**
 * 자유도 계산 (간단한 버전)
 * 돌을 놓고 상대 돌을 따낸 후의 자유도를 계산
 */
function countLiberties(
    boardState: BoardState,
    point: Point,
    player: Player,
    boardSize: number
): number {
    // 임시로 돌을 놓고 자유도 확인
    const tempBoard = boardState.map(row => [...row]);
    tempBoard[point.y][point.x] = player;

    const opponentPlayer = player === Player.Black ? Player.White : Player.Black;
    
    // 상대 돌을 따낼 수 있는지 확인 (인접한 상대 그룹의 자유도가 1이면 따냄)
    const neighbors = getNeighbors(point.x, point.y, boardSize);
    for (const neighbor of neighbors) {
        if (tempBoard[neighbor.y][neighbor.x] === opponentPlayer) {
            const opponentGroup = findGroup(tempBoard, neighbor.x, neighbor.y, opponentPlayer, boardSize);
            if (opponentGroup && opponentGroup.liberties === 0) {
                // 상대 그룹을 따냄 (임시 보드에서 제거)
                for (const stone of opponentGroup.stones) {
                    tempBoard[stone.y][stone.x] = Player.None;
                }
            }
        }
    }

    // 상대 돌을 따낸 후 자신의 그룹의 자유도 확인
    const group = findGroup(tempBoard, point.x, point.y, player, boardSize);
    return group ? group.liberties : 0;
}

/**
 * 그룹 찾기 (간단한 버전)
 */
function findGroup(
    boardState: BoardState,
    startX: number,
    startY: number,
    player: Player,
    boardSize: number
): { stones: Point[]; liberties: number } | null {
    if (boardState[startY][startX] !== player) {
        return null;
    }

    const stones: Point[] = [];
    const visited = new Set<string>();
    const queue: Point[] = [{ x: startX, y: startY }];

    while (queue.length > 0) {
        const current = queue.shift()!;
        const key = `${current.x},${current.y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (boardState[current.y][current.x] === player) {
            stones.push(current);
            const neighbors = getNeighbors(current.x, current.y, boardSize);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (!visited.has(neighborKey)) {
                    queue.push(neighbor);
                }
            }
        }
    }

    // 자유도 계산
    const libertySet = new Set<string>();
    for (const stone of stones) {
        const neighbors = getNeighbors(stone.x, stone.y, boardSize);
        for (const neighbor of neighbors) {
            if (boardState[neighbor.y][neighbor.x] === Player.None) {
                libertySet.add(`${neighbor.x},${neighbor.y}`);
            }
        }
    }

    return { stones, liberties: libertySet.size };
}

