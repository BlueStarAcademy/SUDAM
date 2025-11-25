
// constants/guildConstants.ts
import type { GuildMission, GuildResearchProject, GuildBossInfo, GuildBossSkill } from '../types/index.js';
import { CoreStat, ItemGrade, GuildMemberRole, GuildResearchId, GuildResearchCategory } from '../types/index.js';
import type { InventoryItem } from '../types/index.js';
import { GUILD_BOSS_1_IMG, GUILD_BOSS_2_IMG, GUILD_BOSS_3_IMG, GUILD_BOSS_4_IMG, GUILD_BOSS_5_IMG, BOSS_SKILL_ICON_MAP } from '../assets.js';


export const GUILD_CREATION_COST = 500; // Diamonds
export const GUILD_NAME_CHANGE_COST = 200; // Diamonds
export const GUILD_NAME_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const GUILD_LEAVE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
export const GUILD_INITIAL_MEMBER_LIMIT = 25;

export const GUILD_DONATION_GOLD_COST = 100;
export const GUILD_DONATION_DIAMOND_COST = 10;
export const GUILD_DONATION_GOLD_LIMIT = 5;
export const GUILD_DONATION_DIAMOND_LIMIT = 3;

export const GUILD_DONATION_GOLD_REWARDS = {
    guildCoins: [1, 5],
    researchPoints: [10, 50],
    guildXp: 10,
    contribution: 10,
};

export const GUILD_DONATION_DIAMOND_REWARDS = {
    guildCoins: [10, 30],
    researchPoints: [100, 300],
    guildXp: 30,
    contribution: 30,
};

export const GUILD_CHECK_IN_MILESTONE_REWARDS = [
    { count: 3, reward: { guildCoins: 20 } },
    { count: 7, reward: { guildCoins: 30 } },
    { count: 12, reward: { guildCoins: 50 } },
    { count: 18, reward: { guildCoins: 100 } },
];

export const GUILD_XP_PER_LEVEL = (level: number): number => {
    return Math.floor(100000 * Math.pow(1.2, level - 1));
};

export const GUILD_MISSIONS_POOL: Omit<GuildMission, 'id' | 'progress' | 'isCompleted' | 'claimedBy' | 'guildId' | 'missionType' | 'status' | 'createdAt' | 'updatedAt'>[] = [
    { title: '길드출석 50회', description: '길드원들이 총 50회 출석하기', target: 50, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'checkIns' },
    { title: '챔피언십(자동대국) 보상수령 30회', description: '길드원들이 챔피언십 보상 총 30회 수령하기', target: 30, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'championshipClaims' },
    { title: '길드 보스전 참여 30회', description: '길드원들이 길드 보스전에 총 30회 참여하기', target: 30, personalReward: { guildCoins: 100 }, guildReward: { guildXp: 200 }, progressKey: 'bossAttempts' },
    { title: '전략바둑 승리 30회', description: '길드원들이 전략바둑에서 총 30승 거두기', target: 30, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'strategicWins' },
    { title: '놀이바둑 승리 30회', description: '길드원들이 놀이바둑에서 총 30승 거두기', target: 30, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'playfulWins' },
    { title: '강화성공 30회', description: '길드원들이 장비 강화 성공 총 30회 달성하기', target: 30, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'equipmentEnhancements' },
    { title: '에픽등급이상 장비획득 20회', description: '길드원들이 에픽 등급 이상 장비 20회 획득하기', target: 20, personalReward: { guildCoins: 50 }, guildReward: { guildXp: 150 }, progressKey: 'epicGearAcquisitions' },
    { title: '3000다이아 소모', description: '길드원들이 상점 등에서 다이아 총 3000개 소비하기', target: 3000, personalReward: { guildCoins: 100 }, guildReward: { guildXp: 200 }, progressKey: 'diamondsSpent' },
];

const generateRequiredLevels = (maxLevel: number): number[] => {
    return Array.from({ length: maxLevel }, (_, i) => i + 1);
};

export const GUILD_RESEARCH_PROJECTS: Record<GuildResearchId, GuildResearchProject> = {
    // FIX: Replaced string literals with GuildResearchCategory enum members.
    [GuildResearchId.member_limit_increase]: { image: '/images/guild/lab/guildskill.png', category: GuildResearchCategory.development, name: '길드원 확장', description: '길드 최대 인원 수를 증가시킵니다.', maxLevel: 7, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '명', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(7) },
    [GuildResearchId.boss_hp_increase]: { image: '/images/guild/lab/bosslab1.png', category: GuildResearchCategory.boss, name: '길드보스전 HP 증가', description: '길드 보스전에서 유저의 최대 체력을 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.boss_skill_heal_block]: { image: '/images/guild/lab/bosslab2.png', category: GuildResearchCategory.boss, name: '길드보스전 [회복 불가]', description: '일정 확률로 보스의 회복을 막거나 회복량을 감소시킵니다.', maxLevel: 7, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(7) },
    [GuildResearchId.boss_skill_regen]: { image: '/images/guild/lab/bosslab3.png', category: GuildResearchCategory.boss, name: '길드보스전 [회복]', description: '일정 확률로 자신의 체력을 지속적으로 회복합니다.', maxLevel: 7, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(7) },
    [GuildResearchId.boss_skill_ignite]: { image: '/images/guild/lab/bosslab4.png', category: GuildResearchCategory.boss, name: '길드보스전 [점화]', description: '일정 확률로 보스에게 지속적인 점화 피해를 입힙니다.', maxLevel: 7, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(7) },
    [GuildResearchId.ap_regen_boost]: { image: '/images/guild/lab/statlab7.png', category: GuildResearchCategory.stats, name: '행동력 회복속도 증가', description: '모든 길드원의 행동력 회복 속도를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_concentration]: { image: '/images/guild/lab/statlab1.png', category: GuildResearchCategory.stats, name: '집중력 증가', description: '모든 길드원의 집중력 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_thinking_speed]: { image: '/images/guild/lab/statlab2.png', category: GuildResearchCategory.stats, name: '사고속도 증가', description: '모든 길드원의 사고속도 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_judgment]: { image: '/images/guild/lab/statlab3.png', category: GuildResearchCategory.stats, name: '판단력 증가', description: '모든 길드원의 판단력 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_calculation]: { image: '/images/guild/lab/statlab4.png', category: GuildResearchCategory.stats, name: '계산력 증가', description: '모든 길드원의 계산력 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_combat_power]: { image: '/images/guild/lab/statlab5.png', category: GuildResearchCategory.stats, name: '전투력 증가', description: '모든 길드원의 전투력 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.stat_stability]: { image: '/images/guild/lab/statlab6.png', category: GuildResearchCategory.stats, name: '안정감 증가', description: '모든 길드원의 안정감 능력치를 증가시킵니다.', maxLevel: 10, baseCost: 30000, costMultiplier: 1.2, baseEffect: 5, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(10) },
    [GuildResearchId.reward_strategic_gold]: { image: '/images/guild/lab/gamelab1.png', category: GuildResearchCategory.rewards, name: '전략 바둑 골드보상 증가', description: '모든 길드원의 전략 바둑 골드 보상을 증가시킵니다.', maxLevel: 5, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(5) },
    [GuildResearchId.reward_playful_gold]: { image: '/images/guild/lab/gamelab2.png', category: GuildResearchCategory.rewards, name: '놀이 바둑 골드보상 증가', description: '모든 길드원의 놀이 바둑 골드 보상을 증가시킵니다.', maxLevel: 5, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(5) },
    [GuildResearchId.reward_strategic_xp]: { image: '/images/guild/lab/gamelab3.png', category: GuildResearchCategory.rewards, name: '전략 바둑 경험치보상 증가', description: '모든 길드원의 전략 바둑 경험치 보상을 증가시킵니다.', maxLevel: 5, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(5) },
    [GuildResearchId.reward_playful_xp]: { image: '/images/guild/lab/gamelab4.png', category: GuildResearchCategory.rewards, name: '놀이 바둑 경험치보상 증가', description: '모든 길드원의 놀이 바둑 경험치 보상을 증가시킵니다.', maxLevel: 5, baseCost: 30000, costMultiplier: 1.2, baseEffect: 10, effectUnit: '%', baseTimeHours: 3, timeIncrementHours: 0, requiredGuildLevel: generateRequiredLevels(5) },
};

export type GuildShopItem = {
    itemId: string;
    name: string;
    description: string;
    cost: number;
    image: string;
    type: 'equipment_box' | 'material' | 'consumable';
    limit: number;
    limitType: 'weekly' | 'monthly';
    grade: ItemGrade;
};

export const GUILD_SHOP_ITEMS: GuildShopItem[] = [
    // Equipment Boxes
    { itemId: 'guild_equip_box_1', name: '길드 장비 상자(고급)', description: '고급 등급 장비 1개 획득', cost: 100, image: '/images/Box/EquipmentBox2.png', type: 'equipment_box', limit: 5, limitType: 'weekly', grade: ItemGrade.Uncommon },
    { itemId: 'guild_equip_box_2', name: '길드 장비 상자(희귀)', description: '희귀 등급 장비 1개 획득', cost: 300, image: '/images/Box/EquipmentBox3.png', type: 'equipment_box', limit: 3, limitType: 'weekly', grade: ItemGrade.Rare },
    { itemId: 'guild_equip_box_3', name: '길드 장비 상자(에픽)', description: '에픽 등급 장비 1개 획득', cost: 1000, image: '/images/Box/EquipmentBox4.png', type: 'equipment_box', limit: 1, limitType: 'weekly', grade: ItemGrade.Epic },
    { itemId: 'guild_equip_box_4', name: '길드 장비 상자(전설)', description: '전설 등급 장비 1개 획득', cost: 3000, image: '/images/Box/EquipmentBox5.png', type: 'equipment_box', limit: 1, limitType: 'monthly', grade: ItemGrade.Legendary },
    { itemId: 'guild_equip_box_mythic', name: '신화 장비 상자', description: '신화 등급 장비 1개 획득', cost: 10000, image: '/images/Box/EquipmentBox6.png', type: 'equipment_box', limit: 1, limitType: 'weekly', grade: ItemGrade.Mythic },

    // Materials
    { itemId: '중급 강화석', name: '중급 강화석', description: '장비 강화에 사용되는 상급 재료.', cost: 25, image: '/images/materials/materials2.png', type: 'material', limit: 30, limitType: 'weekly', grade: ItemGrade.Uncommon },
    { itemId: '상급 강화석', name: '상급 강화석', description: '장비 강화에 사용되는 최상급 재료', cost: 50, image: '/images/materials/materials3.png', type: 'material', limit: 10, limitType: 'weekly', grade: ItemGrade.Rare },
    { itemId: '최상급 강화석', name: '최상급 강화석', description: '장비 강화에 사용되는 희귀 재료', cost: 150, image: '/images/materials/materials4.png', type: 'material', limit: 5, limitType: 'weekly', grade: ItemGrade.Epic },
    { itemId: '신비의 강화석', name: '신비의 강화석', description: '장비 강화에 사용되는 고대 재료', cost: 500, image: '/images/materials/materials5.png', type: 'material', limit: 2, limitType: 'weekly', grade: ItemGrade.Legendary },

    // Consumables
    { itemId: '골드 꾸러미1', name: '골드 꾸러미1', description: '10 ~ 500 골드 획득', cost: 20, image: '/images/Box/GoldBox1.png', type: 'consumable', limit: 10, limitType: 'weekly', grade: ItemGrade.Normal },
    { itemId: '골드 꾸러미2', name: '골드 꾸러미2', description: '100 ~ 1,000 골드 획득', cost: 40, image: '/images/Box/GoldBox2.png', type: 'consumable', limit: 5, limitType: 'weekly', grade: ItemGrade.Uncommon },
    { itemId: '골드 꾸러미3', name: '골드 꾸러미3', description: '500 ~ 3,000 골드 획득', cost: 60, image: '/images/Box/GoldBox3.png', type: 'consumable', limit: 3, limitType: 'weekly', grade: ItemGrade.Rare },
    { itemId: '골드 꾸러미4', name: '골드 꾸러미4', description: '1,000 ~ 10,000 골드 획득', cost: 80, image: '/images/Box/GoldBox4.png', type: 'consumable', limit: 1, limitType: 'weekly', grade: ItemGrade.Epic },
    { itemId: '보너스 스탯 +5', name: '보너스 스탯 +5', description: '모든 능력치에 자유롭게 분배할 수 있는 보너스 스탯 포인트를 5개 획득합니다.', cost: 5000, image: '/images/button/statpoint.png', type: 'consumable', limit: 1, limitType: 'monthly', grade: ItemGrade.Legendary },
];

const BOSS_STATS: Record<CoreStat, number> = {
    [CoreStat.Concentration]: 1000, [CoreStat.ThinkingSpeed]: 1000, [CoreStat.Judgment]: 1000,
    [CoreStat.Calculation]: 1000, [CoreStat.CombatPower]: 1000, [CoreStat.Stability]: 1000,
};

export const GUILD_BOSSES: GuildBossInfo[] = [
    {
        id: 'boss_1', name: '청해', description: '꾸준한 집중력/안정감 소모, "지구전형"', image: GUILD_BOSS_1_IMG,
        maxHp: 5000000, hp: 5000000, stats: BOSS_STATS,
        strategyGuide: '집중력과 안정감 위주로 세팅하고, 회복 불가/억제 연구를 통해 보스의 회복을 막는 것이 핵심입니다.',
        skills: [
            { id: '청해_물결의압박', name: '물결의 압박', description: '매 턴 집중력 대결을 통해 피해를 입힙니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['청해_물결의압박'], checkStat: CoreStat.Concentration, onSuccess: [{ type: 'damage', value: [5000, 8000] }], onFailure: [{ type: 'damage', value: [8000, 12000] }] },
            { id: '청해_심해의고요', name: '심해의 고요', description: '안정감 대결을 통해 현재 체력에 비례한 큰 피해를 입힙니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['청해_심해의고요'], checkStat: CoreStat.Stability, onSuccess: [{ type: 'hp_percent', value: [10, 20] }], onFailure: [{ type: 'hp_percent', value: [25, 40] }] },
            { id: '청해_회복억제', name: '회복 억제[패시브]', description: '유저가 회복을 시도하면 일정 확률로 회복 효과를 감소시킵니다.', type: 'passive', image: BOSS_SKILL_ICON_MAP['청해_회복억제'], passiveTrigger: 'on_user_heal', passiveChance: 0.40, passiveEffect: [{ type: 'debuff', debuffType: 'user_heal_reduction_percent', debuffValue: [50, 50], debuffDuration: 1 }] },
        ],
        recommendedStats: [CoreStat.Concentration, CoreStat.Stability],
        recommendedResearch: [GuildResearchId.boss_skill_heal_block]
    },
    {
        id: 'boss_2', name: '홍염', description: '짧고 강한 폭발력, "속전속결형"', image: GUILD_BOSS_2_IMG,
        maxHp: 4500000, hp: 4500000, stats: BOSS_STATS,
        strategyGuide: '전투력과 사고속도를 높여 폭발적인 피해를 막고, 점화 연구로 지속 피해를 누적시키는 것이 좋습니다.',
        skills: [
            { id: '홍염_불꽃돌파', name: '불꽃 돌파', description: '전투력 대결을 통해 강력한 단일 피해를 입힙니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['홍염_불꽃돌파'], checkStat: CoreStat.CombatPower, onSuccess: [{ type: 'damage', value: [8000, 10000] }], onFailure: [{ type: 'damage', value: [12000, 18000] }] },
            { id: '홍염_광열의폭발', name: '광열의 폭발', description: '사고속도 대결을 통해 현재 체력에 비례한 폭발적인 피해를 줍니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['홍염_광열의폭발'], checkStat: CoreStat.ThinkingSpeed, onSuccess: [{ type: 'hp_percent', value: [5, 10] }], onFailure: [{ type: 'hp_percent', value: [25, 40] }] },
            { id: '홍염_화상', name: '화상[패시브]', description: '매 턴 안정감 대결에 실패하면 화상 피해를 입습니다.', type: 'passive', image: BOSS_SKILL_ICON_MAP['홍염_화상'], passiveTrigger: 'every_turn', checkStat: CoreStat.Stability, passiveEffect: [{ type: 'hp_percent', value: [10, 20] }] }
        ],
        recommendedStats: [CoreStat.CombatPower, CoreStat.ThinkingSpeed],
        recommendedResearch: [GuildResearchId.boss_skill_ignite]
    },
    {
        id: 'boss_3', name: '녹수', description: '지속 회복 + 장기전, "버티기형"', image: GUILD_BOSS_3_IMG,
        maxHp: 5200000, hp: 5200000, stats: BOSS_STATS,
        strategyGuide: '자연의 치유를 막기 위해 회복 불가/억제 연구는 필수입니다. 균형 잡힌 능력치로 숲의 압박을 버텨내세요.',
        skills: [
            { id: '녹수_숲의압박', name: '숲의 압박', description: '집중력과 판단력에 따라 피해량이 결정되는 지속적인 공격입니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['녹수_숲의압박'], checkStat: [CoreStat.Concentration, CoreStat.Judgment], onSuccess: [{ type: 'damage', value: [4000, 5000] }], onFailure: [{ type: 'damage', value: [5000, 7000] }] },
            { id: '녹수_포자확산', name: '포자 확산', description: '여러 능력치를 동시에 시험하여 성공 횟수에 따라 피해량이 달라집니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['녹수_포자확산'], checkStat: [CoreStat.Concentration, CoreStat.Judgment, CoreStat.Stability], onSuccess: [], onFailure: [] },
            { id: '녹수_자연의치유', name: '자연의 치유[패시브]', description: '매 턴 안정감 대결에 실패하면 자신의 체력을 회복합니다.', type: 'passive', image: BOSS_SKILL_ICON_MAP['녹수_자연의치유'], passiveTrigger: 'every_turn', checkStat: CoreStat.Stability, passiveEffect: [{ type: 'heal', value: [3000, 5000] }] }
        ],
        recommendedStats: [CoreStat.Concentration, CoreStat.Stability, CoreStat.Judgment],
        recommendedResearch: [GuildResearchId.boss_skill_heal_block, GuildResearchId.boss_skill_regen]
    },
    {
        id: 'boss_4', name: '현묘', description: '랜덤 패턴, 예측 불가 "트릭스터형"', image: GUILD_BOSS_4_IMG,
        maxHp: 4800000, hp: 4800000, stats: BOSS_STATS,
        strategyGuide: '어떤 능력치가 시험받을지 모르므로, 모든 능력치를 골고루 올리는 것이 중요합니다. 특히 계산력과 안정감, 판단력이 중요하게 작용합니다.',
        skills: [
            { id: '현묘_혼란의수수께끼', name: '혼란의 수수께끼', description: '매 턴 무작위 능력치 대결을 통해 예측 불가능한 피해를 줍니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['현묘_혼란의수수께끼'], checkStat: Object.values(CoreStat), onSuccess: [{ type: 'damage', value: [6000, 7000] }], onFailure: [{ type: 'damage', value: [8000, 12000] }] },
            { id: '현묘_뒤바뀐계산', name: '뒤바뀐 계산', description: '계산력 대결을 통해 막대한 피해를 입힙니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['현묘_뒤바뀐계산'], checkStat: CoreStat.Calculation, onSuccess: [{ type: 'damage', value: [5000, 6000] }], onFailure: [{ type: 'damage', value: [7000, 13000] }] },
            { id: '현묘_심리전', name: '심리전', description: '안정감과 판단력의 합산 능력치에 따라 피해량이 극단적으로 변합니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['현묘_심리전'], checkStat: [CoreStat.Stability, CoreStat.Judgment], onSuccess: [{ type: 'damage', value: [1500, 3000] }], onFailure: [{ type: 'damage', value: [8000, 15000] }] }
        ],
        recommendedStats: [CoreStat.Calculation, CoreStat.Stability, CoreStat.Judgment],
        recommendedResearch: []
    },
    {
        id: 'boss_5', name: '백광', description: '전체 밸런스를 요구하는 "최종 보스형"', image: GUILD_BOSS_5_IMG,
        maxHp: 6000000, hp: 6000000, stats: BOSS_STATS,
        strategyGuide: '모든 능력치의 총합이 중요합니다. 집중력으로 결계를 돌파하고 안정감으로 심판의 빛 피해를 줄이는 것이 공략의 핵심입니다.',
        skills: [
            { id: '백광_천벌의일격', name: '천벌의 일격', description: '전투력과 사고속도를 동시에 시험하여, 성공 횟수에 따라 피해량이 결정됩니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['백광_천벌의일격'], checkStat: [CoreStat.CombatPower, CoreStat.ThinkingSpeed], onSuccess: [], onFailure: [] },
            { id: '백광_광휘의결계', name: '광휘의 결계', description: '집중력 대결에 실패하면 큰 피해와 함께 전투력 감소 디버프에 걸립니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['백광_광휘의결계'], checkStat: CoreStat.Concentration, onSuccess: [{ type: 'damage', value: [5000, 6000] }], onFailure: [{ type: 'damage', value: [8000, 10000] }, { type: 'debuff', debuffType: 'user_combat_power_reduction_percent', debuffValue: [50, 50], debuffDuration: 3 }] },
            { id: '백광_심판의빛', name: '심판의 빛', description: '안정감 대결 결과에 따라 체력 비례 고정 피해를 입힙니다.', type: 'active', image: BOSS_SKILL_ICON_MAP['백광_심판의빛'], checkStat: CoreStat.Stability, onSuccess: [{ type: 'hp_percent', value: [5, 12] }], onFailure: [{ type: 'hp_percent', value: [20, 40] }] }
        ],
        recommendedStats: Object.values(CoreStat),
        recommendedResearch: []
    },
];

export const GUILD_BOSS_MAX_ATTEMPTS = 2;

export const GUILD_BOSS_PERSONAL_REWARDS_TIERS = [
    { damage: 10000, reward: { guildCoins: 20 } },
    { damage: 50000, reward: { guildCoins: 30 } },
    { damage: 100000, reward: { guildCoins: 50 } },
    { damage: 200000, reward: { guildCoins: 70 } },
    { damage: 500000, reward: { guildCoins: 100 } },
    { damage: 1000000, reward: { guildCoins: 150 } },
    { damage: 2000000, reward: { guildCoins: 200 } },
];
