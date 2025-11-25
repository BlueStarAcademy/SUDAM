import { GameMode, GameSettings } from '../types/index.js';
import { AlkkagiLayoutType } from '../types/enums.js';

// 랭킹전 기본 설정
export const RANKED_GAME_SETTINGS: Record<GameMode, GameSettings> = {
    // 전략바둑
    [GameMode.Standard]: {
        boardSize: 19,
        komi: 6.5,
        timeLimit: 5, // 5분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0, // 초읽기 방식
        autoScoring: false,
    },
    [GameMode.Capture]: {
        boardSize: 13,
        komi: 0,
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        captureTarget: 20, // 20점 획득시 승리
        autoScoring: false,
    },
    [GameMode.Speed]: {
        boardSize: 13,
        komi: 6.5,
        timeLimit: 1, // 1분
        byoyomiTime: 0,
        byoyomiCount: 0,
        timeIncrement: 5, // 피셔 방식 5초 추가
        autoScoring: true, // 서로 통과시 계가
    },
    [GameMode.Base]: {
        boardSize: 13,
        komi: 0, // 베이스바둑은 입찰로 결정
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        autoScoring: true, // 서로 통과시 계가
    },
    [GameMode.Hidden]: {
        boardSize: 13,
        komi: 6.5,
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        hiddenStoneCount: 1, // 히든 아이템 1개
        scanCount: 2, // 스캔 아이템 2개
        autoScoring: true, // 서로 통과시 계가
    },
    [GameMode.Missile]: {
        boardSize: 13,
        komi: 6.5,
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        missileCount: 3, // 미사일 아이템 3개
        autoScoring: true, // 서로 통과시 계가
    },
    [GameMode.Mix]: {
        // 믹스룰은 랭킹전 제외
        boardSize: 13,
        komi: 6.5,
        timeLimit: 3,
        byoyomiTime: 30,
        byoyomiCount: 3,
        timeIncrement: 0,
        autoScoring: false,
    },
    // 놀이바둑
    [GameMode.Dice]: {
        boardSize: 19,
        komi: 0,
        diceGoRounds: 3, // 3라운드
        timeLimit: 0,
        byoyomiTime: 0,
        byoyomiCount: 0,
        timeIncrement: 0,
        autoScoring: false,
    },
    [GameMode.Omok]: {
        boardSize: 19,
        komi: 0,
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        has33Forbidden: true, // 삼삼금지
        hasOverlineForbidden: true, // 장목(6목이상)금지
        autoScoring: false,
    },
    [GameMode.Ttamok]: {
        boardSize: 19,
        komi: 0,
        timeLimit: 3, // 3분
        byoyomiTime: 30, // 30초
        byoyomiCount: 3,
        timeIncrement: 0,
        captureTarget: 20, // 20점 달성 승리
        has33Forbidden: true, // 삼삼금지
        hasOverlineForbidden: true, // 장목(6목이상)금지
        autoScoring: false,
    },
    [GameMode.Thief]: {
        boardSize: 19,
        komi: 0,
        timeLimit: 0,
        byoyomiTime: 0,
        byoyomiCount: 0,
        timeIncrement: 0,
        autoScoring: false,
    },
    [GameMode.Alkkagi]: {
        boardSize: 13,
        komi: 0,
        alkkagiRounds: 3, // 3라운드
        alkkagiLayout: AlkkagiLayoutType.Normal, // 일반배치
        alkkagiStoneCount: 5, // 5개 배치
        alkkagiGaugeSpeed: 3, // 게이지속도 빠름 x3
        alkkagiSlowItemCount: 2, // 슬로우 2개
        alkkagiAimingLineItemCount: 2, // 조준선 2개
        timeLimit: 0,
        byoyomiTime: 0,
        byoyomiCount: 0,
        timeIncrement: 0,
        autoScoring: false,
    },
    [GameMode.Curling]: {
        boardSize: 13,
        komi: 0,
        curlingRounds: 3, // 3라운드
        curlingGaugeSpeed: 3, // 게이지속도 빠름 x3
        curlingSlowItemCount: 2, // 슬로우 2개
        curlingAimingLineItemCount: 2, // 조준선 2개
        curlingStoneCount: 5, // 5개 스톤 사용
        timeLimit: 0,
        byoyomiTime: 0,
        byoyomiCount: 0,
        timeIncrement: 0,
        autoScoring: false,
    },
};

// 랭킹전에서 사용 가능한 게임 모드 (믹스룰 제외)
export const RANKED_AVAILABLE_MODES: GameMode[] = [
    GameMode.Standard,
    GameMode.Capture,
    GameMode.Speed,
    GameMode.Base,
    GameMode.Hidden,
    GameMode.Missile,
    // 믹스룰 제외
    GameMode.Dice,
    GameMode.Omok,
    GameMode.Ttamok,
    GameMode.Thief,
    GameMode.Alkkagi,
    GameMode.Curling,
];

// 전략바둑 랭킹전 모드
export const RANKED_STRATEGIC_MODES: GameMode[] = [
    GameMode.Standard,
    GameMode.Capture,
    GameMode.Speed,
    GameMode.Base,
    GameMode.Hidden,
    GameMode.Missile,
];

// 놀이바둑 랭킹전 모드
export const RANKED_PLAYFUL_MODES: GameMode[] = [
    GameMode.Dice,
    GameMode.Omok,
    GameMode.Ttamok,
    GameMode.Thief,
    GameMode.Alkkagi,
    GameMode.Curling,
];

// 랭킹전 설정 가져오기
export const getRankedGameSettings = (mode: GameMode): GameSettings => {
    return RANKED_GAME_SETTINGS[mode] || RANKED_GAME_SETTINGS[GameMode.Standard];
};

