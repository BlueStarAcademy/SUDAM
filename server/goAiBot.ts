/**
 * 바둑 AI 봇 시스템
 * 싱글플레이, 도전의탑, 전략바둑에서 사용하는 1단계~10단계 바둑 AI 봇
 * KataGo를 사용하지 않고 직접 구현한 바둑 AI
 */

import { LiveGameSession, Player, Point } from '../types/index.js';
import { getGoLogic, processMove } from './goLogic.js';
import * as types from '../types/index.js';
import * as summaryService from './summaryService.js';
import { getCaptureTarget, NO_CAPTURE_TARGET } from './utils/captureTargets.ts';
import * as db from './db.js';

/**
 * AI 봇 단계별 특성 정의
 */
export interface GoAiBotProfile {
    /** AI 단계 (1~10) */
    level: number;
    /** AI 이름 */
    name: string;
    /** 설명 */
    description: string;
    /** 따내기 성향 (0.0 ~ 1.0, 높을수록 따내기에 집중) */
    captureTendency: number;
    /** 영토 확보 성향 (0.0 ~ 1.0, 높을수록 영토에 집중) */
    territoryTendency: number;
    /** 전투 성향 (0.0 ~ 1.0, 높을수록 전투 선호) */
    combatTendency: number;
    /** 정석/포석 활용도 (0.0 ~ 1.0, 높을수록 정석/포석 활용) */
    josekiUsage: number;
    /** 사활 판단 능력 (0.0 ~ 1.0, 높을수록 정확한 사활 판단) */
    lifeDeathSkill: number;
    /** 행마 능력 (0.0 ~ 1.0, 높을수록 우수한 행마) */
    movementSkill: number;
    /** 실수 확률 (0.0 ~ 1.0, 높을수록 실수 많음) */
    mistakeRate: number;
    /** 승리 목적 달성도 (0.0 ~ 1.0, 높을수록 승리에 집중) */
    winFocus: number;
    /** 계산 깊이 (1~5, 높을수록 깊이 계산) */
    calculationDepth: number;
    
    // 10단계별 바둑 기술 지식
    /** 1단계: 기본 규칙 (활로, 단수, 따내기) */
    knowsBasicRules: boolean;
    /** 2단계: 자충수 방지 */
    avoidsSelfAtari: boolean;
    /** 3단계: 먹여치기 및 환격 */
    knowsSacrificeAndCounter: boolean;
    /** 4단계: 단수 상황 판단 (따내기 vs 살리기) */
    knowsAtariJudgment: boolean;
    /** 5단계: 방향성 공격 (1선, 우리편 방향, 도망치기 힘든 방향) */
    knowsDirectionalAttack: boolean;
    /** 6단계: 초반 포석 (3-4선 선호) */
    knowsFuseki: boolean;
    /** 7단계: 영토 확보 및 전투 */
    knowsTerritoryAndCombat: boolean;
    /** 8단계: 고급 기술 (촉촉수, 축, 장문, 환격, 먹여치기) */
    knowsAdvancedTechniques: boolean;
    /** 9단계: 연결/끊음, 사활, 행마 */
    knowsConnectionLifeDeathMovement: boolean;
    /** 10단계: 마무리 (집 지키기/부수기) */
    knowsEndgame: boolean;
}

/**
 * 1단계~10단계 AI 봇 프로필 정의
 */
export const GO_AI_BOT_PROFILES: Record<number, GoAiBotProfile> = {
    1: {
        level: 1,
        name: '초급 AI (18급)',
        description: '초급단계의 18급 수준. 따내기에 집중하며 승리를 목표로 하는 AI',
        captureTendency: 0.95, // 따내기 성향 매우 강함
        territoryTendency: 0.2, // 영토 확보는 약함
        combatTendency: 0.8, // 전투 선호
        josekiUsage: 0.1, // 정석/포석 거의 사용 안함
        lifeDeathSkill: 0.2, // 사활 판단 약함
        movementSkill: 0.2, // 행마 능력 약함
        mistakeRate: 0.4, // 실수 많음
        winFocus: 0.95, // 승리에 집중
        calculationDepth: 1, // 계산 깊이 매우 낮음
        knowsBasicRules: true, // 1단계: 기본 규칙
        avoidsSelfAtari: false,
        knowsSacrificeAndCounter: false,
        knowsAtariJudgment: false,
        knowsDirectionalAttack: false,
        knowsFuseki: false,
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    2: {
        level: 2,
        name: '초급 AI (15급)',
        description: '초급단계의 15급 수준. 따내기를 선호하지만 기본적인 영토 개념 이해',
        captureTendency: 0.85,
        territoryTendency: 0.3,
        combatTendency: 0.7,
        josekiUsage: 0.15,
        lifeDeathSkill: 0.3,
        movementSkill: 0.3,
        mistakeRate: 0.35,
        winFocus: 0.9,
        calculationDepth: 1,
        knowsBasicRules: true,
        avoidsSelfAtari: true, // 2단계: 자충수 방지
        knowsSacrificeAndCounter: false,
        knowsAtariJudgment: false,
        knowsDirectionalAttack: false,
        knowsFuseki: false,
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    3: {
        level: 3,
        name: '초급 AI (12급)',
        description: '초급단계의 12급 수준. 따내기와 영토의 균형을 시작',
        captureTendency: 0.72,
        territoryTendency: 0.4,
        combatTendency: 0.6,
        josekiUsage: 0.2,
        lifeDeathSkill: 0.4,
        movementSkill: 0.4,
        mistakeRate: 0.3,
        winFocus: 0.85,
        calculationDepth: 2,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true, // 3단계: 먹여치기 및 환격
        knowsAtariJudgment: false,
        knowsDirectionalAttack: false,
        knowsFuseki: false,
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    4: {
        level: 4,
        name: '중급 AI (9급)',
        description: '중급단계의 9급 수준. 기본적인 정석과 포석 이해',
        captureTendency: 0.62,
        territoryTendency: 0.5,
        combatTendency: 0.5,
        josekiUsage: 0.3,
        lifeDeathSkill: 0.5,
        movementSkill: 0.5,
        mistakeRate: 0.25,
        winFocus: 0.8,
        calculationDepth: 2,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true, // 4단계: 단수 상황 판단
        knowsDirectionalAttack: false,
        knowsFuseki: false,
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    5: {
        level: 5,
        name: '중급 AI (6급)',
        description: '중급단계의 6급 수준. 정석과 포석을 활용하며 전투 능력 향상',
        captureTendency: 0.7,
        territoryTendency: 0.5,
        combatTendency: 0.65,
        josekiUsage: 0.4,
        lifeDeathSkill: 0.6,
        movementSkill: 0.6,
        mistakeRate: 0.18,
        winFocus: 0.78,
        calculationDepth: 3,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true, // 5단계: 방향성 공격
        knowsFuseki: false,
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    6: {
        level: 6,
        name: '중급 AI (3급)',
        description: '중급단계의 3급 수준. 영토와 전투의 균형잡힌 플레이',
        captureTendency: 0.72,
        territoryTendency: 0.58,
        combatTendency: 0.7,
        josekiUsage: 0.5,
        lifeDeathSkill: 0.7,
        movementSkill: 0.7,
        mistakeRate: 0.12,
        winFocus: 0.75,
        calculationDepth: 3,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true,
        knowsFuseki: true, // 6단계: 초반 포석
        knowsTerritoryAndCombat: false,
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    7: {
        level: 7,
        name: '고급 AI (1단)',
        description: '고급단계의 1단 수준. 정석과 포석을 잘 활용하며 사활 판단 능력 향상',
        captureTendency: 0.8, // 공격적 따내기 선호
        territoryTendency: 0.55, // 영토보다 공격 우선
        combatTendency: 0.8, // 공격적인 전투
        josekiUsage: 0.55, // 정석 활용하되 공격 우선
        lifeDeathSkill: 0.75, // 사활 판단 정확
        movementSkill: 0.75, // 행마 능력 우수
        mistakeRate: 0.04, // 실수 적음
        winFocus: 0.7, // 승리에 집중
        calculationDepth: 4,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true,
        knowsFuseki: true,
        knowsTerritoryAndCombat: true, // 7단계: 영토 확보 및 전투
        knowsAdvancedTechniques: false,
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    8: {
        level: 8,
        name: '고급 AI (2단)',
        description: '고급단계의 2단 수준. 우수한 행마와 정석 활용',
        captureTendency: 0.85, // 공격적 따내기 선호
        territoryTendency: 0.6, // 영토보다 공격 우선
        combatTendency: 0.85, // 공격적인 전투
        josekiUsage: 0.65, // 정석 활용하되 공격 우선
        lifeDeathSkill: 0.8, // 사활 판단 정확
        movementSkill: 0.8, // 행마 능력 우수
        mistakeRate: 0.03, // 실수 적음
        winFocus: 0.75, // 승리에 집중
        calculationDepth: 5,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true,
        knowsFuseki: true,
        knowsTerritoryAndCombat: true,
        knowsAdvancedTechniques: true, // 8단계: 고급 기술
        knowsConnectionLifeDeathMovement: false,
        knowsEndgame: false,
    },
    9: {
        level: 9,
        name: '유단자 AI (약 1단)',
        description: '유단자 수준의 약 1단. 전반적인 기술이 뛰어나며 정확한 판단',
        captureTendency: 0.9, // 공격적 따내기 선호
        territoryTendency: 0.6, // 영토보다 공격 우선
        combatTendency: 0.9, // 매우 공격적인 전투
        josekiUsage: 0.7, // 정석 활용하되 공격 우선
        lifeDeathSkill: 0.85, // 사활 판단 정확
        movementSkill: 0.85, // 행마 능력 우수
        mistakeRate: 0.015, // 실수 적음
        winFocus: 0.8, // 승리에 집중 (공격적)
        calculationDepth: 6,
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true,
        knowsFuseki: true,
        knowsTerritoryAndCombat: true,
        knowsAdvancedTechniques: true,
        knowsConnectionLifeDeathMovement: true, // 9단계: 연결/끊음, 사활, 행마
        knowsEndgame: false,
    },
    10: {
        level: 10,
        name: '유단자 AI (4단)',
        description: '유단자 수준의 4단. 영토, 전투, 행마, 정석, 포석, 사활 등 전반적인 모든 기술이 뛰어남',
        captureTendency: 0.95, // 매우 적극적인 따내기 선호 (18급 수준으로 증가)
        territoryTendency: 0.6, // 영토보다 공격 우선
        combatTendency: 0.95, // 매우 공격적인 전투 능력
        josekiUsage: 0.7, // 정석/포석 활용하되 공격 우선
        lifeDeathSkill: 0.9, // 사활 판단 정확
        movementSkill: 0.9, // 행마 능력 우수
        mistakeRate: 0.01, // 실수 거의 없음
        winFocus: 0.85, // 승리에 집중 (공격적)
        calculationDepth: 6, // 계산 깊이 최대
        knowsBasicRules: true,
        avoidsSelfAtari: true,
        knowsSacrificeAndCounter: true,
        knowsAtariJudgment: true,
        knowsDirectionalAttack: true,
        knowsFuseki: true,
        knowsTerritoryAndCombat: true,
        knowsAdvancedTechniques: true,
        knowsConnectionLifeDeathMovement: true,
        knowsEndgame: true, // 10단계: 마무리
    },
};

/**
 * AI 봇 단계에 맞는 프로필 가져오기
 */
export function getGoAiBotProfile(level: number): GoAiBotProfile {
    const profile = GO_AI_BOT_PROFILES[level];
    if (!profile) {
        console.warn(`[GoAiBot] Unknown AI level ${level}, using level 1 profile`);
        return GO_AI_BOT_PROFILES[1];
    }
    return profile;
}

/**
 * 바둑 AI 봇의 수를 두는 메인 함수
 * @param game 현재 게임 상태
 * @param aiLevel AI 봇 단계 (1~10)
 */
/**
 * AI가 보드 상태를 볼 때 유저의 히든 돌을 빈 공간으로 처리하는 헬퍼 함수
 * 싱글플레이 히든바둑 모드에서만 적용
 */
function getBoardStateForAi(
    game: types.LiveGameSession,
    aiPlayerEnum: Player
): types.BoardState {
    const isHiddenMode = game.mode === types.GameMode.Hidden || 
                        (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Hidden));
    
    // 싱글플레이 히든바둑 모드가 아니면 원본 반환
    if (!isHiddenMode || !game.isSinglePlayer) {
        return game.boardState;
    }
    
    // 싱글플레이에서 AI는 항상 White, 유저는 Black
    const userPlayerEnum = aiPlayerEnum === Player.White ? Player.Black : Player.White;
    
    // 보드 상태 복사
    const aiBoardState: types.BoardState = game.boardState.map(row => [...row]);
    
    // 유저의 히든 돌을 빈 공간으로 처리 (단, AI가 아는 히든돌만 처리)
    // aiKnownHiddenStones가 있으면 그것만 확인, 없으면 기존 로직 사용 (하위 호환성)
    const aiKnownHiddenStones = (game as any).aiKnownHiddenStones;
    if (game.hiddenMoves && game.moveHistory) {
        for (let moveIndex = 0; moveIndex < game.moveHistory.length; moveIndex++) {
            if (game.hiddenMoves[moveIndex]) {
                const move = game.moveHistory[moveIndex];
                if (move && move.player === userPlayerEnum) {
                    // aiKnownHiddenStones가 있고 이 히든돌이 포함되어 있으면 AI가 알고 있는 히든돌
                    // aiKnownHiddenStones가 없으면 기존 로직대로 모든 히든돌을 처리 (하위 호환성)
                    const isAiKnown = aiKnownHiddenStones ? aiKnownHiddenStones[moveIndex] : true;
                    
                    if (isAiKnown) {
                        const { x, y } = move;
                        // 공개되지 않은 히든 돌만 빈 공간으로 처리
                        const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(
                            p => p.x === x && p.y === y
                        );
                        if (!isPermanentlyRevealed && aiBoardState[y]?.[x] === userPlayerEnum) {
                            aiBoardState[y][x] = Player.None;
                        }
                    }
                    // isAiKnown이 false면 유저가 히든 아이템으로 놓은 히든돌이므로 AI는 모름 (처리하지 않음)
                }
            }
        }
    }
    
    return aiBoardState;
}

export async function makeGoAiBotMove(
    game: types.LiveGameSession,
    aiLevel: number
): Promise<void> {
    // 히든 돌 공개 애니메이션 중이면 AI 수를 두지 않음
    if (game.gameStatus === 'hidden_reveal_animating') {
        return;
    }
    
    const profile = getGoAiBotProfile(aiLevel);
    const aiPlayerEnum = game.currentPlayer;
    const opponentPlayerEnum = aiPlayerEnum === types.Player.Black ? types.Player.White : types.Player.Black;
    const now = Date.now();
    
    // AI가 볼 수 있는 보드 상태 (유저의 히든 돌 제거)
    const aiBoardState = getBoardStateForAi(game, aiPlayerEnum);
    
    // AI 보드 상태를 사용하는 게임 객체 생성
    const aiGame: types.LiveGameSession = {
        ...game,
        boardState: aiBoardState
    };
    
    const logic = getGoLogic(aiGame);
    
    // 살리기 바둑 모드 확인
    const isSurvivalMode = (game.settings as any)?.isSurvivalMode === true;

    // 낮은 난이도(1-3)는 간단한 휴리스틱 사용으로 성능 최적화
    const useFastHeuristic = aiLevel <= 3;

    // 1. 모든 유효한 수 찾기 (KataGo 사용 안함)
    // 낮은 난이도는 샘플링으로 유효한 수 찾기 (성능 최적화)
    const allValidMoves = useFastHeuristic 
        ? findAllValidMovesFast(aiGame, logic, aiPlayerEnum)
        : findAllValidMoves(aiGame, logic, aiPlayerEnum);
    
    if (allValidMoves.length === 0) {
        console.log('[GoAiBot] No valid moves available. AI resigns.');
        await summaryService.endGame(game, opponentPlayerEnum, 'resign');
        return;
    }

    // 2. 살리기 바둑 모드일 때는 공격적인 로직 사용
    let scoredMoves: Array<{ move: Point; score: number }>;
    if (isSurvivalMode && aiPlayerEnum === Player.White) {
        // 살리기 바둑: AI(백)가 유저(흑)의 돌을 적극적으로 잡으러 오는 전략 사용
        scoredMoves = scoreMovesForAggressiveCapture(
            allValidMoves,
            aiGame,
            profile,
            logic,
            aiPlayerEnum,
            opponentPlayerEnum
        );
    } else if (useFastHeuristic) {
        // 낮은 난이도: 간단한 휴리스틱 점수화 (성능 최적화)
        scoredMoves = scoreMovesFast(allValidMoves, aiGame, profile, logic, aiPlayerEnum, opponentPlayerEnum);
    } else {
        // 일반 바둑: AI 프로필에 따라 수 선택
        scoredMoves = scoreMovesByProfile(
            allValidMoves,
            aiGame,
            profile,
            logic,
            aiPlayerEnum,
            opponentPlayerEnum
        );
    }

    // 3. 실수 확률 적용
    let selectedMove: Point;
    if (Math.random() < profile.mistakeRate && scoredMoves.length > 1) {
        // 실수를 할 경우
        const mistakeChance = Math.random();
        if (mistakeChance < 0.3) {
            // 나쁜 수 선택 (하위 30%)
            const badMoves = scoredMoves.slice(-Math.ceil(scoredMoves.length * 0.3));
            selectedMove = badMoves[Math.floor(Math.random() * badMoves.length)].move;
        } else {
            // 중간 정도의 수 선택
            const midMoves = scoredMoves.slice(
                Math.floor(scoredMoves.length * 0.3),
                Math.floor(scoredMoves.length * 0.7)
            );
            selectedMove = midMoves.length > 0 
                ? midMoves[Math.floor(Math.random() * midMoves.length)].move
                : scoredMoves[Math.floor(Math.random() * scoredMoves.length)].move;
        }
    } else {
        // 정상 플레이: 가장 좋은 수 선택
        selectedMove = scoredMoves[0].move;
    }

    // 4. 선택된 수 실행 전에 유저의 돌 위에 착점하는지 확인 (싱글플레이 모드)
    if (game.isSinglePlayer || game.gameCategory === 'tower') {
        const { x, y } = selectedMove;
        const stoneAtTarget = game.boardState[y]?.[x];
        
        // 유저의 돌 위에 착점을 시도하는 경우 차단
        if (stoneAtTarget === opponentPlayerEnum) {
            console.error(`[GoAiBot] CRITICAL: AI attempted to place stone on user's stone at (${x}, ${y}), gameId=${game.id}`);
            
            // 유효한 수 목록에서 유저의 돌이 있는 위치 제외
            const filteredMoves = scoredMoves.filter(m => {
                const stoneAtMove = game.boardState[m.move.y]?.[m.move.x];
                return stoneAtMove !== opponentPlayerEnum;
            });
            
            if (filteredMoves.length === 0) {
                console.error('[GoAiBot] No valid moves after filtering user stones. AI resigns.');
                await summaryService.endGame(game, opponentPlayerEnum, 'resign');
                return;
            }
            
            // 필터링된 수 중에서 선택
            selectedMove = filteredMoves[0].move;
            console.log(`[GoAiBot] Replaced invalid move with valid move at (${selectedMove.x}, ${selectedMove.y})`);
        }
    }
    
    // 4-1. 히든 돌 위에 착점하는지 확인 (히든바둑 모드)
    const isHiddenMode = game.mode === types.GameMode.Hidden || 
                        (game.mode === types.GameMode.Mix && game.settings.mixedModes?.includes(types.GameMode.Hidden));
    
    if (isHiddenMode && game.isSinglePlayer) {
        const { x, y } = selectedMove;
        const stoneAtTarget = game.boardState[y][x];
        const moveIndexAtTarget = game.moveHistory.findIndex(m => m.x === x && m.y === y);
        const isTargetHiddenOpponentStone =
            stoneAtTarget === opponentPlayerEnum &&
            moveIndexAtTarget !== -1 &&
            game.hiddenMoves?.[moveIndexAtTarget] &&
            !game.permanentlyRevealedStones?.some(p => p.x === x && p.y === y);
        
        // AI가 유저의 히든 돌 위에 착점을 시도하는 경우
        if (isTargetHiddenOpponentStone) {
            // 1. 즉시 일시정지
            // 히든 돌 전체공개
            if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
            if (!game.permanentlyRevealedStones.some(p => p.x === x && p.y === y)) {
                game.permanentlyRevealedStones.push({ x, y });
            }
            
            // 공개된 히든 돌의 문양 유지 (원래 플레이어의 문양으로 명시적으로 설정)
            // 싱글플레이에서는 유저(흑)만 히든 돌을 사용하므로, opponentPlayerEnum은 항상 Black
            // moveHistory에서 원래 플레이어 확인 (확인용)
            const originalPlayer = moveIndexAtTarget !== -1 
                ? game.moveHistory[moveIndexAtTarget].player 
                : opponentPlayerEnum; // moveHistory에서 찾지 못하면 opponentPlayerEnum 사용 (싱글플레이에서는 Black)
            
            // 싱글플레이에서는 항상 유저(흑)의 히든 돌이므로, blackPatternStones에 명시적으로 추가
            if (originalPlayer === Player.Black || opponentPlayerEnum === Player.Black) {
                // blackPatternStones에 추가 (이미 있으면 유지)
                if (!game.blackPatternStones) game.blackPatternStones = [];
                if (!game.blackPatternStones.some(p => p.x === x && p.y === y)) {
                    game.blackPatternStones.push({ x, y });
                }
                // whitePatternStones에서 제거 (잘못 추가된 경우)
                if (game.whitePatternStones) {
                    game.whitePatternStones = game.whitePatternStones.filter(p => !(p.x === x && p.y === y));
                }
            } else {
                // 백의 히든 돌인 경우 (일반적으로는 발생하지 않지만 안전을 위해)
                if (!game.whitePatternStones) game.whitePatternStones = [];
                if (!game.whitePatternStones.some(p => p.x === x && p.y === y)) {
                    game.whitePatternStones.push({ x, y });
                }
                // blackPatternStones에서 제거 (잘못 추가된 경우)
                if (game.blackPatternStones) {
                    game.blackPatternStones = game.blackPatternStones.filter(p => !(p.x === x && p.y === y));
                }
            }
            
            // 일반적인 prunePatternStones 로직
            // 주의: permanentlyRevealedStones에 있는 위치는 boardState의 player와 관계없이 원래 플레이어의 문양을 유지해야 함
            const prunePatternStones = () => {
                if (game.blackPatternStones) {
                    game.blackPatternStones = game.blackPatternStones.filter(point => {
                        const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === point.x && p.y === point.y);
                        if (isPermanentlyRevealed) {
                            // 공개된 히든 돌의 경우, moveHistory에서 원래 플레이어 확인
                            const moveIndex = game.moveHistory.findIndex(m => m.x === point.x && m.y === point.y);
                            if (moveIndex !== -1) {
                                const originalMove = game.moveHistory[moveIndex];
                                // 원래 플레이어가 흑이면 유지
                                return originalMove.player === Player.Black;
                            }
                        }
                        // 일반적인 경우: boardState의 player 확인
                        const occupant = game.boardState?.[point.y]?.[point.x];
                        return occupant === Player.Black;
                    });
                }
                if (game.whitePatternStones) {
                    game.whitePatternStones = game.whitePatternStones.filter(point => {
                        const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === point.x && p.y === point.y);
                        if (isPermanentlyRevealed) {
                            // 공개된 히든 돌의 경우, moveHistory에서 원래 플레이어 확인
                            const moveIndex = game.moveHistory.findIndex(m => m.x === point.x && m.y === point.y);
                            if (moveIndex !== -1) {
                                const originalMove = game.moveHistory[moveIndex];
                                // 원래 플레이어가 백이면 유지
                                return originalMove.player === Player.White;
                            }
                        }
                        // 일반적인 경우: boardState의 player 확인
                        const occupant = game.boardState?.[point.y]?.[point.x];
                        return occupant === Player.White;
                    });
                }
            };
            prunePatternStones();
            
            // 2. 히든 돌 공개 애니메이션 설정
            game.animation = { 
                type: 'hidden_reveal', 
                stones: [{ point: { x, y }, player: opponentPlayerEnum }], 
                startTime: now, 
                duration: 2000 
            };
            game.revealAnimationEndTime = now + 2000;
            game.gameStatus = 'hidden_reveal_animating'; // 애니메이션 상태로 설정
            
            // AI 턴 취소 플래그 설정 (애니메이션 종료 후 턴 복구 및 유저 패스 처리용)
            (game as any).isAiTurnCancelledAfterReveal = true;
            
            // 시간 일시정지
            if (game.turnDeadline) {
                game.pausedTurnTimeLeft = (game.turnDeadline - now) / 1000;
                game.turnDeadline = undefined;
                game.turnStartTime = undefined;
            }
            
            await db.saveGame(game);
            return; // 이번 턴은 히든 돌 공개만 하고 실제 수는 두지 않음
        }
    }

    // 4-1. 선택된 수 실행 (실제 보드 상태 사용)
    let result = processMove(
        game.boardState, // 실제 보드 상태 사용 (히든 돌 포함)
        { ...selectedMove, player: aiPlayerEnum },
        game.koInfo,
        game.moveHistory.length
    );

    if (!result.isValid) {
        // 유효하지 않은 수를 선택한 경우, 유효한 수 중에서 대체
        // 유저의 돌 위에 두는 수는 제외
        const validFallbackMoves = scoredMoves.filter(m => {
            // 유저의 돌이 있는 위치 제외
            if (game.isSinglePlayer || game.gameCategory === 'tower') {
                const stoneAtMove = game.boardState[m.move.y]?.[m.move.x];
                if (stoneAtMove === opponentPlayerEnum) {
                    return false;
                }
            }
            
            // processMove로 유효성 검증
            const testResult = processMove(
                game.boardState,
                { ...m.move, player: aiPlayerEnum },
                game.koInfo,
                game.moveHistory.length,
                {
                    ignoreSuicide: false,
                    isSinglePlayer: game.isSinglePlayer || game.gameCategory === 'tower',
                    opponentPlayer: (game.isSinglePlayer || game.gameCategory === 'tower') ? opponentPlayerEnum : undefined
                }
            );
            return testResult.isValid;
        });
        
        if (validFallbackMoves.length > 0) {
            selectedMove = validFallbackMoves[0].move;
            result = processMove(
                game.boardState,
                { ...selectedMove, player: aiPlayerEnum },
                game.koInfo,
                game.moveHistory.length,
                {
                    ignoreSuicide: false,
                    isSinglePlayer: game.isSinglePlayer || game.gameCategory === 'tower',
                    opponentPlayer: (game.isSinglePlayer || game.gameCategory === 'tower') ? opponentPlayerEnum : undefined
                }
            );
            console.log(`[GoAiBot] Replaced invalid move with fallback move at (${selectedMove.x}, ${selectedMove.y})`);
        } else {
            console.warn('[GoAiBot] No valid fallback moves available. AI resigns.');
            await summaryService.endGame(game, opponentPlayerEnum, 'resign');
            return;
        }
    }

    // 5. 최종 수 적용
    game.boardState = result.newBoardState;
    game.lastMove = { x: selectedMove.x, y: selectedMove.y };
    game.moveHistory.push({ player: aiPlayerEnum, x: selectedMove.x, y: selectedMove.y });
    game.koInfo = result.newKoInfo;
    game.passCount = 0;
    
    // 싱글플레이 턴 카운팅 업데이트 (AI가 수를 둘 때도 카운팅)
    // 히든돌이 moveHistory에 추가되지 않은 경우를 고려하여 실제 유효한 수만 카운팅
    if (game.isSinglePlayer && game.stageId) {
        const validMoves = game.moveHistory.filter(m => m.x !== -1 && m.y !== -1);
        game.totalTurns = validMoves.length;
    }

    // 6. 따낸 돌 처리 및 히든 돌 공개 처리
    if (result.capturedStones.length > 0 && isHiddenMode && game.isSinglePlayer) {
        if (!game.justCaptured) game.justCaptured = [];
        
        // 히든 돌이 따내는데 역할을 한 경우 찾기 (contributingHiddenStones)
        const contributingHiddenStones: { point: Point; player: Player }[] = [];
        const boardAfterMove = JSON.parse(JSON.stringify(game.boardState));
        boardAfterMove[selectedMove.y][selectedMove.x] = aiPlayerEnum;
        const logic = getGoLogic({ ...game, boardState: boardAfterMove });
        const checkedStones = new Set<string>();
        
        for (const captured of result.capturedStones) {
            const neighbors = logic.getNeighbors(captured.x, captured.y);
            for (const n of neighbors) {
                const neighborKey = `${n.x},${n.y}`;
                if (checkedStones.has(neighborKey) || boardAfterMove[n.y][n.x] !== aiPlayerEnum) continue;
                checkedStones.add(neighborKey);
                const isCurrentMove = n.x === selectedMove.x && n.y === selectedMove.y;
                let isHiddenStone = false;
                if (!isCurrentMove) {
                    const moveIndex = game.moveHistory.findIndex(m => m.x === n.x && m.y === n.y);
                    isHiddenStone = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
                }
                if (isHiddenStone) {
                    if (!game.permanentlyRevealedStones || !game.permanentlyRevealedStones.some(p => p.x === n.x && p.y === n.y)) {
                        contributingHiddenStones.push({ point: { x: n.x, y: n.y }, player: aiPlayerEnum });
                    }
                }
            }
        }
        
        // 공개되지 않은 히든 돌이 따내진 경우 찾기 (capturedHiddenStones)
        const capturedHiddenStones: { point: Point; player: Player }[] = [];
        for (const capturedStone of result.capturedStones) {
            const moveIndex = game.moveHistory.findIndex(m => m.x === capturedStone.x && m.y === capturedStone.y);
            if (moveIndex !== -1 && game.hiddenMoves?.[moveIndex]) {
                const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === capturedStone.x && p.y === capturedStone.y);
                if (!isPermanentlyRevealed) {
                    capturedHiddenStones.push({ point: capturedStone, player: opponentPlayerEnum });
                }
            }
        }
        
        // AI 초기 히든돌이 따내진 경우 확인
        if ((game as any).aiInitialHiddenStone) {
            const aiHidden = (game as any).aiInitialHiddenStone;
            const isCaptured = result.capturedStones.some(s => s.x === aiHidden.x && s.y === aiHidden.y);
            if (isCaptured) {
                const isPermanentlyRevealed = game.permanentlyRevealedStones?.some(p => p.x === aiHidden.x && p.y === aiHidden.y);
                if (!isPermanentlyRevealed) {
                    capturedHiddenStones.push({ point: { x: aiHidden.x, y: aiHidden.y }, player: opponentPlayerEnum });
                }
            }
        }
        
        const allStonesToReveal = [...contributingHiddenStones, ...capturedHiddenStones];
        const uniqueStonesToReveal = Array.from(new Map(allStonesToReveal.map(item => [JSON.stringify(item.point), item])).values());
        
        // 히든 돌이 공개되어야 하는 경우
        if (uniqueStonesToReveal.length > 0) {
            // 1. 즉시 일시정지
            if (game.turnDeadline) {
                game.pausedTurnTimeLeft = (game.turnDeadline - now) / 1000;
                game.turnDeadline = undefined;
                game.turnStartTime = undefined;
            }
            
            // 2. 히든 돌 공개 애니메이션 설정
            game.gameStatus = 'hidden_reveal_animating';
            game.animation = {
                type: 'hidden_reveal',
                stones: uniqueStonesToReveal,
                startTime: now,
                duration: 2000
            };
            game.revealAnimationEndTime = now + 2000;
            game.pendingCapture = { 
                stones: result.capturedStones, 
                move: { player: aiPlayerEnum, x: selectedMove.x, y: selectedMove.y },
                hiddenContributors: contributingHiddenStones.map(c => c.point),
                capturedHiddenStones: capturedHiddenStones.map(c => c.point)
            };
            
            // permanentlyRevealedStones에 추가
            if (!game.permanentlyRevealedStones) game.permanentlyRevealedStones = [];
            uniqueStonesToReveal.forEach(s => {
                if (!game.permanentlyRevealedStones!.some(p => p.x === s.point.x && p.y === s.point.y)) {
                    game.permanentlyRevealedStones!.push(s.point);
                }
            });
            
            // 보드 상태는 일단 유지 (애니메이션 종료 후 제거)
            await db.saveGame(game);
            return; // 애니메이션 종료 후 updateHiddenState에서 처리
        }
        
        // 히든 돌이 공개되지 않는 경우: 일반 처리
        for (const stone of result.capturedStones) {
            const wasPatternStone = (opponentPlayerEnum === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                    (opponentPlayerEnum === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
            
            // 히든 돌인지 확인
            const moveIndex = game.moveHistory.findIndex(m => m.x === stone.x && m.y === stone.y);
            const wasHidden = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
            
            const points = wasPatternStone ? 2 : (wasHidden ? 5 : 1); // 히든 돌은 5점
            game.captures[aiPlayerEnum] += points;
            if (wasHidden) {
                game.hiddenStoneCaptures[aiPlayerEnum] = (game.hiddenStoneCaptures[aiPlayerEnum] || 0) + 1;
            }
            game.justCaptured.push({ point: stone, player: opponentPlayerEnum, wasHidden: wasHidden || false });
        }
    } else if (result.capturedStones.length > 0) {
        // 히든 모드가 아니거나 싱글플레이가 아닌 경우: 일반 처리
        if (!game.justCaptured) game.justCaptured = [];
        for (const stone of result.capturedStones) {
            const wasPatternStone = (opponentPlayerEnum === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                    (opponentPlayerEnum === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
            
            const moveIndex = game.moveHistory.findIndex(m => m.x === stone.x && m.y === stone.y);
            const wasHidden = moveIndex !== -1 && !!game.hiddenMoves?.[moveIndex];
            
            const points = wasPatternStone ? 2 : (wasHidden ? 5 : 1);
            game.captures[aiPlayerEnum] += points;
            if (wasHidden) {
                game.hiddenStoneCaptures[aiPlayerEnum] = (game.hiddenStoneCaptures[aiPlayerEnum] || 0) + 1;
            }
            game.justCaptured.push({ point: stone, player: opponentPlayerEnum, wasHidden: wasHidden || false });
        }
    }

    // 7. 살리기 바둑 모드에서 승리 조건 확인
    if (isSurvivalMode && aiPlayerEnum === Player.White) {
        // 백(AI)의 턴 수 증가 (백이 한 수를 둘 때마다)
        const whiteTurnsPlayed = ((game as any).whiteTurnsPlayed || 0) + 1;
        (game as any).whiteTurnsPlayed = whiteTurnsPlayed;
        const survivalTurns = (game.settings as any)?.survivalTurns || 0;
        
        console.log(`[Survival Go] White move completed - turns: ${whiteTurnsPlayed}/${survivalTurns}, gameStatus: ${game.gameStatus}, isSurvivalMode: ${isSurvivalMode}`);
        
        if (survivalTurns > 0 && game.gameStatus === 'playing') {
            // 백이 목표점수를 달성했는지 먼저 체크 (목표 달성 시 백 승리)
            const target = getCaptureTarget(game, Player.White);
            if (target !== undefined && target !== NO_CAPTURE_TARGET && game.captures[Player.White] >= target) {
                console.log(`[Survival Go] White reached target score after AI move (${target}), White wins`);
                await summaryService.endGame(game, Player.White, 'capture_limit');
                return;
            }
            
            // 백의 남은 턴이 0이 되면 흑 승리 (백이 목표점수를 달성하지 못함)
            // 백의 남은 턴 = survivalTurns - whiteTurnsPlayed
            // 백의 남은 턴이 0이 되었다는 것은 whiteTurnsPlayed >= survivalTurns
            const remainingTurns = survivalTurns - whiteTurnsPlayed;
            console.log(`[Survival Go] After White move - turns: ${whiteTurnsPlayed}/${survivalTurns}, remaining: ${remainingTurns}, gameStatus: ${game.gameStatus}`);
            if (remainingTurns <= 0) {
                console.log(`[Survival Go] White ran out of turns after AI move (${whiteTurnsPlayed}/${survivalTurns}), Black wins - ENDING GAME NOW`);
                await summaryService.endGame(game, Player.Black, 'capture_limit');
                return;
            }
        }
    } else {
        // 일반 따내기 바둑 모드에서 승리 조건 확인
        if (game.isSinglePlayer || game.mode === types.GameMode.Capture) {
            const target = getCaptureTarget(game, aiPlayerEnum);
            if (target !== undefined && target !== NO_CAPTURE_TARGET && game.captures[aiPlayerEnum] >= target) {
                await summaryService.endGame(game, aiPlayerEnum, 'capture_limit');
                return;
            }
        }
    }

    // 8. 시간 업데이트 및 턴 종료
    const aiPlayerTimeKey = aiPlayerEnum === types.Player.Black ? 'blackTimeLeft' : 'whiteTimeLeft';
    if (game.turnDeadline) {
        const timeRemaining = Math.max(0, (game.turnDeadline - now) / 1000);
        game[aiPlayerTimeKey] = timeRemaining;
    }

    // 싱글플레이/AI봇 대결 자동 계가 트리거 체크 (AI가 수를 둔 후)
    // hidden_placing, scanning 등 아이템 모드에서는 자동계가 체크를 하지 않음
    const isItemMode = ['hidden_placing', 'scanning', 'missile_selecting', 'missile_animating', 'scanning_animating'].includes(game.gameStatus);
    
    if (!isItemMode) {
        const autoScoringTurns = game.isSinglePlayer && game.stageId
            ? (await import('../constants/singlePlayerConstants.js')).SINGLE_PLAYER_STAGES.find(s => s.id === game.stageId)?.autoScoringTurns
            : (game.settings as any)?.autoScoringTurns;
        
        if (autoScoringTurns !== undefined || (game.isSinglePlayer && game.stageId)) {
        // totalTurns가 없으면 validMoves에서 계산 (패스 제외)
        const validMoves = game.moveHistory.filter(m => m.x !== -1 && m.y !== -1);
        const totalTurns = game.totalTurns ?? validMoves.length;
        // totalTurns 업데이트
        game.totalTurns = totalTurns;
        
        if (autoScoringTurns) {
            const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
            console.log(`[GoAiBot][${gameType}] Auto-scoring check: totalTurns=${totalTurns}, autoScoringTurns=${autoScoringTurns}, gameStatus=${game.gameStatus}, validMovesLength=${validMoves.length}`);
            if (totalTurns >= autoScoringTurns) {
                // 게임 상태를 먼저 확인하여 중복 트리거 방지
                if (game.gameStatus === 'playing' || game.gameStatus === 'hidden_placing') {
                    const gameType = game.isSinglePlayer ? 'SinglePlayer' : 'AiGame';
                    console.log(`[GoAiBot][${gameType}] Auto-scoring triggered at ${totalTurns} turns (stageId: ${game.stageId || 'N/A'}, validMovesLength: ${validMoves.length}, gameStatus: ${game.gameStatus})`);
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
                    console.warn(`[GoAiBot][${gameType}] Auto-scoring condition met but gameStatus is not 'playing' or 'hidden_placing': ${game.gameStatus} (totalTurns=${totalTurns}, autoScoringTurns=${autoScoringTurns}) - FORCING TRIGGER`);
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
                console.log(`[GoAiBot][${gameType}] Auto-scoring condition not met: totalTurns=${totalTurns} < autoScoringTurns=${autoScoringTurns}`);
            }
        }
    }
    }

    // 히든 돌 공개 애니메이션 직후에는 턴을 넘기지 않음
    // (updateHiddenState에서 이미 AI 턴을 유지하고 aiProcessingQueue에 추가했으므로)
    const isAiReTurnAfterReveal = (game as any).isAiReTurnAfterReveal;
    
    if (!isAiReTurnAfterReveal) {
        // 일반적인 경우: 턴 넘기기
        game.currentPlayer = opponentPlayerEnum;
        
        // 살리기 바둑 모드: 백이 수를 둔 후 턴을 넘긴 직후 승리 조건 체크
        const isSurvivalMode = (game.settings as any)?.isSurvivalMode === true;
        if (isSurvivalMode && aiPlayerEnum === Player.White && game.gameStatus === 'playing') {
            const whiteTurnsPlayed = (game as any).whiteTurnsPlayed || 0;
            const survivalTurns = (game.settings as any)?.survivalTurns || 0;
            const remainingTurns = survivalTurns - whiteTurnsPlayed;
            
            if (remainingTurns <= 0 && survivalTurns > 0) {
                console.log(`[Survival Go] White ran out of turns after turn change (${whiteTurnsPlayed}/${survivalTurns}), Black wins`);
                await summaryService.endGame(game, Player.Black, 'capture_limit');
                return;
            }
        }
        
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
    } else {
        // 히든 돌 공개 직후 AI 재턴: 플래그 제거 (다음 AI 수부터는 정상적으로 턴 넘김)
        (game as any).isAiReTurnAfterReveal = false;
    }
    // 히든 돌 공개 직후에는 턴을 넘기지 않고 AI 턴 유지 (updateHiddenState에서 이미 처리됨)
}

/**
 * 모든 유효한 수 찾기 (전체 검사)
 */
function findAllValidMoves(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player
): Point[] {
    const validMoves: Point[] = [];
    const boardSize = game.settings.boardSize;

    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] === Player.None) {
                const result = processMove(
                    game.boardState,
                    { x, y, player: aiPlayer },
                    game.koInfo,
                    game.moveHistory.length
                );
                if (result.isValid) {
                    validMoves.push({ x, y });
                }
            }
        }
    }

    return validMoves;
}

/**
 * 빠른 휴리스틱으로 유효한 수 찾기 (낮은 난이도용, 성능 최적화)
 * 주변에 돌이 있는 위치만 검사하여 계산량을 대폭 줄임
 */
function findAllValidMovesFast(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player
): Point[] {
    const validMoves: Point[] = [];
    const boardSize = game.settings.boardSize;
    const checkedPoints = new Set<string>();

    // 기존 돌 주변만 검사 (빈 보드의 경우 중앙 영역만 검사)
    const occupiedPoints: Point[] = [];
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] !== Player.None) {
                occupiedPoints.push({ x, y });
            }
        }
    }

    // 주변 위치 검사
    if (occupiedPoints.length > 0) {
        for (const point of occupiedPoints) {
            const neighbors = logic.getNeighbors(point.x, point.y);
            for (const neighbor of neighbors) {
                const key = `${neighbor.x},${neighbor.y}`;
                if (!checkedPoints.has(key) && game.boardState[neighbor.y][neighbor.x] === Player.None) {
                    checkedPoints.add(key);
                    const result = processMove(
                        game.boardState,
                        { x: neighbor.x, y: neighbor.y, player: aiPlayer },
                        game.koInfo,
                        game.moveHistory.length
                    );
                    if (result.isValid) {
                        validMoves.push({ x: neighbor.x, y: neighbor.y });
                    }
                }
            }
        }
    } else {
        // 빈 보드: 중앙 영역만 검사 (3x3 ~ 5x5)
        const centerStart = Math.floor(boardSize / 2) - 2;
        const centerEnd = Math.floor(boardSize / 2) + 3;
        for (let y = Math.max(0, centerStart); y < Math.min(boardSize, centerEnd); y++) {
            for (let x = Math.max(0, centerStart); x < Math.min(boardSize, centerEnd); x++) {
                if (game.boardState[y][x] === Player.None) {
                    const result = processMove(
                        game.boardState,
                        { x, y, player: aiPlayer },
                        game.koInfo,
                        game.moveHistory.length
                    );
                    if (result.isValid) {
                        validMoves.push({ x, y });
                    }
                }
            }
        }
    }

    // 최소한 몇 개는 있어야 함 (없으면 전체 검사)
    if (validMoves.length < 5) {
        return findAllValidMoves(game, logic, aiPlayer);
    }

    return validMoves;
}

/**
 * AI 프로필에 따라 수를 점수화
 */
function scoreMovesByProfile(
    moves: Point[],
    game: types.LiveGameSession,
    profile: GoAiBotProfile,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player,
    opponentPlayer: Player
): Array<{ move: Point; score: number }> {
    const scoredMoves: Array<{ move: Point; score: number }> = [];

    for (const move of moves) {
        let score = 0;
        const point: Point = { x: move.x, y: move.y };

        // 1. 따내기 성향 반영 (가치 판단 후 적용)
        const captureScore = evaluateCaptureOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        if (captureScore > 0) {
            score += 2000 + captureScore * 500; // 매우 강력한 가중치
        }
        score += captureScore * profile.captureTendency * 300;

        // 2. 영토 확보 성향 반영 (방어 우선)
        const territoryScore = evaluateTerritory(game, logic, point, aiPlayer, profile);
        
        // 영토 확보 전략 단계별 평가
        const territoryStrategyScore = evaluateTerritoryStrategy(game, logic, point, aiPlayer, opponentPlayer, profile);
        score += territoryStrategyScore;
        
        // 방어적인 수는 더 높은 가중치 적용
        if (territoryScore > 5.0) {
            // 방어적인 수는 매우 높은 점수
            score += territoryScore * profile.territoryTendency * 200;
        } else if (territoryScore < 0) {
            // 영토를 메우는 수는 패널티
            score += territoryScore * profile.territoryTendency * 100;
        } else {
            score += territoryScore * profile.territoryTendency * 50;
        }
        
        // 2-1. 방어 방향 평가 (선의 높이에 따른 방어 우선순위)
        if (territoryScore > 5.0) {
            // 방어적인 수일 때만 방어 방향 평가
            const defensiveDirectionScore = evaluateDefensiveDirection(game, point, aiPlayer, profile);
            score += defensiveDirectionScore * profile.territoryTendency * 150; // 방어 방향 점수
        }

        // 3. 전투 성향 반영
        const combatScore = evaluateCombat(game, logic, point, aiPlayer, opponentPlayer);
        score += combatScore * profile.combatTendency * 80;

        // 4. 아타리(단수) 기회 평가
        const atariScore = evaluateAtariOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        if (atariScore > 0) {
            score += 1000 + atariScore * profile.captureTendency * 200; // 높은 점수
        }

        // 4-1. 유저 돌 근처로 접근 (공격적 접근) - 싱글플레이에서 특히 중요
        if (game.isSinglePlayer) {
            const proximityScore = evaluateProximityToOpponent(game, logic, point, opponentPlayer);
            score += proximityScore * profile.combatTendency * 250; // 유저 돌 근처로 가는 수
        }

        // 4-2. 공격 기회 평가 (유저 그룹 위협)
        if (game.isSinglePlayer) {
            const attackScore = evaluateAttackOpportunity(game, logic, point, aiPlayer, opponentPlayer);
            score += attackScore * profile.combatTendency * 200; // 유저 그룹을 위협하는 수
        }

        // 5. 정석/포석 활용도 반영 (고수일수록 더 반영)
        if (profile.josekiUsage > 0.3) {
            const josekiScore = evaluateJoseki(game, point, aiPlayer);
            score += josekiScore * profile.josekiUsage * 40;
        }

        // 6. 사활 판단 능력 반영
        if (profile.lifeDeathSkill > 0.3) {
            const lifeDeathScore = evaluateLifeDeath(game, logic, point, aiPlayer, opponentPlayer);
            score += lifeDeathScore * profile.lifeDeathSkill * 80;
        }

        // 7. 행마 능력 반영
        if (profile.movementSkill > 0.3) {
            const movementScore = evaluateMovement(game, logic, point, aiPlayer);
            score += movementScore * profile.movementSkill * 40;
        }

        // 8. 승리 목적 달성도 반영 (목표 점수에 근접할수록 높은 점수)
        if (profile.winFocus > 0.5 && (game.isSinglePlayer || game.mode === types.GameMode.Capture)) {
            const winFocusScore = evaluateWinFocus(game, logic, point, aiPlayer, opponentPlayer);
            score += winFocusScore * profile.winFocus * 150;
        }

        // 9. 2단계: 자충수 방지 (단수당한 자신의 돌을 살리는 경우는 예외)
        // 먼저 단수당한 자신의 돌을 살리는지 확인
        const testResultForSelfAtari = processMove(
            game.boardState,
            { ...point, player: aiPlayer },
            game.koInfo,
            game.moveHistory.length,
            { ignoreSuicide: true }
        );
        let isSavingOwnAtariGroup = false;
        if (testResultForSelfAtari.isValid) {
            const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
            const myGroupsAfter = logic.getAllGroups(aiPlayer, testResultForSelfAtari.newBoardState);
            for (const groupBefore of myGroupsBefore) {
                if (groupBefore.libertyPoints.size === 1) {
                    const matchingAfter = myGroupsAfter.find(ga =>
                        ga.stones.some(ast => groupBefore.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
                    );
                    if (matchingAfter && matchingAfter.libertyPoints.size > 1) {
                        isSavingOwnAtariGroup = true;
                        break;
                    }
                }
            }
        }
        
        // 단수당한 자신의 돌을 살리는 경우가 아니면 자충수 패널티 적용
        if (profile.avoidsSelfAtari && !isSavingOwnAtariGroup) {
            const selfAtariPenalty = evaluateSelfAtari(game, logic, point, aiPlayer);
            // 자충수는 매우 큰 패널티 (다른 점수로 상쇄되지 않도록)
            // evaluateSelfAtari는 자충수면 1.0, 아니면 0.0을 반환
            if (selfAtariPenalty > 0) {
                // 자충수인 경우 점수를 매우 낮게 설정하여 거의 선택되지 않도록 함
                score = -100000; // 매우 큰 음수로 설정하여 다른 점수와 관계없이 최하위로
            }
        }

        // 10. 3단계: 먹여치기 및 환격
        if (profile.knowsSacrificeAndCounter) {
            const sacrificeScore = evaluateSacrificeAndCounter(game, logic, point, aiPlayer, opponentPlayer);
            score += sacrificeScore * 300;
        }

        // 11. 4단계: 단수 상황 판단 (따내기 vs 살리기) - 가치 판단
        const atariJudgmentScore = evaluateAtariJudgment(game, logic, point, aiPlayer, opponentPlayer);
        const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
        const testResult = processMove(
            game.boardState,
            { ...point, player: aiPlayer },
            game.koInfo,
            game.moveHistory.length,
            { ignoreSuicide: true }
        );
        
        // 살리기 vs 따내기 가치 비교
        if (testResult.isValid && profile.knowsAtariJudgment) {
            let saveOwnGroupValue = 0;
            let captureOpponentValue = 0;
            
            // 자신의 단수 그룹을 살리는 경우의 가치 평가
            const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            for (const groupBefore of myGroupsBefore) {
                if (groupBefore.libertyPoints.size === 1) {
                    const matchingAfter = myGroupsAfter.find(ga =>
                        ga.stones.some(ast => groupBefore.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
                    );
                    if (matchingAfter && matchingAfter.libertyPoints.size > 1) {
                        // 자신의 단수 그룹을 살린 경우
                        const groupSize = groupBefore.stones.length;
                        // 그룹 크기, 위치, 중요도 등을 고려한 가치 평가
                        saveOwnGroupValue = evaluateGroupValue(
                            groupBefore,
                            game,
                            logic,
                            aiPlayer,
                            profile
                        );
                    }
                }
            }
            
            // 상대방 돌을 따내는 경우의 가치 평가
            if (testResult.capturedStones.length > 0) {
                // 따낼 돌의 개수와 가치 평가
                let captureValue = 0;
                for (const stone of testResult.capturedStones) {
                    const wasPatternStone = (opponentPlayer === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                            (opponentPlayer === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
                    captureValue += wasPatternStone ? 3 : 1; // 문양돌은 더 가치 있음
                }
                
                // 따낼 그룹의 크기와 중요도 평가
                const opponentGroupsBefore = logic.getAllGroups(opponentPlayer, game.boardState);
                for (const stone of testResult.capturedStones) {
                    const capturedGroup = opponentGroupsBefore.find(g =>
                        g.stones.some(s => s.x === stone.x && s.y === stone.y)
                    );
                    if (capturedGroup) {
                        // 그룹 크기에 따라 가치 증가 (큰 그룹을 잡는 것이 더 가치 있음)
                        captureValue += capturedGroup.stones.length * 0.5;
                    }
                }
                
                captureOpponentValue = captureValue;
            }
            
            // 가치 비교 후 점수 부여
            if (saveOwnGroupValue > 0 || captureOpponentValue > 0) {
                // AI 난이도에 따라 가치 판단 능력 차등 적용
                const judgmentSkill = profile.lifeDeathSkill; // 사활 판단 능력 사용
                
                if (saveOwnGroupValue > captureOpponentValue * (1.0 + (1.0 - judgmentSkill) * 0.5)) {
                    // 자신의 그룹을 살리는 것이 더 가치 있음
                    score += 5000 + saveOwnGroupValue * 500;
                } else if (captureOpponentValue > saveOwnGroupValue * (1.0 + (1.0 - judgmentSkill) * 0.5)) {
                    // 상대방 돌을 따내는 것이 더 가치 있음
                    score += 3000 + captureOpponentValue * 400;
                } else {
                    // 가치가 비슷한 경우 둘 다 고려
                    score += 4000 + (saveOwnGroupValue + captureOpponentValue) * 300;
                }
            } else {
                // 일반적인 단수 상황 판단
                score += atariJudgmentScore * 400;
            }
        } else if (profile.knowsAtariJudgment) {
            score += atariJudgmentScore * 400;
        }

        // 12. 5단계: 방향성 공격
        if (profile.knowsDirectionalAttack) {
            const directionalScore = evaluateDirectionalAttack(game, logic, point, aiPlayer, opponentPlayer);
            score += directionalScore * 200;
        }

        // 13. 6단계: 초반 포석 (3-4선 선호)
        if (profile.knowsFuseki) {
            const moveCount = game.moveHistory.length;
            if (moveCount <= 50) {
                const fusekiScore = evaluateFuseki(game, point, aiPlayer, profile.level);
                score += fusekiScore * 150;
            }
        }

        // 14. 7단계: 영토 확보 및 전투 (이미 위에서 평가됨, 추가 보정)
        if (profile.knowsTerritoryAndCombat) {
            const territoryCombatScore = evaluateTerritoryAndCombat(game, logic, point, aiPlayer, opponentPlayer);
            score += territoryCombatScore * 100;
        }

        // 15. 8단계: 고급 기술 (촉촉수, 축, 장문, 환격, 먹여치기)
        if (profile.knowsAdvancedTechniques) {
            const advancedScore = evaluateAdvancedTechniques(game, logic, point, aiPlayer, opponentPlayer);
            score += advancedScore * 250;
        }

        // 15-1. 포위된 그룹의 탈출 시도 (높은 우선순위)
        const escapeScore = evaluateEscapeFromSurround(game, logic, point, aiPlayer, opponentPlayer);
        if (escapeScore > 0) {
            score += escapeScore * 1500; // 탈출 시도는 매우 높은 점수
        }

        // 16. 9단계: 연결/끊음, 사활, 행마
        if (profile.knowsConnectionLifeDeathMovement) {
            const connectionScore = evaluateConnectionAndCut(game, logic, point, aiPlayer, opponentPlayer);
            score += connectionScore * 200;
            const lifeDeathScore = evaluateLifeDeathAdvanced(game, logic, point, aiPlayer, opponentPlayer);
            score += lifeDeathScore * 300;
            const movementScore = evaluateMovementAdvanced(game, logic, point, aiPlayer);
            score += movementScore * 150;
        }

        // 17. 10단계: 마무리 (집 지키기/부수기)
        if (profile.knowsEndgame) {
            const moveCount = game.moveHistory.length;
            const boardSize = game.settings.boardSize;
            const totalSpaces = boardSize * boardSize;
            const occupiedSpaces = game.boardState.flat().filter(c => c !== types.Player.None).length;
            const occupancyRate = occupiedSpaces / totalSpaces;
            
            // 보드의 70% 이상이 차면 마무리 단계로 간주
            if (occupancyRate >= 0.7 || moveCount >= totalSpaces * 0.7) {
                const endgameScore = evaluateEndgame(game, logic, point, aiPlayer, opponentPlayer);
                score += endgameScore * 400;
            }
        }

        scoredMoves.push({ move, score });
    }

    // 점수 순으로 정렬
    scoredMoves.sort((a, b) => b.score - a.score);

    return scoredMoves;
}

/**
 * 따내기 기회 평가
 */
function evaluateCaptureOpportunity(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    // 이 수로 상대 돌을 따낼 수 있는지 확인
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (testResult.isValid && testResult.capturedStones.length > 0) {
        let captureScore = 0;
        for (const stone of testResult.capturedStones) {
            // 문양돌은 2점, 일반 돌은 1점
            const wasPatternStone = (opponentPlayer === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                    (opponentPlayer === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
            captureScore += wasPatternStone ? 2 : 1;
        }
        return captureScore;
    }

    return 0;
}

/**
 * 방어 방향 평가 (선의 높이에 따른 방어 우선순위)
 * 낮은 단계: 1선부터 막으려고 함
 * 높은 단계: 3~4선부터 막으려고 함, 중앙에 가까운 곳부터 막으려고 함
 */
function evaluateDefensiveDirection(
    game: types.LiveGameSession,
    point: Point,
    aiPlayer: Player,
    profile: GoAiBotProfile
): number {
    const boardSize = game.settings.boardSize;
    
    // 현재 위치의 선 계산 (가장자리에서 얼마나 떨어져 있는지)
    // 1선 = 가장자리 (x=0, x=boardSize-1, y=0, y=boardSize-1)
    // 2선 = 그 다음
    // 3선, 4선 = 중앙에 가까운 선
    const distanceFromEdge = Math.min(
        point.x,                                    // 왼쪽 가장자리까지 거리
        point.y,                                    // 위쪽 가장자리까지 거리
        boardSize - 1 - point.x,                    // 오른쪽 가장자리까지 거리
        boardSize - 1 - point.y                    // 아래쪽 가장자리까지 거리
    );
    
    // 선 계산 (1선 = 가장자리, 2선, 3선, 4선...)
    const line = distanceFromEdge + 1; // 1선부터 시작
    const maxLine = Math.ceil(boardSize / 2);
    const normalizedLine = (line - 1) / (maxLine - 1); // 0.0 (1선) ~ 1.0 (중앙)
    
    // 중앙까지의 거리 (중앙 선호도 계산용)
    const centerX = boardSize / 2;
    const centerY = boardSize / 2;
    const distanceFromCenterX = Math.abs(point.x - centerX);
    const distanceFromCenterY = Math.abs(point.y - centerY);
    const distanceFromCenter = Math.sqrt(distanceFromCenterX * distanceFromCenterX + distanceFromCenterY * distanceFromCenterY);
    const maxDistanceFromCenter = Math.sqrt((boardSize / 2) * (boardSize / 2) * 2);
    const centrality = 1.0 - (distanceFromCenter / maxDistanceFromCenter); // 0.0 (가장자리) ~ 1.0 (중앙)
    
    // AI 난이도에 따른 방어 방향 선호도
    // 낮은 단계(1-3): 1선부터 막으려고 함 (패널티 없음)
    // 중간 단계(4-6): 2선부터 막으려고 함
    // 높은 단계(7-10): 3~4선부터 막으려고 함, 중앙에 가까운 곳 선호
    
    const level = profile.level;
    let directionScore = 0;
    
    if (level <= 3) {
        // 낮은 단계: 1선부터 막으려고 함 (방향 점수 없음)
        directionScore = 0;
    } else if (level <= 6) {
        // 중간 단계: 2선 이상 선호 (1선은 약간 패널티)
        if (line === 1) {
            directionScore = -1.0; // 1선은 약간 패널티
        } else if (line >= 2 && line <= 3) {
            directionScore = 1.0; // 2~3선 선호
        } else {
            directionScore = 0.5; // 그 외
        }
    } else {
        // 높은 단계(7-10): 3~4선부터 막으려고 함, 중앙에 가까운 곳 선호
        if (line === 1) {
            directionScore = -3.0; // 1선은 큰 패널티 (죽음의 선)
        } else if (line === 2) {
            directionScore = -1.0; // 2선도 약간 패널티
        } else if (line >= 3 && line <= 4) {
            directionScore = 3.0; // 3~4선은 높은 점수
        } else if (line >= 5) {
            directionScore = 1.0; // 5선 이상도 괜찮음
        }
        
        // 중앙에 가까울수록 추가 점수
        directionScore += centrality * 2.0; // 중앙에 가까울수록 추가 점수
    }
    
    return directionScore;
}

/**
 * 영토 확보 평가 (방어 vs 영토 메우기 구분)
 */
function evaluateTerritory(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    profile?: GoAiBotProfile
): number {
    const boardSize = game.settings.boardSize;
    let territoryScore = 0;

    // 주변 4방향 확인 (상하좌우)
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];

    let myStonesCount = 0;
    let emptySpacesCount = 0;
    let opponentStonesCount = 0;
    let isDefensiveMove = false; // 방어적인 수인지 확인
    let isFillingTerritory = false; // 영토를 메우는 수인지 확인

    // 상대 그룹들 확인 (방어 평가용)
    const opponentGroups = logic.getAllGroups(aiPlayer === Player.Black ? Player.White : Player.Black, game.boardState);

    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = game.boardState[ny][nx];
            if (cell === Player.None) {
                emptySpacesCount++;
                // 빈 공간이지만 상대가 침입할 수 있는 곳인지 확인
                // 상대 돌이 근처에 있으면 방어적인 수
                const neighbors = logic.getNeighbors(nx, ny);
                for (const neighbor of neighbors) {
                    const neighborCell = game.boardState[neighbor.y]?.[neighbor.x];
                    if (neighborCell === (aiPlayer === Player.Black ? Player.White : Player.Black)) {
                        isDefensiveMove = true;
                        break;
                    }
                }
            } else if (cell === aiPlayer) {
                myStonesCount++;
            } else {
                opponentStonesCount++;
                isDefensiveMove = true; // 상대 돌 근처는 방어적인 수
            }
        }
    }

    // 자신의 그룹으로 완전히 둘러싸인 영역인지 확인 (영토 메우기)
    // 주변 8방향 모두 확인
    const allDirections = [
        { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }
    ];
    let myStonesAround = 0;
    let emptySpacesAround = 0;
    let opponentStonesAround = 0;
    
    for (const dir of allDirections) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = game.boardState[ny][nx];
            if (cell === aiPlayer) {
                myStonesAround++;
            } else if (cell === Player.None) {
                emptySpacesAround++;
            } else {
                opponentStonesAround++;
            }
        }
    }
    
    // 자신의 돌로 완전히 둘러싸인 곳 (빈 공간이 없고 상대 돌도 없음) - 영토 메우기
    if (myStonesAround >= 4 && emptySpacesAround === 0 && opponentStonesAround === 0) {
        isFillingTerritory = true;
    }

    // 방어적인 수 (상대가 침입할 수 있는 곳을 막는 수) - 높은 점수
    if (isDefensiveMove) {
        territoryScore += 5.0; // 방어적인 수는 높은 점수
        if (opponentStonesCount > 0) {
            territoryScore += opponentStonesCount * 2.0; // 상대 돌이 많을수록 더 중요
        }
        // 상대 그룹이 근처에 있으면 더 중요
        for (const oppGroup of opponentGroups) {
            for (const stone of oppGroup.stones) {
                const distance = Math.abs(point.x - stone.x) + Math.abs(point.y - stone.y);
                if (distance <= 2) {
                    territoryScore += 1.0; // 상대 그룹 근처 방어는 더 중요
                    break;
                }
            }
        }
        
        // 방어 방향 평가 (선의 높이에 따른 방어 우선순위)
        // 이 부분은 scoreMovesByProfile에서 profile을 전달받아 처리하므로 여기서는 기본 점수만 부여
    } else if (isFillingTerritory) {
        // 이미 확정된 영토 안에 두는 수 (영토 메우기) - 큰 패널티
        territoryScore -= 15.0; // 영토를 메우는 것은 매우 비효율적
    } else if (myStonesCount >= 3 && emptySpacesCount === 0) {
        // 자신의 돌로 둘러싸인 곳 - 패널티
        territoryScore -= 10.0; // 영토를 메우는 것은 비효율적
    } else if (myStonesCount >= 2) {
        // 자신의 돌이 많지만 방어적이지 않은 경우 - 약간의 점수만
        territoryScore += 0.5;
    } else {
        // 새로운 영토 확보 시도
        territoryScore += 1.0;
    }

    // 모서리와 변은 영토 확보에 유리 (단, 방어적인 수가 아닐 때만)
    if (!isDefensiveMove) {
        const isCorner = (point.x === 0 || point.x === boardSize - 1) && 
                         (point.y === 0 || point.y === boardSize - 1);
        const isEdge = (point.x === 0 || point.x === boardSize - 1) || 
                      (point.y === 0 || point.y === boardSize - 1);
        
        if (isCorner) territoryScore += 2;
        else if (isEdge) territoryScore += 1;
    }

    return territoryScore;
}

/**
 * 영토 확보 전략 단계별 평가
 * 1. 최고 단계: 상대방의 영토가 넓어지지 못하게 하면서 내 영토를 넓혀나가는 자리
 * 2. 중간 단계: 내 영토만 넓어지는 자리 또는 상대방의 영토만 넓어지지 못하게 두는 자리
 * 3. 초보 단계: 영토의 개념을 막 이해하고 10집 이상의 영토를 만들려고 노력
 * 4. 최하 단계: 내 영토를 넓히기는 커녕 메워서 없애는 단계 (이미 패널티 있음)
 */
function evaluateTerritoryStrategy(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player,
    profile: GoAiBotProfile
): number {
    const boardSize = game.settings.boardSize;
    let strategyScore = 0;
    
    // 임시 보드로 수를 시뮬레이션
    const tempBoard = game.boardState.map(row => [...row]);
    tempBoard[point.y][point.x] = aiPlayer;
    
    // 내 영토 확장 가능성 평가
    const myTerritoryExpansion = evaluateMyTerritoryExpansion(tempBoard, logic, point, aiPlayer, boardSize);
    
    // 상대방 영토 확장 방지 평가
    const opponentTerritoryBlock = evaluateOpponentTerritoryBlock(tempBoard, logic, point, aiPlayer, opponentPlayer, boardSize);
    
    // 10집 이상 영토 만들기 평가
    const largeTerritoryScore = evaluateLargeTerritory(tempBoard, logic, point, aiPlayer, boardSize);
    
    // AI 레벨에 따른 전략 선택
    if (profile.level >= 7) {
        // 최고 단계: 상대방 영토 확장 방지 + 내 영토 확장
        if (opponentTerritoryBlock > 0 && myTerritoryExpansion > 0) {
            strategyScore += (opponentTerritoryBlock + myTerritoryExpansion) * 300; // 매우 높은 점수
        } else if (opponentTerritoryBlock > 0) {
            strategyScore += opponentTerritoryBlock * 200; // 상대방 방어도 중요
        } else if (myTerritoryExpansion > 0) {
            strategyScore += myTerritoryExpansion * 150; // 내 영토 확장
        }
    } else if (profile.level >= 4) {
        // 중간 단계: 내 영토 확장 또는 상대방 영토 확장 방지
        if (myTerritoryExpansion > 0) {
            strategyScore += myTerritoryExpansion * 200;
        }
        if (opponentTerritoryBlock > 0) {
            strategyScore += opponentTerritoryBlock * 200;
        }
    } else if (profile.level >= 2) {
        // 초보 단계: 10집 이상 영토 만들기 노력
        strategyScore += largeTerritoryScore * 150;
    }
    // 최하 단계(level 1)는 이미 evaluateTerritory에서 영토 메우기 패널티가 있음
    
    return strategyScore;
}

/**
 * 내 영토 확장 가능성 평가
 */
function evaluateMyTerritoryExpansion(
    board: Player[][],
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    boardSize: number
): number {
    let expansionScore = 0;
    
    // 주변 8방향 확인
    const directions = [
        { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }
    ];
    
    let myStonesNearby = 0;
    let emptySpacesNearby = 0;
    
    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = board[ny][nx];
            if (cell === aiPlayer) {
                myStonesNearby++;
            } else if (cell === Player.None) {
                emptySpacesNearby++;
            }
        }
    }
    
    // 내 돌이 있고 빈 공간이 많으면 영토 확장 가능
    if (myStonesNearby >= 2 && emptySpacesNearby >= 3) {
        expansionScore += 5.0; // 영토 확장 가능성 높음
    } else if (myStonesNearby >= 1 && emptySpacesNearby >= 2) {
        expansionScore += 2.0; // 영토 확장 가능성 있음
    }
    
    return expansionScore;
}

/**
 * 상대방 영토 확장 방지 평가
 */
function evaluateOpponentTerritoryBlock(
    board: Player[][],
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player,
    boardSize: number
): number {
    let blockScore = 0;
    
    // 주변 8방향 확인
    const directions = [
        { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }
    ];
    
    let opponentStonesNearby = 0;
    let emptySpacesNearby = 0;
    
    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = board[ny][nx];
            if (cell === opponentPlayer) {
                opponentStonesNearby++;
            } else if (cell === Player.None) {
                emptySpacesNearby++;
                // 상대방이 이 빈 공간에 두면 영토를 확장할 수 있는지 확인
                const neighbors = logic.getNeighbors(nx, ny);
                let opponentCanExpand = false;
                for (const neighbor of neighbors) {
                    if (neighbor.x >= 0 && neighbor.x < boardSize && neighbor.y >= 0 && neighbor.y < boardSize) {
                        if (board[neighbor.y][neighbor.x] === opponentPlayer) {
                            opponentCanExpand = true;
                            break;
                        }
                    }
                }
                if (opponentCanExpand) {
                    emptySpacesNearby += 0.5; // 상대방이 확장할 수 있는 빈 공간
                }
            }
        }
    }
    
    // 상대방 돌이 있고, 상대방이 확장할 수 있는 빈 공간이 많으면 방어 중요
    if (opponentStonesNearby >= 1 && emptySpacesNearby >= 2) {
        blockScore += 5.0; // 상대방 영토 확장 방지 중요
    } else if (opponentStonesNearby >= 1 && emptySpacesNearby >= 1) {
        blockScore += 2.0; // 상대방 영토 확장 방지
    }
    
    return blockScore;
}

/**
 * 10집 이상 영토 만들기 평가
 */
function evaluateLargeTerritory(
    board: Player[][],
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    boardSize: number
): number {
    let largeTerritoryScore = 0;
    
    // BFS로 연결된 빈 공간과 내 돌의 개수 확인
    const visited = new Set<string>();
    const queue: Point[] = [point];
    visited.add(`${point.x},${point.y}`);
    
    let myStonesInArea = 0;
    let emptySpacesInArea = 0;
    
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];
    
    while (queue.length > 0) {
        const current = queue.shift()!;
        
        for (const dir of directions) {
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;
            const key = `${nx},${ny}`;
            
            if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize && !visited.has(key)) {
                visited.add(key);
                const cell = board[ny][nx];
                
                if (cell === aiPlayer) {
                    myStonesInArea++;
                    queue.push({ x: nx, y: ny });
                } else if (cell === Player.None) {
                    emptySpacesInArea++;
                    // 내 돌로 둘러싸인 빈 공간인지 확인
                    const neighbors = logic.getNeighbors(nx, ny);
                    let surroundedByMyStones = true;
                    for (const neighbor of neighbors) {
                        if (neighbor.x >= 0 && neighbor.x < boardSize && neighbor.y >= 0 && neighbor.y < boardSize) {
                            if (board[neighbor.y][neighbor.x] !== aiPlayer && board[neighbor.y][neighbor.x] !== Player.None) {
                                surroundedByMyStones = false;
                                break;
                            }
                        }
                    }
                    if (surroundedByMyStones) {
                        queue.push({ x: nx, y: ny });
                    }
                }
            }
        }
    }
    
    // 10집 이상의 영토를 만들 수 있는지 평가
    const potentialTerritory = myStonesInArea + emptySpacesInArea;
    if (potentialTerritory >= 10) {
        largeTerritoryScore += 10.0; // 10집 이상 영토 가능
    } else if (potentialTerritory >= 5) {
        largeTerritoryScore += 5.0; // 5집 이상 영토 가능
    }
    
    return largeTerritoryScore;
}

/**
 * 전투 평가
 */
function evaluateCombat(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let combatScore = 0;

    // 상대 돌과 인접한 위치인지 확인
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];

    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = game.boardState[ny][nx];
            if (cell === opponentPlayer) {
                combatScore += 2; // 상대 돌과 인접
            } else if (cell === aiPlayer) {
                combatScore += 1; // 자신의 돌과 연결
            }
        }
    }

    return combatScore;
}

/**
 * 아타리(단수) 기회 평가
 */
function evaluateAtariOpportunity(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let atariScore = 0;

    const opponentGroupsBefore = logic.getAllGroups(opponentPlayer, game.boardState);
    const opponentGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);

    for (const groupAfter of opponentGroupsAfter) {
        const libertiesAfter = groupAfter.libertyPoints.size;
        if (libertiesAfter > 2) continue;

        const matchingBefore = opponentGroupsBefore.find(groupBefore =>
            groupBefore.stones.some(beforeStone =>
                groupAfter.stones.some(afterStone => afterStone.x === beforeStone.x && afterStone.y === beforeStone.y)
            )
        );

        if (!matchingBefore) continue;

        const libertiesBefore = matchingBefore.libertyPoints.size;
        if (libertiesAfter === 1 && libertiesBefore > libertiesAfter) {
            // 즉시 단수 상황
            atariScore += 5;
        } else if (libertiesAfter === 2 && libertiesBefore - libertiesAfter >= 2) {
            // 빠르게 단수로 몰 수 있는 경우
            atariScore += 3;
        } else if (libertiesAfter < libertiesBefore) {
            atariScore += 1.5;
        }
    }

    return atariScore;
}

/**
 * 정석/포석 평가 (간단한 구현)
 */
function evaluateJoseki(
    game: types.LiveGameSession,
    point: Point,
    aiPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    
    // 간단한 정석 위치 평가
    // 모서리 3-3, 3-4, 4-4 등 기본 포석 위치
    const cornerPositions = [
        { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 3 },
        { x: boardSize - 3, y: 2 }, { x: boardSize - 3, y: 3 },
        { x: boardSize - 4, y: 2 }, { x: boardSize - 4, y: 3 },
        { x: 2, y: boardSize - 3 }, { x: 3, y: boardSize - 3 },
        { x: 2, y: boardSize - 4 }, { x: 3, y: boardSize - 4 },
        { x: boardSize - 3, y: boardSize - 3 }, { x: boardSize - 4, y: boardSize - 3 },
        { x: boardSize - 3, y: boardSize - 4 }, { x: boardSize - 4, y: boardSize - 4 },
    ];

    for (const pos of cornerPositions) {
        if (point.x === pos.x && point.y === pos.y) {
            return 1.0; // 정석 위치
        }
    }

    // 변의 포석 위치
    const edgePositions = [
        { x: 2, y: 0 }, { x: 3, y: 0 }, { x: boardSize - 3, y: 0 }, { x: boardSize - 4, y: 0 },
        { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: boardSize - 3 }, { x: 0, y: boardSize - 4 },
        { x: boardSize - 1, y: 2 }, { x: boardSize - 1, y: 3 },
        { x: boardSize - 1, y: boardSize - 3 }, { x: boardSize - 1, y: boardSize - 4 },
        { x: 2, y: boardSize - 1 }, { x: 3, y: boardSize - 1 },
        { x: boardSize - 3, y: boardSize - 1 }, { x: boardSize - 4, y: boardSize - 1 },
    ];

    for (const pos of edgePositions) {
        if (point.x === pos.x && point.y === pos.y) {
            return 0.7; // 변의 포석 위치
        }
    }

    return 0.3; // 일반 위치
}

/**
 * 사활 판단 평가
 */
function evaluateLifeDeath(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    // 자신의 그룹이 위험한지, 상대 그룹을 잡을 수 있는지 평가
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return -2; // 자살수는 매우 낮은 점수

    // 따낼 수 있으면 높은 점수
    if (testResult.capturedStones.length > 0) {
        return 1.5;
    }

    // 자신의 그룹을 살리는 수인지 확인
    const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    if (pointGroup) {
        const libertyCount = pointGroup.libertyPoints.size;
        if (libertyCount >= 2) {
            return 0.8; // 그룹을 살리는 수
        }
    }

    return 0.4;
}

/**
 * 행마 평가
 */
function evaluateMovement(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let movementScore = 0;

    // 자신의 돌과 연결되는지 확인
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];

    let connectedCount = 0;
    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            const cell = game.boardState[ny][nx];
            if (cell === aiPlayer) {
                connectedCount++;
                movementScore += 0.8; // 자신의 돌과 연결
            } else if (cell === Player.None) {
                movementScore += 0.3; // 빈 공간으로 확장
            }
        }
    }

    // 연결된 돌이 많을수록 좋음
    if (connectedCount >= 2) {
        movementScore += 1.0;
    }

    return movementScore;
}

/**
 * 승리 목적 달성도 평가
 */
function evaluateWinFocus(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const target = getCaptureTarget(game, aiPlayer);
    if (target === undefined || target === NO_CAPTURE_TARGET) return 0;
    const currentScore = game.captures[aiPlayer] || 0;
    const remainingScore = target - currentScore;

    // 목표 점수에 가까울수록 높은 점수
    if (remainingScore <= 0) return 0; // 이미 달성

    // 이 수로 따낼 수 있는 점수 확인
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (testResult.isValid && testResult.capturedStones.length > 0) {
        let captureScore = 0;
        for (const stone of testResult.capturedStones) {
            const wasPatternStone = (opponentPlayer === Player.Black && game.blackPatternStones?.some(p => p.x === stone.x && p.y === stone.y)) ||
                                    (opponentPlayer === Player.White && game.whitePatternStones?.some(p => p.x === stone.x && p.y === stone.y));
            captureScore += wasPatternStone ? 2 : 1;
        }

        // 목표 달성에 가까운 수일수록 높은 점수
        if (currentScore + captureScore >= target) {
            return 10.0; // 승리 수
        } else if (remainingScore <= 3) {
            return captureScore * 2; // 목표에 가까움
        } else {
            return captureScore;
        }
    }

    return 0;
}

/**
 * 빠른 휴리스틱 점수화 (낮은 난이도용, 성능 최적화)
 * 간단한 따내기와 기본적인 안전성만 평가
 */
function scoreMovesFast(
    moves: Point[],
    game: types.LiveGameSession,
    profile: GoAiBotProfile,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player,
    opponentPlayer: Player
): Array<{ move: Point; score: number }> {
    const scoredMoves: Array<{ move: Point; score: number }> = [];

    for (const move of moves) {
        let score = 0;
        const point: Point = { x: move.x, y: move.y };

        // 0. 자신의 단수 그룹을 살리기 (최우선 - 따내기보다도 우선)
        const testResult = processMove(
            game.boardState,
            { ...point, player: aiPlayer },
            game.koInfo,
            game.moveHistory.length,
            { ignoreSuicide: true }
        );
        if (testResult.isValid) {
            const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
            const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            for (const groupBefore of myGroupsBefore) {
                if (groupBefore.libertyPoints.size === 1) {
                    const matchingAfter = myGroupsAfter.find(ga =>
                        ga.stones.some(ast => groupBefore.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
                    );
                    if (matchingAfter && matchingAfter.libertyPoints.size > 1) {
                        // 자신의 단수 그룹을 살린 경우 - 최우선 점수
                        const groupSize = groupBefore.stones.length;
                        score += 8000 + groupSize * 1000; // 매우 높은 점수로 최우선 처리
                    }
                }
            }
        }

        // 1. 즉시 따내기 기회 (가장 중요)
        const captureScore = evaluateCaptureOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        if (captureScore > 0) {
            score += 5000 + captureScore * 500; // 매우 높은 가중치
        }

        // 2. 아타리(단수) 기회
        const atariScore = evaluateAtariOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        if (atariScore > 0) {
            score += 2000 + atariScore * 200; // 높은 점수
        }

        // 2-1. 유저 돌 근처로 접근 (공격적 접근)
        const proximityScore = evaluateProximityToOpponent(game, logic, point, opponentPlayer);
        score += proximityScore * 300; // 유저 돌 근처로 가는 수

        // 2-2. 공격 기회 평가 (유저 그룹 위협)
        const attackScore = evaluateAttackOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        score += attackScore * 250; // 유저 그룹을 위협하는 수

        // 3. 기본 안전성 (간단한 자유도 체크만)
        // 자충수 체크 (먹여치기/환격수는 예외)
        // testResult는 이미 위에서 선언되었으므로 재사용
        if (testResult.isValid) {
            const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
            if (pointGroup) {
                const libertyCount = pointGroup.libertyPoints.size;
                // 자충수 체크 (활로가 1개이고 따낸 돌이 없으면 자충수)
                if (libertyCount === 1 && testResult.capturedStones.length === 0) {
                    // 자충수인 경우 매우 낮은 점수로 설정
                    score = -100000; // 매우 큰 음수로 설정하여 거의 선택되지 않도록 함
                } else {
                    if (libertyCount >= 3) score += 50;
                    else if (libertyCount >= 2) score += 30;
                    else if (libertyCount >= 1) score += 10;
                }
            }
        }

        // 4. 프로필 기반 가중치 적용
        score *= (1 + profile.captureTendency * 0.5);

        scoredMoves.push({ move, score });
    }

    // 점수 순으로 정렬
    scoredMoves.sort((a, b) => b.score - a.score);

    return scoredMoves;
}

/**
 * 살리기 바둑 모드: AI(백)가 유저(흑)의 돌을 적극적으로 잡으러 오는 전략으로 수를 점수화
 */
function scoreMovesForAggressiveCapture(
    moves: Point[],
    game: types.LiveGameSession,
    profile: GoAiBotProfile,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player,
    opponentPlayer: Player
): Array<{ move: Point; score: number }> {
    const scoredMoves: Array<{ move: Point; score: number }> = [];

    for (const move of moves) {
        let score = 0;
        const point: Point = { x: move.x, y: move.y };

        // 살리기 바둑의 목표: 유저(흑)의 돌을 적극적으로 잡기
        // 하지만 자신의 단수 그룹을 살리는 것은 최우선

        // 0. 자신의 단수 그룹을 살리기 (최우선 - 따내기보다도 우선)
        const testResult = processMove(
            game.boardState,
            { ...point, player: aiPlayer },
            game.koInfo,
            game.moveHistory.length,
            { ignoreSuicide: true }
        );
        if (testResult.isValid) {
            const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
            const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            for (const groupBefore of myGroupsBefore) {
                if (groupBefore.libertyPoints.size === 1) {
                    const matchingAfter = myGroupsAfter.find(ga =>
                        ga.stones.some(ast => groupBefore.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
                    );
                    if (matchingAfter && matchingAfter.libertyPoints.size > 1) {
                        // 자신의 단수 그룹을 살린 경우 - 최우선 점수
                        const groupSize = groupBefore.stones.length;
                        score += 10000 + groupSize * 1500; // 매우 높은 점수로 최우선 처리
                    }
                }
            }
        }

        // 1. 따내기 기회 평가 (최우선) - 유저의 돌을 잡을 수 있는 수
        const captureScore = evaluateCaptureOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        if (captureScore > 0) {
            score += 5000 + captureScore * 800; // 따내기가 최우선 (매우 높은 가중치)
        }

        // 2. 공격 기회 평가 - 유저의 돌을 위협하는 수
        const attackScore = evaluateAttackOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        score += attackScore * 500; // 공격 기회도 매우 높은 점수

        // 3. 유저 돌과의 근접성 평가 - 유저 돌 근처로 가는 수
        const proximityScore = evaluateProximityToOpponent(game, logic, point, opponentPlayer);
        score += proximityScore * 400; // 유저 돌 근처로 접근 (높은 가중치)

        // 4. 유저 그룹을 포위하는 수 평가
        const surroundScore = evaluateSurroundOpportunity(game, logic, point, aiPlayer, opponentPlayer);
        score += surroundScore * 350; // 유저 그룹 포위 (높은 가중치)

        // 5. 전투 성향 반영 - 유저와 전투를 벌이는 수
        const combatScore = evaluateCombat(game, logic, point, aiPlayer, opponentPlayer);
        score += combatScore * 150; // 전투 성향 (가중치 증가)

        // 5-1. 자충수 방지 (먹여치기/환격수는 예외)
        // 단수당한 자신의 돌을 살리는 경우는 이미 위에서 처리됨
        if (testResult.isValid) {
            const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
            if (pointGroup) {
                const libertyCount = pointGroup.libertyPoints.size;
                // 자충수 체크 (활로가 1개이고 따낸 돌이 없으면 자충수)
                if (libertyCount === 1 && testResult.capturedStones.length === 0) {
                    // 자충수인 경우 매우 낮은 점수로 설정
                    score = -100000; // 매우 큰 음수로 설정하여 거의 선택되지 않도록 함
                }
            }
        }

        // 6. 자신의 안전성도 약간 고려 (너무 위험한 수는 피하기)
        const safetyScore = evaluateSafety(game, logic, point, aiPlayer);
        score += safetyScore * 20; // 안전성은 매우 낮은 가중치 (공격 우선)

        // 7. 실수 확률 적용 (공격 모드에서는 실수율 감소)
        if (Math.random() < profile.mistakeRate * 0.3) { // 살리기 공격 모드에서는 실수율 더 감소
            score *= 0.95; // 실수 시에도 점수 감소를 최소화
        }

        scoredMoves.push({ move, score });
    }

    // 점수 순으로 정렬
    scoredMoves.sort((a, b) => b.score - a.score);

    return scoredMoves;
}

/**
 * 공격 기회 평가 - 유저의 돌을 위협할 수 있는 수
 */
function evaluateAttackOpportunity(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    // 이 수를 둔 후 유저의 그룹이 위험해지는지 확인
    const opponentGroups = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
    let attackScore = 0;

    for (const group of opponentGroups) {
        const libertyCount = group.libertyPoints.size;
        // 유저 그룹의 자유도가 적을수록 공격 성공 가능성 높음
        if (libertyCount === 1) {
            attackScore += 5.0; // 다음 턴에 잡을 수 있는 위치 (점수 증가)
        } else if (libertyCount === 2) {
            attackScore += 3.5; // 2턴 안에 잡을 수 있는 위치 (점수 증가)
        } else if (libertyCount === 3) {
            attackScore += 2.0; // 위협적인 위치 (점수 증가)
        } else if (libertyCount === 4) {
            attackScore += 1.0; // 약간 위협적인 위치 (추가)
        }

        // 이 수가 유저 그룹의 자유도를 감소시켰는지 확인 (이전 상태와 비교)
        const oldOpponentGroups = logic.getAllGroups(opponentPlayer, game.boardState);
        const oldGroup = oldOpponentGroups.find(g => 
            g.stones.some(s => group.stones.some(gs => gs.x === s.x && gs.y === s.y))
        );
        if (oldGroup && libertyCount < oldGroup.libertyPoints.size) {
            attackScore += 2.5; // 자유도를 줄인 수 (점수 증가)
        }
    }

    return attackScore;
}

/**
 * 유저 돌과의 근접성 평가 - 유저 돌 근처로 가는 수
 */
function evaluateProximityToOpponent(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    opponentPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let minDistance = Infinity;
    let nearbyOpponentStones = 0;

    // 모든 유저 돌과의 최단 거리 계산
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] === opponentPlayer) {
                const distance = Math.abs(point.x - x) + Math.abs(point.y - y);
                minDistance = Math.min(minDistance, distance);
                
                // 근처의 유저 돌 개수 (거리 2 이내)
                if (distance <= 2) {
                    nearbyOpponentStones++;
                }
            }
        }
    }

    // 거리가 가까울수록 높은 점수 (공격적)
    if (minDistance === Infinity) return 0.0; // 유저 돌이 없음
    if (minDistance === 1) return 2.0; // 바로 인접 (최고 점수, 점수 증가)
    if (minDistance === 2) return 1.5; // 2칸 거리 (점수 증가)
    if (minDistance === 3) return 1.0; // 3칸 거리 (점수 증가)
    if (minDistance === 4) return 0.5; // 4칸 거리 (점수 증가)
    if (minDistance >= 5) return 0.1; // 멀면 낮은 점수

    // 근처에 유저 돌이 많을수록 더 높은 점수
    return Math.min(2.0, nearbyOpponentStones / 2.0); // 최대 점수 증가
}

/**
 * 유저 그룹 포위 기회 평가
 */
function evaluateSurroundOpportunity(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    const boardSize = game.settings.boardSize;
    let surroundScore = 0;

    // 이 수 주변의 유저 그룹 확인
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];

    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
            if (testResult.newBoardState[ny][nx] === opponentPlayer) {
                // 유저 돌과 인접한 위치에 자신의 돌을 둠
                const opponentGroups = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
                const nearbyGroup = opponentGroups.find(g => 
                    g.stones.some(p => p.x === nx && p.y === ny)
                );
                
                if (nearbyGroup) {
                    const libertyCount = nearbyGroup.libertyPoints.size;
                    // 유저 그룹을 포위하는 수일수록 높은 점수
                    if (libertyCount === 1) {
                        surroundScore += 4.0; // 거의 잡을 수 있는 위치 (점수 증가)
                    } else if (libertyCount === 2) {
                        surroundScore += 3.0; // 위험한 위치 (점수 증가)
                    } else if (libertyCount === 3) {
                        surroundScore += 2.0; // 포위 중 (점수 증가)
                    } else if (libertyCount === 4) {
                        surroundScore += 1.0; // 약간 포위 (추가)
                    }
                }
            }
        }
    }

    return surroundScore;
}

/**
 * 안전성 평가 (자신의 그룹을 살리는 수)
 */
function evaluateSafety(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return -1.0; // 자살수는 매우 위험

    // 자신의 그룹의 자유도 확인
    const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup) {
        const libertyCount = pointGroup.libertyPoints.size;
        if (libertyCount >= 3) return 1.0; // 매우 안전
        if (libertyCount >= 2) return 0.7; // 안전
        if (libertyCount >= 1) return 0.3; // 위험
        return 0.0; // 매우 위험 (자유도 없음)
    }

    return 0.5; // 새로운 그룹 생성
}

/**
 * 포위된 그룹의 탈출 평가 (넓은 방향으로 연결하며 탈출)
 */
function evaluateEscapeFromSurround(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let escapeScore = 0;
    const myGroups = logic.getAllGroups(aiPlayer, game.boardState);
    const opponentGroups = logic.getAllGroups(opponentPlayer, game.boardState);

    // 자신의 그룹 중 포위당한 그룹 찾기
    for (const myGroup of myGroups) {
        const libertyCount = myGroup.libertyPoints.size;
        
        // 활로가 적은 그룹 (포위당한 그룹)
        if (libertyCount <= 3) {
            // 이 수로 이 그룹과 연결되는지 확인
            const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
            const connectedGroup = myGroupsAfter.find(ga =>
                ga.stones.some(ast => myGroup.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
            );

            if (connectedGroup) {
                const newLibertyCount = connectedGroup.libertyPoints.size;
                
                // 활로가 증가했으면 탈출 시도
                if (newLibertyCount > libertyCount) {
                    const libertyIncrease = newLibertyCount - libertyCount;
                    
                    // 활로 증가량에 따라 점수 부여
                    escapeScore += 3.0 + libertyIncrease * 2.0; // 기본 3점 + 활로 증가당 2점
                    
                    // 넓은 방향으로 탈출하는지 확인
                    // 주변의 빈 공간(활로) 개수 확인
                    const directions = [
                        { x: -1, y: 0 }, { x: 1, y: 0 },
                        { x: 0, y: -1 }, { x: 0, y: 1 }
                    ];
                    
                    let wideDirectionScore = 0;
                    for (const dir of directions) {
                        const nx = point.x + dir.x;
                        const ny = point.y + dir.y;
                        if (nx >= 0 && nx < game.settings.boardSize && ny >= 0 && ny < game.settings.boardSize) {
                            const cell = testResult.newBoardState[ny][nx];
                            if (cell === Player.None) {
                                // 빈 공간이면 넓은 방향
                                wideDirectionScore += 1.0;
                            }
                        }
                    }
                    
                    // 넓은 방향으로 탈출하면 추가 점수
                    if (wideDirectionScore >= 2) {
                        escapeScore += 2.0; // 넓은 방향으로 탈출
                    }
                    
                    // 상대 그룹이 근처에 있으면 더 긴급함
                    for (const oppGroup of opponentGroups) {
                        for (const stone of oppGroup.stones) {
                            const distance = Math.abs(point.x - stone.x) + Math.abs(point.y - stone.y);
                            if (distance <= 2) {
                                escapeScore += 1.5; // 상대 그룹 근처 탈출은 더 중요
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    return escapeScore;
}

/**
 * 도망 평가 (상대 돌과 멀어지는 수)
 */
function evaluateEscape(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let escapeScore = 0;

    // 자신의 돌들의 평균 위치 계산
    let totalX = 0, totalY = 0, count = 0;
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] === aiPlayer) {
                totalX += x;
                totalY += y;
                count++;
            }
        }
    }

    if (count === 0) return 0.5; // 자신의 돌이 없음

    const avgX = totalX / count;
    const avgY = totalY / count;

    // 자신의 돌들과의 거리 (너무 멀면 안됨, 적당히 떨어져야 함)
    const distanceFromGroup = Math.abs(point.x - avgX) + Math.abs(point.y - avgY);
    if (distanceFromGroup >= 1 && distanceFromGroup <= 3) {
        escapeScore += 0.8; // 적당한 거리로 이동
    }

    // 상대 돌들과의 거리
    let minOpponentDistance = Infinity;
    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (game.boardState[y][x] === opponentPlayer) {
                const distance = Math.abs(point.x - x) + Math.abs(point.y - y);
                minOpponentDistance = Math.min(minOpponentDistance, distance);
            }
        }
    }

    if (minOpponentDistance >= 3) {
        escapeScore += 0.5; // 상대와 멀리 떨어짐
    }

    return escapeScore;
}

/**
 * 자유도 증가 평가
 */
function evaluateLibertyGain(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup) {
        const libertyCount = pointGroup.libertyPoints.size;
        // 자유도가 많을수록 좋음
        return Math.min(1.0, libertyCount / 5.0);
    }

    return 0.3; // 새로운 그룹
}

/**
 * 그룹의 가치 평가 (살리기 vs 따내기 판단용)
 */
function evaluateGroupValue(
    group: { stones: Point[]; liberties: number; libertyPoints: Set<string>; player: Player },
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    aiPlayer: Player,
    profile: GoAiBotProfile
): number {
    const boardSize = game.settings.boardSize;
    let value = 0;
    
    // 1. 그룹 크기 (큰 그룹일수록 더 가치 있음)
    const groupSize = group.stones.length;
    value += groupSize * 2.0; // 그룹 크기당 2점
    
    // 2. 그룹의 위치 (중앙에 가까울수록 더 가치 있음)
    let avgX = 0, avgY = 0;
    for (const stone of group.stones) {
        avgX += stone.x;
        avgY += stone.y;
    }
    avgX /= groupSize;
    avgY /= groupSize;
    const centerX = boardSize / 2;
    const centerY = boardSize / 2;
    const distanceFromCenter = Math.abs(avgX - centerX) + Math.abs(avgY - centerY);
    const maxDistance = boardSize;
    const centrality = 1.0 - (distanceFromCenter / maxDistance);
    value += centrality * 5.0; // 중앙에 가까울수록 더 가치 있음
    
    // 3. 그룹의 활로 수 (활로가 많을수록 더 가치 있음)
    const libertyCount = group.libertyPoints.size;
    value += libertyCount * 1.5; // 활로당 1.5점
    
    // 4. 게임 진행 상황 (후반일수록 큰 그룹이 더 중요)
    const moveCount = game.moveHistory.length;
    const totalSpaces = boardSize * boardSize;
    const gameProgress = Math.min(1.0, moveCount / (totalSpaces * 0.7)); // 70% 진행 시 1.0
    if (gameProgress > 0.6) {
        // 후반일수록 큰 그룹의 가치 증가
        value += groupSize * gameProgress * 1.5;
    }
    
    // 5. AI 난이도에 따른 가치 판단 능력 (높을수록 더 정확한 판단)
    const judgmentSkill = profile.lifeDeathSkill;
    value *= (0.7 + judgmentSkill * 0.3); // 낮은 난이도는 가치를 약간 낮게 평가
    
    return value;
}

/**
 * 2단계: 자충수 방지 평가
 */
function evaluateSelfAtari(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 1.0; // 자충수는 1.0 반환 (패널티)

    const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup) {
        const libertyCount = pointGroup.libertyPoints.size;
        // 자유도가 1이면 자충수
        if (libertyCount === 1) {
            // 하지만 따낼 수 있으면 괜찮음 (먹여치기)
            if (testResult.capturedStones.length > 0) {
                return 0.0; // 먹여치기는 괜찮음
            }
            return 1.0; // 자충수
        }
    }

    return 0.0; // 자충수 아님
}

/**
 * 3단계: 먹여치기 및 환격 평가
 */
function evaluateSacrificeAndCounter(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let score = 0;

    // 먹여치기: 자충수를 두지만 상대를 따낼 수 있는 경우
    const groups = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = groups.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup && pointGroup.libertyPoints.size === 1 && testResult.capturedStones.length > 0) {
        score += 3.0; // 먹여치기
    }

    // 환격: 상대가 따내려고 할 때 역으로 따내기
    // 상대 그룹이 단수 상태이고, 이 수로 역으로 따낼 수 있는 경우
    const opponentGroups = logic.getAllGroups(opponentPlayer, game.boardState);
    for (const oppGroup of opponentGroups) {
        if (oppGroup.libertyPoints.size === 1) {
            const liberty = Array.from(oppGroup.libertyPoints)[0];
            const [lx, ly] = liberty.split(',').map(Number);
            if (lx === point.x && ly === point.y) {
                // 상대의 단수 자리에 두어서 역으로 따낼 수 있는 경우
                if (testResult.capturedStones.length > 0) {
                    score += 4.0; // 환격
                }
            }
        }
    }

    return score;
}

/**
 * 4단계: 단수 상황 판단 (따내기 vs 살리기)
 */
function evaluateAtariJudgment(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let score = 0;

    // 상대 그룹을 단수로 만들 수 있는 경우
    const opponentGroupsBefore = logic.getAllGroups(opponentPlayer, game.boardState);
    const opponentGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);

    for (const groupAfter of opponentGroupsAfter) {
        if (groupAfter.libertyPoints.size === 1) {
            const matchingBefore = opponentGroupsBefore.find(gb =>
                gb.stones.some(bs => groupAfter.stones.some(as => as.x === bs.x && as.y === bs.y))
            );
            if (matchingBefore && matchingBefore.libertyPoints.size > 1) {
                // 상대 그룹을 단수로 만든 경우
                score += 2.0;
            }
        }
    }

    // 자신의 그룹이 단수 상태일 때 살리기 (최우선)
    const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
    const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    
    for (const groupBefore of myGroupsBefore) {
        if (groupBefore.libertyPoints.size === 1) {
            const matchingAfter = myGroupsAfter.find(ga =>
                ga.stones.some(ast => groupBefore.stones.some(bst => ast.x === bst.x && ast.y === bst.y))
            );
            if (matchingAfter && matchingAfter.libertyPoints.size > 1) {
                // 자신의 단수 그룹을 살린 경우 - 매우 높은 점수 (최우선)
                const groupSize = groupBefore.stones.length;
                // 그룹 크기에 따라 점수 차등 (큰 그룹일수록 더 중요)
                score += 15.0 + groupSize * 2.0; // 기본 15점 + 그룹 크기당 2점
            }
        }
    }

    return score;
}

/**
 * 5단계: 방향성 공격 평가
 */
function evaluateDirectionalAttack(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let score = 0;

    // 1선 방향으로 몰기 (변으로 몰기)
    const isEdge = point.x === 0 || point.x === boardSize - 1 || point.y === 0 || point.y === boardSize - 1;
    if (isEdge) {
        // 상대 돌이 근처에 있으면 변으로 몰기
        const directions = [
            { x: -1, y: 0 }, { x: 1, y: 0 },
            { x: 0, y: -1 }, { x: 0, y: 1 }
        ];
        for (const dir of directions) {
            const nx = point.x + dir.x;
            const ny = point.y + dir.y;
            if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
                if (game.boardState[ny][nx] === opponentPlayer) {
                    score += 1.5; // 변으로 몰기
                }
            }
        }
    }

    // 우리편 방향으로 몰기
    const myGroups = logic.getAllGroups(aiPlayer, game.boardState);
    if (myGroups.length > 0) {
        const nearestGroup = myGroups.reduce((nearest, group) => {
            const groupCenter = {
                x: group.stones.reduce((sum, s) => sum + s.x, 0) / group.stones.length,
                y: group.stones.reduce((sum, s) => sum + s.y, 0) / group.stones.length
            };
            const dist = Math.abs(point.x - groupCenter.x) + Math.abs(point.y - groupCenter.y);
            return dist < nearest.dist ? { group, dist } : nearest;
        }, { group: myGroups[0], dist: Infinity });

        const groupCenter = {
            x: nearestGroup.group.stones.reduce((sum, s) => sum + s.x, 0) / nearestGroup.group.stones.length,
            y: nearestGroup.group.stones.reduce((sum, s) => sum + s.y, 0) / nearestGroup.group.stones.length
        };
        
        // 우리편 그룹 방향으로 상대를 몰기
        const oppGroups = logic.getAllGroups(opponentPlayer, game.boardState);
        for (const oppGroup of oppGroups) {
            const oppCenter = {
                x: oppGroup.stones.reduce((sum, s) => sum + s.x, 0) / oppGroup.stones.length,
                y: oppGroup.stones.reduce((sum, s) => sum + s.y, 0) / oppGroup.stones.length
            };
            
            // 상대 그룹이 우리편 그룹과 이 수 사이에 있으면 좋음
            const toMyGroup = { x: groupCenter.x - point.x, y: groupCenter.y - point.y };
            const toOppGroup = { x: oppCenter.x - point.x, y: oppCenter.y - point.y };
            const dotProduct = toMyGroup.x * toOppGroup.x + toMyGroup.y * toOppGroup.y;
            if (dotProduct > 0) {
                score += 2.0; // 우리편 방향으로 몰기
            }
        }
    }

    // 도망치기 힘든 방향으로 몰기 (변과 모서리)
    if (isEdge) {
        const isCorner = (point.x === 0 || point.x === boardSize - 1) && 
                         (point.y === 0 || point.y === boardSize - 1);
        if (isCorner) {
            score += 2.5; // 모서리는 도망치기 매우 힘듦
        } else {
            score += 1.5; // 변은 도망치기 힘듦
        }
    }

    return score;
}

/**
 * 6단계: 초반 포석 평가 (3-4선 선호)
 * AI 레벨에 따라 선의 높이 선호도가 달라짐
 */
function evaluateFuseki(
    game: types.LiveGameSession,
    point: Point,
    aiPlayer: Player,
    aiLevel: number
): number {
    const boardSize = game.settings.boardSize;
    const moveCount = game.moveHistory.length;
    
    if (moveCount > 50) return 0; // 초반 50수까지만

    let score = 0;

    // 선의 높이 계산 (1선 = 가장자리, 2선, 3선, 4선...)
    const distanceFromEdge = Math.min(
        point.x,
        point.y,
        boardSize - 1 - point.x,
        boardSize - 1 - point.y
    );
    const line = distanceFromEdge + 1; // 1선부터 시작

    // AI 레벨에 따른 선의 높이 선호도
    if (aiLevel >= 7) {
        // 최고 등급 (7-10단계): 3-4선 주로, 가끔 2선과 5선, 1선과 6선 이상은 거의 안 둠
        if (line === 3 || line === 4) {
            score += 5.0; // 3-4선: 매우 높은 점수
        } else if (line === 2 || line === 5) {
            score += 0.5; // 2선, 5선: 약간의 점수 (가끔)
        } else if (line === 1) {
            score -= 10.0; // 1선: 매우 큰 패널티 (거의 안 둠)
        } else if (line >= 6) {
            score -= 8.0; // 6선 이상: 큰 패널티 (거의 안 둠)
        }
    } else if (aiLevel >= 4) {
        // 중간 등급 (4-6단계): 3-4선 선호, 2선과 5선은 약간 패널티, 1선과 6선 이상은 패널티
        if (line === 3 || line === 4) {
            score += 3.0; // 3-4선: 높은 점수
        } else if (line === 2 || line === 5) {
            score -= 1.0; // 2선, 5선: 약간 패널티
        } else if (line === 1) {
            score -= 3.0; // 1선: 패널티
        } else if (line >= 6) {
            score -= 2.0; // 6선 이상: 패널티
        }
    } else {
        // 하위 등급 (1-3단계): 기존 로직 유지
        if (line === 3 || line === 4) {
            score += 2.0; // 좋은 선
        } else if (line === 1) {
            score -= 1.5; // 1선은 나쁨
        } else if (line === 2) {
            score -= 1.0; // 2선도 나쁨
        } else {
            score -= 0.5; // 5선 이상도 나쁨
        }
    }

    // 모서리 3-3, 3-4, 4-4 등 좋은 포석 위치
    const cornerPositions = [
        { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 3 },
        { x: boardSize - 3, y: 2 }, { x: boardSize - 3, y: 3 },
        { x: boardSize - 4, y: 2 }, { x: boardSize - 4, y: 3 },
        { x: 2, y: boardSize - 3 }, { x: 3, y: boardSize - 3 },
        { x: 2, y: boardSize - 4 }, { x: 3, y: boardSize - 4 },
        { x: boardSize - 3, y: boardSize - 3 }, { x: boardSize - 4, y: boardSize - 3 },
        { x: boardSize - 3, y: boardSize - 4 }, { x: boardSize - 4, y: boardSize - 4 },
    ];

    for (const pos of cornerPositions) {
        if (point.x === pos.x && point.y === pos.y) {
            score += 3.0; // 정석 위치
            break;
        }
    }

    return score;
}

/**
 * 7단계: 영토 확보 및 전투 평가
 */
function evaluateTerritoryAndCombat(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    let score = 0;

    // 적은 돌로 많은 영토 확보
    const territoryScore = evaluateTerritory(game, logic, point, aiPlayer);
    const combatScore = evaluateCombat(game, logic, point, aiPlayer, opponentPlayer);
    
    // 영토와 전투의 균형
    score += territoryScore * 0.6 + combatScore * 0.4;

    // 영토를 넓히기 위해 상대와 부딪혀 싸우기
    if (combatScore > 0) {
        score += 1.0; // 전투를 통한 영토 확보
    }

    return score;
}

/**
 * 8단계: 고급 기술 평가 (촉촉수, 축, 장문, 환격, 먹여치기)
 */
function evaluateAdvancedTechniques(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    let score = 0;

    // 촉촉수: 연속 단수공격할 수 있는 방향으로 3수 앞 내다보기
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    // 상대 그룹을 단수로 만들고, 다음에도 계속 단수 공격 가능한지 확인
    const opponentGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
    for (const group of opponentGroupsAfter) {
        if (group.libertyPoints.size === 1) {
            // 다음 수에도 단수 공격 가능한지 시뮬레이션
            const liberty = Array.from(group.libertyPoints)[0];
            const [lx, ly] = liberty.split(',').map(Number);
            const nextMoveResult = processMove(
                testResult.newBoardState,
                { x: lx, y: ly, player: aiPlayer },
                null,
                game.moveHistory.length + 1,
                { ignoreSuicide: true }
            );
            if (nextMoveResult.isValid) {
                const nextOppGroups = logic.getAllGroups(opponentPlayer, nextMoveResult.newBoardState);
                for (const nextGroup of nextOppGroups) {
                    if (nextGroup.libertyPoints.size === 1) {
                        score += 3.0; // 촉촉수
                    }
                }
            }
        }
    }

    // 축: 상대 돌을 포위하는 수
    const directions = [
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: -1 }, { x: 0, y: 1 }
    ];
    for (const dir of directions) {
        const nx = point.x + dir.x;
        const ny = point.y + dir.y;
        if (nx >= 0 && nx < game.settings.boardSize && ny >= 0 && ny < game.settings.boardSize) {
            if (testResult.newBoardState[ny][nx] === opponentPlayer) {
                const oppGroups = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
                const nearbyGroup = oppGroups.find(g => g.stones.some(s => s.x === nx && s.y === ny));
                if (nearbyGroup && nearbyGroup.libertyPoints.size <= 2) {
                    score += 2.0; // 축
                }
            }
        }
    }

    // 장문: 긴 연결을 만드는 수
    const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = myGroupsAfter.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    if (pointGroup && pointGroup.stones.length >= 3) {
        score += 1.5; // 장문
    }

    // 환격과 먹여치기는 이미 evaluateSacrificeAndCounter에서 평가됨
    const sacrificeScore = evaluateSacrificeAndCounter(game, logic, point, aiPlayer, opponentPlayer);
    score += sacrificeScore * 0.5;

    return score;
}

/**
 * 9단계: 연결과 끊음 평가
 */
function evaluateConnectionAndCut(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let score = 0;

    // 자신의 그룹 연결
    const myGroupsBefore = logic.getAllGroups(aiPlayer, game.boardState);
    const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    
    if (myGroupsAfter.length < myGroupsBefore.length) {
        // 그룹이 연결됨
        score += 2.0;
    }

    // 상대 그룹 끊기
    const oppGroupsBefore = logic.getAllGroups(opponentPlayer, game.boardState);
    const oppGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
    
    if (oppGroupsAfter.length > oppGroupsBefore.length) {
        // 상대 그룹을 끊음
        score += 3.0; // 끊기가 더 중요
    }

    return score;
}

/**
 * 9단계: 고급 사활 판단
 */
function evaluateLifeDeathAdvanced(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    let score = 0;

    // 떨어진 두 개 이상의 집을 만들어 살리기
    const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = myGroupsAfter.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup) {
        // 그룹이 두 개 이상의 독립적인 공간(집)을 가지고 있는지 확인
        // 간단한 휴리스틱: 자유도가 많고 돌이 많으면 살 가능성 높음
        if (pointGroup.libertyPoints.size >= 4 && pointGroup.stones.length >= 3) {
            score += 2.0; // 살 가능성
        }
    }

    // 떨어진 두 개 이상의 집을 만들지 못하게 하여 잡기
    const oppGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
    for (const oppGroup of oppGroupsAfter) {
        if (oppGroup.libertyPoints.size <= 2 && oppGroup.stones.length >= 2) {
            // 상대 그룹이 집을 만들기 어려운 상태
            score += 2.5; // 잡을 가능성
        }
    }

    return score;
}

/**
 * 9단계: 고급 행마 평가
 */
function evaluateMovementAdvanced(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player
): number {
    const boardSize = game.settings.boardSize;
    let score = 0;

    // 내 돌이 끊어지지 않고 가장 멀리 움직이기
    const myGroups = logic.getAllGroups(aiPlayer, game.boardState);
    if (myGroups.length > 0) {
        let maxDistance = 0;
        for (const group of myGroups) {
            const groupCenter = {
                x: group.stones.reduce((sum, s) => sum + s.x, 0) / group.stones.length,
                y: group.stones.reduce((sum, s) => sum + s.y, 0) / group.stones.length
            };
            const distance = Math.abs(point.x - groupCenter.x) + Math.abs(point.y - groupCenter.y);
            maxDistance = Math.max(maxDistance, distance);
        }
        
        // 적당한 거리 (2-4)로 이동하는 것이 좋음
        if (maxDistance >= 2 && maxDistance <= 4) {
            score += 1.5;
        }
    }

    // 행마 패턴 인식
    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (testResult.isValid) {
        const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
        const pointGroup = myGroupsAfter.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
        
        if (pointGroup) {
            // 입구자행마: 두 돌 사이에 두기
            const neighbors = logic.getNeighbors(point.x, point.y);
            let myNeighborCount = 0;
            for (const n of neighbors) {
                if (testResult.newBoardState[n.y][n.x] === aiPlayer) {
                    myNeighborCount++;
                }
            }
            if (myNeighborCount === 2) {
                score += 1.0; // 입구자행마
            }

            // 날일자행마: 한 칸 뛰기
            if (myGroups.length > 0) {
                const nearestGroup = myGroups[0];
                const groupCenter = {
                    x: nearestGroup.stones.reduce((sum, s) => sum + s.x, 0) / nearestGroup.stones.length,
                    y: nearestGroup.stones.reduce((sum, s) => sum + s.y, 0) / nearestGroup.stones.length
                };
                const distance = Math.abs(point.x - groupCenter.x) + Math.abs(point.y - groupCenter.y);
                if (distance === 2) {
                    score += 1.0; // 날일자행마
                }
            }

            // 눈목자행마: 대각선으로 두 칸
            // 밭전자행마: 직선으로 두 칸
            // 쌍점행마: 두 점에 동시에 두기 (연결)
            if (pointGroup.stones.length >= 2) {
                score += 0.5; // 행마 패턴
            }
        }
    }

    return score;
}

/**
 * 10단계: 마무리 평가 (집 지키기/부수기)
 */
function evaluateEndgame(
    game: types.LiveGameSession,
    logic: ReturnType<typeof getGoLogic>,
    point: Point,
    aiPlayer: Player,
    opponentPlayer: Player
): number {
    let score = 0;

    const testResult = processMove(
        game.boardState,
        { ...point, player: aiPlayer },
        game.koInfo,
        game.moveHistory.length,
        { ignoreSuicide: true }
    );

    if (!testResult.isValid) return 0;

    // 한 집이라도 더 지키기
    const myGroupsAfter = logic.getAllGroups(aiPlayer, testResult.newBoardState);
    const pointGroup = myGroupsAfter.find(g => g.stones.some(p => p.x === point.x && p.y === point.y));
    
    if (pointGroup) {
        // 그룹 주변의 빈 공간(집) 계산
        const emptySpaces = new Set<string>();
        for (const stone of pointGroup.stones) {
            const neighbors = logic.getNeighbors(stone.x, stone.y);
            for (const n of neighbors) {
                if (testResult.newBoardState[n.y][n.x] === types.Player.None) {
                    emptySpaces.add(`${n.x},${n.y}`);
                }
            }
        }
        score += emptySpaces.size * 0.5; // 집 지키기
    }

    // 한 집이라도 더 부수기
    const oppGroupsAfter = logic.getAllGroups(opponentPlayer, testResult.newBoardState);
    for (const oppGroup of oppGroupsAfter) {
        // 상대 그룹 주변의 빈 공간을 줄이기
        const emptySpaces = new Set<string>();
        for (const stone of oppGroup.stones) {
            const neighbors = logic.getNeighbors(stone.x, stone.y);
            for (const n of neighbors) {
                if (testResult.newBoardState[n.y][n.x] === types.Player.None) {
                    emptySpaces.add(`${n.x},${n.y}`);
                }
            }
        }
        
        // 이 수가 상대 그룹의 집을 줄였는지 확인
        const oppGroupsBefore = logic.getAllGroups(opponentPlayer, game.boardState);
        const matchingBefore = oppGroupsBefore.find(gb =>
            gb.stones.some(bs => oppGroup.stones.some(as => as.x === bs.x && as.y === bs.y))
        );
        if (matchingBefore) {
            const beforeEmptySpaces = new Set<string>();
            for (const stone of matchingBefore.stones) {
                const neighbors = logic.getNeighbors(stone.x, stone.y);
                for (const n of neighbors) {
                    if (game.boardState[n.y][n.x] === types.Player.None) {
                        beforeEmptySpaces.add(`${n.x},${n.y}`);
                    }
                }
            }
            if (emptySpaces.size < beforeEmptySpaces.size) {
                score += (beforeEmptySpaces.size - emptySpaces.size) * 0.8; // 집 부수기
            }
        }
    }

    return score;
}

