
import { TournamentDefinition, TournamentType, QuestReward } from '../types/index.js';
import { LeagueTier } from '../types/enums.js';

export const TOURNAMENT_DEFINITIONS: Record<TournamentType, TournamentDefinition> = {
    neighborhood: { id: 'neighborhood', name: '동네바둑리그', description: '6인 풀리그 방식으로 진행됩니다. 가장 많은 승리를 거두세요!', format: 'round-robin', players: 6, image: '/images/championship/Champ1.png' },
    national: { id: 'national', name: '전국바둑대회', description: '예선을 거쳐 8강 토너먼트로 최강자를 가립니다.', format: 'tournament', players: 8, image: '/images/championship/Champ2.png' },
    world: { id: 'world', name: '월드챔피언십', description: '세계 각국의 강자들이 모인 16강 토너먼트입니다.', format: 'tournament', players: 16, image: '/images/championship/Champ3.png' },
};

export type TournamentRewardInfo = QuestReward;

// 동네바둑리그 리그별 경기 보상 (승리/패배)
export const NEIGHBORHOOD_MATCH_REWARDS: Record<LeagueTier, { win: number; loss: number }> = {
    [LeagueTier.Sprout]: { win: 100, loss: 50 },
    [LeagueTier.Rookie]: { win: 200, loss: 75 },
    [LeagueTier.Rising]: { win: 300, loss: 100 },
    [LeagueTier.Ace]: { win: 500, loss: 150 },
    [LeagueTier.Diamond]: { win: 1000, loss: 200 },
    [LeagueTier.Master]: { win: 1500, loss: 300 },
    [LeagueTier.Grandmaster]: { win: 2000, loss: 500 },
    [LeagueTier.Challenger]: { win: 3000, loss: 1000 },
};

// 전국바둑대회 리그별 경기 보상 (승리/패배) - 강화석
export const NATIONAL_MATCH_REWARDS: Record<LeagueTier, { win: { materialName: string; quantity: number }; loss: { materialName: string; quantity: number } }> = {
    [LeagueTier.Sprout]: { win: { materialName: '하급 강화석', quantity: 10 }, loss: { materialName: '하급 강화석', quantity: 4 } },
    [LeagueTier.Rookie]: { win: { materialName: '중급 강화석', quantity: 10 }, loss: { materialName: '중급 강화석', quantity: 4 } },
    [LeagueTier.Rising]: { win: { materialName: '중급 강화석', quantity: 20 }, loss: { materialName: '중급 강화석', quantity: 8 } },
    [LeagueTier.Ace]: { win: { materialName: '상급 강화석', quantity: 10 }, loss: { materialName: '상급 강화석', quantity: 4 } },
    [LeagueTier.Diamond]: { win: { materialName: '상급 강화석', quantity: 20 }, loss: { materialName: '상급 강화석', quantity: 8 } },
    [LeagueTier.Master]: { win: { materialName: '최상급 강화석', quantity: 5 }, loss: { materialName: '최상급 강화석', quantity: 2 } },
    [LeagueTier.Grandmaster]: { win: { materialName: '최상급 강화석', quantity: 10 }, loss: { materialName: '최상급 강화석', quantity: 4 } },
    [LeagueTier.Challenger]: { win: { materialName: '신비의 강화석', quantity: 10 }, loss: { materialName: '신비의 강화석', quantity: 4 } },
};

// 월드챔피언십 리그별 경기 보상 (승리/패배) - 장비상자
export const WORLD_MATCH_REWARDS: Record<LeagueTier, { win: { boxName: string; quantity: number }; loss: { boxName: string; quantity: number } }> = {
    [LeagueTier.Sprout]: { win: { boxName: '장비 상자 I', quantity: 2 }, loss: { boxName: '장비 상자 I', quantity: 1 } },
    [LeagueTier.Rookie]: { win: { boxName: '장비 상자 I', quantity: 4 }, loss: { boxName: '장비 상자 I', quantity: 2 } },
    [LeagueTier.Rising]: { win: { boxName: '장비 상자 II', quantity: 2 }, loss: { boxName: '장비 상자 II', quantity: 1 } },
    [LeagueTier.Ace]: { win: { boxName: '장비 상자 II', quantity: 4 }, loss: { boxName: '장비 상자 II', quantity: 2 } },
    [LeagueTier.Diamond]: { win: { boxName: '장비 상자 III', quantity: 2 }, loss: { boxName: '장비 상자 III', quantity: 1 } },
    [LeagueTier.Master]: { win: { boxName: '장비 상자 III', quantity: 4 }, loss: { boxName: '장비 상자 III', quantity: 2 } },
    [LeagueTier.Grandmaster]: { win: { boxName: '장비 상자 IV', quantity: 2 }, loss: { boxName: '장비 상자 IV', quantity: 1 } },
    [LeagueTier.Challenger]: { win: { boxName: '장비 상자 IV', quantity: 4 }, loss: { boxName: '장비 상자 IV', quantity: 2 } },
};

export const BASE_TOURNAMENT_REWARDS: Record<TournamentType, { rewardType: 'rank', rewards: Record<number, TournamentRewardInfo> }> = {
    neighborhood: { // 6인 풀리그, key = rank
        rewardType: 'rank',
        rewards: {
            1: { items: [{ itemId: '골드 꾸러미4', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 우승
            2: { items: [{ itemId: '골드 꾸러미3', quantity: 1 }] }, // 준우승
            3: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] }, // 3위
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] }, // 4-6위
        }
    },
    national: { // 8강 토너먼트, key = rank
        rewardType: 'rank',
        rewards: {
            1: { items: [{ itemId: '골드 꾸러미4', quantity: 1 }, { itemId: '다이아 꾸러미2', quantity: 1 }] }, // 우승
            2: { items: [{ itemId: '골드 꾸러미3', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 준우승
            3: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 3위
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 4위
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },   // 5-8위 (8강 탈락)
        }
    },
    world: { // 16강 토너먼트, key = rank
        rewardType: 'rank',
        rewards: {
            1: { items: [{ itemId: '골드 꾸러미4', quantity: 1 }, { itemId: '다이아 꾸러미3', quantity: 1 }] }, // 우승
            2: { items: [{ itemId: '골드 꾸러미3', quantity: 1 }, { itemId: '다이아 꾸러미2', quantity: 1 }] }, // 준우승
            3: { items: [{ itemId: '골드 꾸러미3', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 3위
            4: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] }, // 4위
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }, { itemId: '다이아 꾸러미1', quantity: 1 }] },  // 5-8위 (8강 탈락)
            9: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },   // 9-16위 (16강 탈락)
        }
    }
};

export const TOURNAMENT_SCORE_REWARDS: Record<TournamentType, Record<number, number>> = {
    neighborhood: { 1: 32, 2: 16, 3: 8, 4: 5, 5: 3, 6: 1 },
    national:     { 1: 46, 2: 29, 3: 15, 4: 7, 5: 2 },
    world:        { 1: 58, 2: 44, 3: 21, 4: 11, 5: 5, 9: 3 },
};

// === 던전 시스템 상수 ===

// 단계별 봇 능력치 범위 (각 능력치 개별 값)
export const DUNGEON_STAGE_BOT_STATS: Record<number, { minStat: number; maxStat: number }> = {
    1: { minStat: 100, maxStat: 120 },
    2: { minStat: 130, maxStat: 150 },
    3: { minStat: 180, maxStat: 210 },
    4: { minStat: 240, maxStat: 280 },
    5: { minStat: 320, maxStat: 380 },
    6: { minStat: 420, maxStat: 500 },
    7: { minStat: 520, maxStat: 600 },
    8: { minStat: 620, maxStat: 700 },
    9: { minStat: 680, maxStat: 750 },
    10: { minStat: 750, maxStat: 800 },
};

// 던전 타입별 능력치 배율
export const DUNGEON_TYPE_MULTIPLIER: Record<TournamentType, number> = {
    neighborhood: 0.8,  // 가장 쉬움
    national: 1.0,      // 기준
    world: 1.2,         // 가장 어려움
};

// 순위별 보상 배율
export const DUNGEON_RANK_REWARD_MULTIPLIER: Record<number, number> = {
    1: 2.0,   // 1위: 기본 보상 × 2.0
    2: 1.5,   // 2위: 기본 보상 × 1.5
    3: 1.3,   // 3위: 기본 보상 × 1.3
    4: 1.1,   // 4~10위: 기본 보상 × 1.1
    5: 1.1,
    6: 1.1,
    7: 1.1,
    8: 1.1,
    9: 1.1,
    10: 1.1,
};

// 기본 보상 배율 (11위 이하)
export const DUNGEON_DEFAULT_REWARD_MULTIPLIER = 1.0;

// 단계별 기본 보상 (동네바둑리그 - 골드)
export const DUNGEON_STAGE_BASE_REWARDS_GOLD: Record<number, number> = {
    1: 100,
    2: 150,
    3: 200,
    4: 300,
    5: 500,
    6: 750,
    7: 1000,
    8: 1500,
    9: 1800,
    10: 2000,
};

// 단계별 기본 보상 (전국바둑대회 - 강화석)
export const DUNGEON_STAGE_BASE_REWARDS_MATERIAL: Record<number, { materialName: string; quantity: number }> = {
    1: { materialName: '하급 강화석', quantity: 10 },
    2: { materialName: '하급 강화석', quantity: 15 },
    3: { materialName: '중급 강화석', quantity: 10 },
    4: { materialName: '중급 강화석', quantity: 15 },
    5: { materialName: '중급 강화석', quantity: 20 },
    6: { materialName: '상급 강화석', quantity: 15 },
    7: { materialName: '상급 강화석', quantity: 20 },
    8: { materialName: '최상급 강화석', quantity: 15 },
    9: { materialName: '최상급 강화석', quantity: 25 },
    10: { materialName: '최상급 강화석', quantity: 30 },
};

// 단계별 기본 보상 (월드챔피언십 - 장비상자 및 변경권)
export const DUNGEON_STAGE_BASE_REWARDS_EQUIPMENT: Record<number, { boxes: { boxName: string; quantity: number }[]; changeTickets: number }> = {
    1: { boxes: [{ boxName: '장비 상자 I', quantity: 1 }], changeTickets: 0 },
    2: { boxes: [{ boxName: '장비 상자 I', quantity: 1 }], changeTickets: 0 },
    3: { boxes: [{ boxName: '장비 상자 II', quantity: 1 }], changeTickets: 0 },
    4: { boxes: [{ boxName: '장비 상자 II', quantity: 1 }], changeTickets: 1 },
    5: { boxes: [{ boxName: '장비 상자 III', quantity: 2 }], changeTickets: 1 },
    6: { boxes: [{ boxName: '장비 상자 III', quantity: 2 }], changeTickets: 1 },
    7: { boxes: [{ boxName: '장비 상자 IV', quantity: 2 }], changeTickets: 2 },
    8: { boxes: [{ boxName: '장비 상자 IV', quantity: 2 }], changeTickets: 2 },
    9: { boxes: [{ boxName: '장비 상자 IV', quantity: 3 }], changeTickets: 2 },
    10: { boxes: [{ boxName: '장비 상자 IV', quantity: 3 }], changeTickets: 3 },
};

// 일일 랭킹 점수: 단계별 기본 점수
export const DUNGEON_STAGE_BASE_SCORE: Record<number, number> = {
    1: 10,
    2: 15,
    3: 20,
    4: 30,
    5: 50,
    6: 65,
    7: 80,
    8: 90,
    9: 95,
    10: 100,
};

// 일일 랭킹 점수: 순위별 보너스 배율
export const DUNGEON_RANK_SCORE_BONUS: Record<number, number> = {
    1: 0.5,   // 1위: +50%
    2: 0.3,   // 2위: +30%
    3: 0.2,   // 3위: +20%
    4: 0.1,   // 4~10위: +10%
    5: 0.1,
    6: 0.1,
    7: 0.1,
    8: 0.1,
    9: 0.1,
    10: 0.1,
};

// 기본 보너스 (11위 이하)
export const DUNGEON_DEFAULT_SCORE_BONUS = 0.0;

// 던전 단계별 순위 보상 (각 던전 타입별, 단계별, 순위별)
// 10단계 1위 기준: 동네바둑리그=골드꾸러미4×5, 전국바둑대회=재료상자6×2, 월드챔피언십=다이아꾸러미4×3
export const DUNGEON_RANK_REWARDS: Record<TournamentType, Record<number, Record<number, QuestReward>>> = {
    neighborhood: {
        // 10단계 기준: 1위 = 골드 꾸러미4 × 5개
        10: {
            1: { items: [{ itemId: '골드 꾸러미4', quantity: 5 }] },
            2: { items: [{ itemId: '골드 꾸러미4', quantity: 3 }] },
            3: { items: [{ itemId: '골드 꾸러미3', quantity: 3 }] },
            4: { items: [{ itemId: '골드 꾸러미3', quantity: 2 }] },
            5: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 2 }] },
        },
        // 9단계: 1위 = 골드 꾸러미4 × 4개
        9: {
            1: { items: [{ itemId: '골드 꾸러미4', quantity: 4 }] },
            2: { items: [{ itemId: '골드 꾸러미4', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미3', quantity: 2 }] },
            4: { items: [{ itemId: '골드 꾸러미3', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 8단계: 1위 = 골드 꾸러미3 × 4개
        8: {
            1: { items: [{ itemId: '골드 꾸러미3', quantity: 4 }] },
            2: { items: [{ itemId: '골드 꾸러미3', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            4: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 7단계: 1위 = 골드 꾸러미3 × 3개
        7: {
            1: { items: [{ itemId: '골드 꾸러미3', quantity: 3 }] },
            2: { items: [{ itemId: '골드 꾸러미3', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            4: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 6단계: 1위 = 골드 꾸러미3 × 2개
        6: {
            1: { items: [{ itemId: '골드 꾸러미3', quantity: 2 }] },
            2: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 5단계: 1위 = 골드 꾸러미2 × 3개
        5: {
            1: { items: [{ itemId: '골드 꾸러미2', quantity: 3 }] },
            2: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미1', quantity: 2 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 4단계: 1위 = 골드 꾸러미2 × 2개
        4: {
            1: { items: [{ itemId: '골드 꾸러미2', quantity: 2 }] },
            2: { items: [{ itemId: '골드 꾸러미2', quantity: 1 }] },
            3: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 3단계: 1위 = 골드 꾸러미1 × 3개
        3: {
            1: { items: [{ itemId: '골드 꾸러미1', quantity: 3 }] },
            2: { items: [{ itemId: '골드 꾸러미1', quantity: 2 }] },
            3: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 2단계: 1위 = 골드 꾸러미1 × 2개
        2: {
            1: { items: [{ itemId: '골드 꾸러미1', quantity: 2 }] },
            2: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
        // 1단계 기준: 1위 = 골드 꾸러미1 × 2개
        1: {
            1: { items: [{ itemId: '골드 꾸러미1', quantity: 2 }] },
            2: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '골드 꾸러미1', quantity: 1 }] },
        },
    },
    national: {
        // 10단계 기준: 1위 = 재료 상자6 × 2개
        10: {
            1: { items: [{ itemId: '재료 상자6', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자6', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자5', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자4', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자3', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 9단계: 1위 = 재료 상자5 × 2개
        9: {
            1: { items: [{ itemId: '재료 상자5', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자5', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자4', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자3', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 8단계: 1위 = 재료 상자4 × 2개
        8: {
            1: { items: [{ itemId: '재료 상자4', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자4', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자3', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 7단계: 1위 = 재료 상자3 × 2개
        7: {
            1: { items: [{ itemId: '재료 상자3', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자3', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 6단계: 1위 = 재료 상자2 × 2개
        6: {
            1: { items: [{ itemId: '재료 상자2', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 5단계: 1위 = 재료 상자2 × 1개
        5: {
            1: { items: [{ itemId: '재료 상자2', quantity: 1 }] },
            2: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 4단계: 1위 = 재료 상자1 × 2개
        4: {
            1: { items: [{ itemId: '재료 상자1', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 3단계: 1위 = 재료 상자1 × 2개
        3: {
            1: { items: [{ itemId: '재료 상자1', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 2단계: 1위 = 재료 상자1 × 2개
        2: {
            1: { items: [{ itemId: '재료 상자1', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
        // 1단계 기준: 1위 = 재료 상자1 × 2개
        1: {
            1: { items: [{ itemId: '재료 상자1', quantity: 2 }] },
            2: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            3: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            4: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            5: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            6: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            7: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
            8: { items: [{ itemId: '재료 상자1', quantity: 1 }] },
        },
    },
    world: {
        // 10단계 기준: 1위 = 다이아 꾸러미4 × 3개
        10: {
            1: { items: [{ itemId: '다이아 꾸러미4', quantity: 3 }] },
            2: { items: [{ itemId: '다이아 꾸러미4', quantity: 2 }] },
            3: { items: [{ itemId: '다이아 꾸러미3', quantity: 2 }] },
            4: { items: [{ itemId: '다이아 꾸러미3', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 9단계: 1위 = 다이아 꾸러미4 × 2개
        9: {
            1: { items: [{ itemId: '다이아 꾸러미4', quantity: 2 }] },
            2: { items: [{ itemId: '다이아 꾸러미3', quantity: 2 }] },
            3: { items: [{ itemId: '다이아 꾸러미3', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 8단계: 1위 = 다이아 꾸러미3 × 2개
        8: {
            1: { items: [{ itemId: '다이아 꾸러미3', quantity: 2 }] },
            2: { items: [{ itemId: '다이아 꾸러미3', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 7단계: 1위 = 다이아 꾸러미3 × 1개
        7: {
            1: { items: [{ itemId: '다이아 꾸러미3', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 6단계: 1위 = 다이아 꾸러미2 × 1개
        6: {
            1: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 5단계: 1위 = 다이아 꾸러미2 × 1개
        5: {
            1: { items: [{ itemId: '다이아 꾸러미2', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 4단계: 1위 = 다이아 꾸러미1 × 2개
        4: {
            1: { items: [{ itemId: '다이아 꾸러미1', quantity: 2 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 3단계: 1위 = 다이아 꾸러미1 × 1개
        3: {
            1: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 2단계: 1위 = 다이아 꾸러미1 × 1개
        2: {
            1: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
        // 1단계 기준: 1위 = 다이아 꾸러미1 × 1개
        1: {
            1: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            2: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            3: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            4: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            5: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            6: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            7: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            8: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            9: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            10: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            11: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            12: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            13: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            14: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            15: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
            16: { items: [{ itemId: '다이아 꾸러미1', quantity: 1 }] },
        },
    },
};