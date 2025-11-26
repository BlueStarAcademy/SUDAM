
import { randomUUID } from 'crypto';
import { type InventoryItem, type EquipmentSlot, type ItemOptions, type ItemOption, CoreStat, SpecialStat, MythicStat, type ItemOptionType, type BorderInfo } from '../types/index.js';
import { ItemGrade } from '../types/enums.js';
import {
    EQUIPMENT_POOL,
    MATERIAL_ITEMS,
    MAIN_STAT_DEFINITIONS,
    GRADE_SUB_OPTION_RULES,
    SUB_OPTION_POOLS,
    SPECIAL_STATS_DATA,
    MYTHIC_STATS_DATA,
} from '../constants/index.js';

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

type SubOptionDefinition = { type: CoreStat, isPercentage: boolean, range: [number, number] };
type SpecialSubOptionDefinition = { name: string; isPercentage: boolean; range: [number, number] };


const generateItemOptions = (grade: ItemGrade, slot: EquipmentSlot): ItemOptions => {
    const rules = GRADE_SUB_OPTION_RULES[grade];
    const usedCombatSubTypes: Set<CoreStat> = new Set();
    const usedSpecialSubTypes: Set<SpecialStat> = new Set();

    const slotDef = MAIN_STAT_DEFINITIONS[slot];
    const gradeDef = slotDef.options[grade];
    const mainStatType = pickRandom(gradeDef.stats);
    const mainValue = gradeDef.value;
    const mainIsPercentage = slotDef.isPercentage;
    const main: ItemOption = {
        type: mainStatType,
        value: mainValue,
        baseValue: mainValue,
        isPercentage: mainIsPercentage,
        display: `${mainStatType} +${mainValue}${mainIsPercentage ? '%' : ''}`
    };
    usedCombatSubTypes.add(mainStatType);

    const combatSubs: ItemOption[] = [];
    const combatTier = rules.combatTier;
    const combatCountRule = rules.combatCount;
    const numCombatSubs = Array.isArray(combatCountRule) ? getRandomInt(combatCountRule[0], combatCountRule[1]) : combatCountRule;
    const combatPool = SUB_OPTION_POOLS[slot][combatTier].filter(opt => !usedCombatSubTypes.has(opt.type));

    for (let i = 0; i < numCombatSubs; i++) {
        if (combatPool.length === 0) break;
        const subDef: SubOptionDefinition = pickRandom(combatPool);
        combatPool.splice(combatPool.indexOf(subDef), 1);
        usedCombatSubTypes.add(subDef.type);

        const value = getRandomInt(subDef.range[0], subDef.range[1]);
        combatSubs.push({
            type: subDef.type,
            value,
            isPercentage: subDef.isPercentage,
            display: `${subDef.type} +${value}${subDef.isPercentage ? '%' : ''} [${subDef.range[0]}~${subDef.range[1]}]`,
            range: subDef.range,
            enhancements: 0,
        });
    }
    
    const specialSubs: ItemOption[] = [];
    const specialCountRule = rules.specialCount;
    const numSpecialSubs = Array.isArray(specialCountRule) ? getRandomInt(specialCountRule[0], specialCountRule[1]) : specialCountRule;
    const specialPool = Object.values(SpecialStat);

    for (let i = 0; i < numSpecialSubs; i++) {
        if (specialPool.length === 0) break;
        const subStatType = pickRandom(specialPool);
        specialPool.splice(specialPool.indexOf(subStatType), 1);
        usedSpecialSubTypes.add(subStatType);

        const subDef = SPECIAL_STATS_DATA[subStatType];
        const value = getRandomInt(subDef.range[0], subDef.range[1]);
        specialSubs.push({
            type: subStatType,
            value,
            isPercentage: subDef.isPercentage,
            tier: combatTier,
            display: `${subDef.name} +${value}${subDef.isPercentage ? '%' : ''} [${subDef.range[0]}~${subDef.range[1]}]`,
            range: subDef.range,
            enhancements: 0,
        });
    }

    const mythicSubs: ItemOption[] = [];
    if (grade === 'mythic') {
        const mythicCountRule = rules.mythicCount;
        const numMythicSubs = Array.isArray(mythicCountRule) ? getRandomInt(mythicCountRule[0], mythicCountRule[1]) : mythicCountRule;
        const mythicPool = Object.values(MythicStat);

        for (let i = 0; i < numMythicSubs; i++) {
             if (mythicPool.length === 0) break;
             const subStatType = pickRandom(mythicPool);
             mythicPool.splice(mythicPool.indexOf(subStatType), 1);

             const subDef = MYTHIC_STATS_DATA[subStatType];
             const value = subDef.value([10, 50]);
             mythicSubs.push({
                 type: subStatType,
                 value: value,
                 isPercentage: false,
                 display: subDef.name,
                 enhancements: 0,
             });
        }
    }
    

    return { main, combatSubs, specialSubs, mythicSubs };
};


export const createItemFromTemplate = (template: Omit<InventoryItem, 'id' | 'createdAt' | 'isEquipped' | 'level' | 'options' | 'quantity'>): InventoryItem => {
    const options = generateItemOptions(template.grade, template.slot!);
    const getRandomInt = (min: number, max: number): number => {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };
    return {
        id: `item-${randomUUID()}`,
        name: template.name,
        description: template.description || `상자에서 획득한 ${template.grade} 등급 아이템.`,
        type: 'equipment',
        slot: template.slot,
        level: 1,
        isEquipped: false,
        createdAt: Date.now(),
        image: template.image,
        grade: template.grade,
        stars: 0,
        options: options,
        refinementCount: getRandomInt(3, 10), // 제련 가능 횟수 3~10회 랜덤 부여
    };
};

function openBoxWithLootTable(lootTable: { grade: ItemGrade; weight: number }[]): InventoryItem {
    const totalWeight = lootTable.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedGrade: ItemGrade = ItemGrade.Normal;

    for (const item of lootTable) {
        if (random < item.weight) {
            selectedGrade = item.grade as ItemGrade;
            break;
        }
        random -= item.weight;
    }

    const itemsOfSelectedGrade = EQUIPMENT_POOL.filter(item => item.grade === selectedGrade);
    const template = itemsOfSelectedGrade[Math.floor(Math.random() * itemsOfSelectedGrade.length)];
    return createItemFromTemplate(template);
}

const EQUIPMENT_BOX_1_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Normal, weight: 70 }, { grade: ItemGrade.Uncommon, weight: 20 }, { grade: ItemGrade.Rare, weight: 10 }];
const EQUIPMENT_BOX_2_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Normal, weight: 50 }, { grade: ItemGrade.Uncommon, weight: 25 }, { grade: ItemGrade.Rare, weight: 20 }, { grade: ItemGrade.Epic, weight: 5 }];
const EQUIPMENT_BOX_3_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Uncommon, weight: 40 }, { grade: ItemGrade.Rare, weight: 30 }, { grade: ItemGrade.Epic, weight: 25 }, { grade: ItemGrade.Legendary, weight: 5 }];
const EQUIPMENT_BOX_4_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Rare, weight: 50 }, { grade: ItemGrade.Epic, weight: 40 }, { grade: ItemGrade.Legendary, weight: 8 }, { grade: ItemGrade.Mythic, weight: 2 }];
const EQUIPMENT_BOX_5_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Epic, weight: 75 }, { grade: ItemGrade.Legendary, weight: 20 }, { grade: ItemGrade.Mythic, weight: 5 }];
const EQUIPMENT_BOX_6_LOOT_TABLE: { grade: ItemGrade; weight: number }[] = [ { grade: ItemGrade.Legendary, weight: 90 }, { grade: ItemGrade.Mythic, weight: 10 }];

export function openEquipmentBox1(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_1_LOOT_TABLE); }
export function openEquipmentBox2(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_2_LOOT_TABLE); }
export function openEquipmentBox3(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_3_LOOT_TABLE); }
export function openEquipmentBox4(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_4_LOOT_TABLE); }
export function openEquipmentBox5(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_5_LOOT_TABLE); }
export function openEquipmentBox6(): InventoryItem { return openBoxWithLootTable(EQUIPMENT_BOX_6_LOOT_TABLE); }

const MATERIAL_BOX_1_PROBABILITY = { '하급 강화석': 0.8, '중급 강화석': 0.15, '상급 강화석': 0.05 };
const MATERIAL_BOX_2_PROBABILITY = { '하급 강화석': 0.35, '중급 강화석': 0.55, '상급 강화석': 0.1 };
const MATERIAL_BOX_3_PROBABILITY = { '하급 강화석': 0.1, '중급 강화석': 0.45, '상급 강화석': 0.45 };
const MATERIAL_BOX_4_PROBABILITY = { '중급 강화석': 0.35, '상급 강화석': 0.45, '최상급 강화석': 0.2 };
const MATERIAL_BOX_5_PROBABILITY = { '상급 강화석': 0.5, '최상급 강화석': 0.4, '신비의 강화석': 0.1 };
const MATERIAL_BOX_6_PROBABILITY = { '상급 강화석': 0.25, '최상급 강화석': 0.25, '신비의 강화석': 0.5 };

const gradeOrder: ItemGrade[] = [ItemGrade.Normal, ItemGrade.Uncommon, ItemGrade.Rare, ItemGrade.Epic, ItemGrade.Legendary, ItemGrade.Mythic];

export const openGuildGradeBox = (grade: ItemGrade): InventoryItem => {
    const itemsOfSelectedGrade = EQUIPMENT_POOL.filter(item => item.grade === grade);
    if (itemsOfSelectedGrade.length === 0) {
        const lowerGrade = gradeOrder[gradeOrder.indexOf(grade) - 1] || 'normal';
        return openGuildGradeBox(lowerGrade);
    }
    const template = itemsOfSelectedGrade[Math.floor(Math.random() * itemsOfSelectedGrade.length)];
    return createItemFromTemplate(template);
};

export function openMaterialBox(boxId: 'material_box_1' | 'material_box_2' | 'material_box_3' | 'material_box_4' | 'material_box_5' | 'material_box_6', rolls: number): InventoryItem[] {
    const probabilities = {
        'material_box_1': MATERIAL_BOX_1_PROBABILITY,
        'material_box_2': MATERIAL_BOX_2_PROBABILITY,
        'material_box_3': MATERIAL_BOX_3_PROBABILITY,
        'material_box_4': MATERIAL_BOX_4_PROBABILITY,
        'material_box_5': MATERIAL_BOX_5_PROBABILITY,
        'material_box_6': MATERIAL_BOX_6_PROBABILITY,
    }[boxId];

    const results: { [key: string]: number } = {};
    for (let i = 0; i < rolls; i++) {
        let rand = Math.random();
        for (const [material, prob] of Object.entries(probabilities)) {
            if (rand < prob) {
                results[material] = (results[material] || 0) + 1;
                break;
            }
            rand -= prob;
        }
    }

    return Object.entries(results).map(([name, quantity]) => {
        const template = MATERIAL_ITEMS[name];
        if (!template) {
            console.error(`[openMaterialBox] Template not found for: ${name}`);
            return null;
        }
        return {
            ...template,
            id: `item-${randomUUID()}`,
            createdAt: Date.now(),
            quantity: quantity ?? 1,
            isEquipped: false,
            level: 1,
            stars: 0,
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined) as InventoryItem[];
}

export const SHOP_ITEMS: { [key: string]: { type: 'equipment' | 'material'; name: string; description: string; cost: { gold?: number, diamonds?: number }; onPurchase: () => any, image: string, dailyLimit?: number, weeklyLimit?: number } } = {
    'equipment_box_1': { type: 'equipment', name: '장비 상자 I', description: '일반~희귀 등급 장비 획득', cost: { gold: 500 }, onPurchase: openEquipmentBox1, image: '/images/Box/EquipmentBox1.png' },
    'equipment_box_2': { type: 'equipment', name: '장비 상자 II', description: '일반~에픽 등급 장비 획득', cost: { gold: 1500 }, onPurchase: openEquipmentBox2, image: '/images/Box/EquipmentBox2.png' },
    'equipment_box_3': { type: 'equipment', name: '장비 상자 III', description: '고급~전설 등급 장비 획득', cost: { gold: 5000 }, onPurchase: openEquipmentBox3, image: '/images/Box/EquipmentBox3.png' },
    'equipment_box_4': { type: 'equipment', name: '장비 상자 IV', description: '희귀~신화 등급 장비 획득', cost: { gold: 10000 }, onPurchase: openEquipmentBox4, image: '/images/Box/EquipmentBox4.png' },
    'equipment_box_5': { type: 'equipment', name: '장비 상자 V', description: '에픽~신화 등급 장비 획득', cost: { diamonds: 100 }, onPurchase: openEquipmentBox5, image: '/images/Box/EquipmentBox5.png' },
    'equipment_box_6': { type: 'equipment', name: '장비 상자 VI', description: '전설~신화 등급 장비 획득', cost: { diamonds: 500 }, onPurchase: openEquipmentBox6, image: '/images/Box/EquipmentBox6.png' },
    'material_box_1': { type: 'material', name: '재료 상자 I', description: '하급 ~ 상급 강화석 5개 획득', cost: { gold: 500 }, onPurchase: () => openMaterialBox('material_box_1', 5), image: '/images/Box/ResourceBox1.png', dailyLimit: 10 },
    'material_box_2': { type: 'material', name: '재료 상자 II', description: '하급 ~ 상급 강화석 5개 획득', cost: { gold: 1000 }, onPurchase: () => openMaterialBox('material_box_2', 5), image: '/images/Box/ResourceBox2.png', dailyLimit: 10 },
    'material_box_3': { type: 'material', name: '재료 상자 III', description: '하급 ~ 상급 강화석 5개 획득', cost: { gold: 2000 }, onPurchase: () => openMaterialBox('material_box_3', 5), image: '/images/Box/ResourceBox3.png', dailyLimit: 10 },
    'material_box_4': { type: 'material', name: '재료 상자 IV', description: '중급 ~ 최상급 강화석 5개 획득', cost: { gold: 3500 }, onPurchase: () => openMaterialBox('material_box_4', 5), image: '/images/Box/ResourceBox4.png', dailyLimit: 10 },
    'material_box_5': { type: 'material', name: '재료 상자 V', description: '상급 ~ 신비의 강화석 5개 획득', cost: { gold: 5000 }, onPurchase: () => openMaterialBox('material_box_5', 5), image: '/images/Box/ResourceBox5.png', dailyLimit: 10 },
    'material_box_6': { type: 'material', name: '재료 상자 VI', description: '상급 ~ 신비의 강화석 5개 획득', cost: { diamonds: 100 }, onPurchase: () => openMaterialBox('material_box_6', 5), image: '/images/Box/ResourceBox6.png', dailyLimit: 10 },
};
