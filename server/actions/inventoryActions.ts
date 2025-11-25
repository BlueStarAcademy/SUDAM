import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, InventoryItem, ItemOption, EquipmentSlot, CoreStat, SpecialStat, MythicStat, type ItemOptionType, type BorderInfo, type ChatMessage } from '../../types/index.js';
import { ItemGrade } from '../../types/enums.js';
import { broadcast } from '../socket.js';
import { getSelectiveUserUpdate } from '../utils/userUpdateHelper.js';
import * as guildService from '../guildService.js';
import {
    EQUIPMENT_POOL,
    MAIN_STAT_DEFINITIONS,
    SPECIAL_STATS_DATA,
    MYTHIC_STATS_DATA,
    ENHANCEMENT_SUCCESS_RATES,
    ENHANCEMENT_COSTS,
    MATERIAL_ITEMS,
    ITEM_SELL_PRICES,
    MATERIAL_SELL_PRICES,
    CONSUMABLE_SELL_PRICES,
    SUB_OPTION_POOLS,
    CONSUMABLE_ITEMS,
    GRADE_SUB_OPTION_RULES,
    GRADE_LEVEL_REQUIREMENTS,
    ENHANCEMENT_FAIL_BONUS_RATES,
    BLACKSMITH_COMBINATION_GREAT_SUCCESS_RATES,
    BLACKSMITH_COMBINATION_XP_GAIN,
    BLACKSMITH_MAX_LEVEL,
    BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP,
    BLACKSMITH_COMBINABLE_GRADES_BY_LEVEL,
    calculateEnhancementGoldCost
} from '../../constants/index.js';
import {
    BLACKSMITH_ENHANCEMENT_XP_GAIN,
    BLACKSMITH_DISASSEMBLY_XP_GAIN,
    BLACKSMITH_DISASSEMBLY_JACKPOT_RATES,
} from '../../constants/rules.js';
import * as effectService from '../effectService.js';
import { SHOP_ITEMS } from '../shop.js';
import { updateQuestProgress } from '../questService.js';
import { addItemsToInventory as addItemsToInventoryUtil } from '../../utils/inventoryUtils.js';

type HandleActionResult = {
    clientResponse?: any;
    error?: string;
};

const ALL_SLOTS: EquipmentSlot[] = ['fan', 'board', 'top', 'bottom', 'bowl', 'stones'];
const GRADE_ORDER: ItemGrade[] = [ItemGrade.Normal, ItemGrade.Uncommon, ItemGrade.Rare, ItemGrade.Epic, ItemGrade.Legendary, ItemGrade.Mythic];

export const currencyBundles: Record<string, { type: 'gold' | 'diamonds', min: number, max: number }> = {
    // '골드 꾸러미1' 제거됨 (버그로 인한 삭제)
    '골드 꾸러미2': { type: 'gold', min: 100, max: 1000 },
    '골드 꾸러미3': { type: 'gold', min: 500, max: 3000 },
    '골드 꾸러미4': { type: 'gold', min: 1000, max: 10000 },
    '다이아 꾸러미1': { type: 'diamonds', min: 1, max: 20 },
    '다이아 꾸러미2': { type: 'diamonds', min: 10, max: 30 },
    '다이아 꾸러미3': { type: 'diamonds', min: 20, max: 50 },
    '다이아 꾸러미4': { type: 'diamonds', min: 30, max: 100 },
};

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Helper function to generate a new random item
export const generateNewItem = (grade: ItemGrade, slot: EquipmentSlot, isDivineMythic: boolean = false): InventoryItem => {
    const template = EQUIPMENT_POOL.find(p => p.grade === grade && p.slot === slot);
    const baseItem = template || EQUIPMENT_POOL.find(p => p.grade === grade)!;

    // 1. Main Option
    const mainStatDef = MAIN_STAT_DEFINITIONS[slot].options[grade];
    const mainStatType = mainStatDef.stats[Math.floor(Math.random() * mainStatDef.stats.length)];
    const mainStatValue = mainStatDef.value;
    const mainOption: ItemOption = {
        type: mainStatType,
        value: mainStatValue,
        baseValue: mainStatValue,
        isPercentage: MAIN_STAT_DEFINITIONS[slot].isPercentage,
        display: `${mainStatType} +${mainStatValue}${MAIN_STAT_DEFINITIONS[slot].isPercentage ? '%' : ''}`,
    };

    const options: { main: ItemOption; combatSubs: ItemOption[]; specialSubs: ItemOption[]; mythicSubs: ItemOption[] } = {
        main: mainOption,
        combatSubs: [],
        specialSubs: [],
        mythicSubs: [],
    };

    const rules = GRADE_SUB_OPTION_RULES[grade];
    const existingSubTypes = new Set<ItemOptionType>([mainOption.type]);

    // 2. Combat Sub-options
    const combatSubCount = getRandomInt(rules.combatCount[0], rules.combatCount[1]);
    const combatPool = SUB_OPTION_POOLS[slot][rules.combatTier].filter(opt => !existingSubTypes.has(opt.type));
    for (let i = 0; i < combatSubCount && combatPool.length > 0; i++) {
        const subIndex = Math.floor(Math.random() * combatPool.length);
        const subDef = combatPool.splice(subIndex, 1)[0];
        const value = getRandomInt(subDef.range[0], subDef.range[1]);
        options.combatSubs.push({
            type: subDef.type,
            value,
            isPercentage: subDef.isPercentage,
            display: `${subDef.type} +${value}${subDef.isPercentage ? '%' : ''} [${subDef.range[0]}~${subDef.range[1]}]`,
            range: subDef.range,
            enhancements: 0,
        });
        existingSubTypes.add(subDef.type);
    }

    // 3. Special Sub-options
    const specialSubCount = getRandomInt(rules.specialCount[0], rules.specialCount[1]);
    const specialPool = Object.values(SpecialStat).filter(stat => !existingSubTypes.has(stat));
    for (let i = 0; i < specialSubCount && specialPool.length > 0; i++) {
        const subIndex = Math.floor(Math.random() * specialPool.length);
        const subType = specialPool.splice(subIndex, 1)[0];
        const subDef = SPECIAL_STATS_DATA[subType];
        const value = getRandomInt(subDef.range[0], subDef.range[1]);
        options.specialSubs.push({
            type: subType,
            value,
            isPercentage: subDef.isPercentage,
            display: `${subDef.name} +${value}${subDef.isPercentage ? '%' : ''} [${subDef.range[0]}~${subDef.range[1]}]`,
            range: subDef.range,
        });
        existingSubTypes.add(subType);
    }

    // 4. Mythic Sub-options
    if (grade === 'mythic') {
        // D.신화는 신화 옵션 2개, 일반 신화는 1개
        const mythicSubCount = isDivineMythic ? 2 : getRandomInt(rules.mythicCount[0], rules.mythicCount[1]);
        const mythicPool = Object.values(MythicStat).filter(stat => !existingSubTypes.has(stat));
         for (let i = 0; i < mythicSubCount && mythicPool.length > 0; i++) {
            const subIndex = Math.floor(Math.random() * mythicPool.length);
            const subType = mythicPool.splice(subIndex, 1)[0];
            const subDef = MYTHIC_STATS_DATA[subType];
            const value = subDef.value([1,1]); // Dummy range, value is fixed in definition
            options.mythicSubs.push({
                type: subType,
                value,
                isPercentage: false,
                display: `${subType}`,
            });
            existingSubTypes.add(subType);
        }
    }

    const newItem: InventoryItem = {
        ...baseItem,
        id: `item-${randomUUID()}`,
        createdAt: Date.now(),
        isEquipped: false,
        level: GRADE_LEVEL_REQUIREMENTS[grade],
        options,
        stars: 0,
        enhancementFails: 0,
        isDivineMythic: isDivineMythic,
    };

    return newItem;
};

// 장비 일관성 검증 및 수정 헬퍼 함수
// 데이터 손실 방지를 위해 인벤토리에 없는 장비도 절대 삭제하지 않음
export const validateAndFixEquipmentConsistency = (user: User): void => {
    // user.equipment에 있는 모든 장비가 인벤토리에 존재하는지 확인
    for (const slot in user.equipment) {
        const itemId = user.equipment[slot as EquipmentSlot];
        const itemInInventory = user.inventory.find(item => item.id === itemId);
        if (!itemInInventory) {
            // 인벤토리에 없어도 장비는 보존 (데이터 손실 방지)
            // 이는 인벤토리 동기화 문제나 버그로 인한 데이터 손실을 방지하기 위함
            console.error(`[Equipment Consistency] CRITICAL: User ${user.id} has equipment ${itemId} in slot ${slot} but not in inventory! PRESERVING equipment to prevent data loss. DO NOT DELETE.`);
            // 장비는 그대로 유지하여 나중에 복구 가능하도록 함
        } else if (!itemInInventory.isEquipped) {
            // 인벤토리에 있지만 isEquipped가 false인 경우 수정
            console.warn(`[Equipment Consistency] Equipment item ${itemId} in slot ${slot} exists in inventory but isEquipped is false for user ${user.id}, fixing`);
            itemInInventory.isEquipped = true;
        }
    }
    
    // 인벤토리에 있는 장착된 장비가 user.equipment에 있는지 확인
    user.inventory.forEach(item => {
        if (item.type === 'equipment' && item.isEquipped && item.slot) {
            const equipmentItemId = user.equipment[item.slot];
            if (equipmentItemId !== item.id) {
                console.warn(`[Equipment Consistency] Equipment item ${item.id} in slot ${item.slot} is marked as equipped but user.equipment[${item.slot}] is ${equipmentItemId} for user ${user.id}, fixing`);
                user.equipment[item.slot] = item.id;
            }
        }
    });
};

const removeUserItems = (user: User, itemsToRemove: { name: string; amount: number }[]): boolean => {
    const inventory = user.inventory;
    const materialCounts: Record<string, number> = {};
    inventory.filter(i => i.type === 'material').forEach(i => {
        materialCounts[i.name] = (materialCounts[i.name] || 0) + (i.quantity || 0);
    });

    for (const item of itemsToRemove) {
        if ((materialCounts[item.name] || 0) < item.amount) {
            return false; // Not enough materials
        }
    }

    for (const item of itemsToRemove) {
        let amountToRemove = item.amount;
        for (let i = inventory.length - 1; i >= 0; i--) {
            if (inventory[i].name === item.name) {
                if ((inventory[i].quantity || 0) > amountToRemove) {
                    inventory[i].quantity! -= amountToRemove;
                    amountToRemove = 0;
                } else {
                    amountToRemove -= (inventory[i].quantity || 0);
                    inventory.splice(i, 1);
                }
            }
            if (amountToRemove <= 0) break;
        }
    }
    return true;
};

export const handleInventoryAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;

    switch (type) {
        case 'COMBINE_ITEMS': {
            const { itemIds, isRandom } = payload as { itemIds: string[], isRandom: boolean };
            if (!itemIds || itemIds.length !== 3) return { error: '합성에는 3개의 아이템이 필요합니다.' };

            const itemsToCombine = user.inventory.filter(i => itemIds.includes(i.id));
            if (itemsToCombine.length !== 3) return { error: '선택된 아이템 중 일부를 찾을 수 없습니다.' };

            const firstItem = itemsToCombine[0];
            const grade = firstItem.grade;

            // Validation
            if (itemsToCombine.some(i => i.isEquipped)) return { error: '장착 중인 아이템은 합성할 수 없습니다.' };
            if (itemsToCombine.some(i => i.grade !== grade)) return { error: '같은 등급의 아이템만 합성할 수 있습니다.' };
            
            const blacksmithLevel = user.blacksmithLevel ?? 1;
            const maxCombinableGrade = BLACKSMITH_COMBINABLE_GRADES_BY_LEVEL[blacksmithLevel - 1];
            if (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(maxCombinableGrade)) {
                return { error: '대장간 레벨이 낮아 해당 등급을 합성할 수 없습니다.' };
            }

            // --- Logic --- 
            const inventoryAfterRemoval = user.inventory.filter(i => !itemIds.includes(i.id));

            // 2. Determine outcome grade
            const greatSuccessRate = BLACKSMITH_COMBINATION_GREAT_SUCCESS_RATES[blacksmithLevel - 1]?.[grade] ?? 0;
            const isGreatSuccess = Math.random() * 100 < greatSuccessRate;
            
            // 신화 등급을 합성할 때는 대성공이 아니면 같은 등급(신화)이 나와야 함
            // 대성공이면 D.신화(신화 등급이지만 특별한 형태)
            let outcomeGrade: ItemGrade;
            let isDivineMythic = false;
            if (grade === ItemGrade.Mythic) {
                // 신화 합성: 대성공이 아니면 신화, 대성공이면 D.신화
                outcomeGrade = ItemGrade.Mythic;
                isDivineMythic = isGreatSuccess;
            } else {
                // 다른 등급 합성: 기존 로직 유지
                const outcomeGradeIndex = Math.min(GRADE_ORDER.indexOf(grade) + (isGreatSuccess ? 1 : 0), GRADE_ORDER.length - 1);
                outcomeGrade = GRADE_ORDER[outcomeGradeIndex];
            }

            // 3. Determine outcome slot
            let outcomeSlot: EquipmentSlot;
            if (isRandom) {
                outcomeSlot = ALL_SLOTS[Math.floor(Math.random() * ALL_SLOTS.length)];
            } else {
                const weightedSlots = itemsToCombine.map(i => i.slot).filter((s): s is EquipmentSlot => s !== null);
                outcomeSlot = weightedSlots[Math.floor(Math.random() * weightedSlots.length)];
            }

            // 4. Generate new item
            const newItem = generateNewItem(outcomeGrade, outcomeSlot, isDivineMythic);

            // 신화 합성 시 대성공 여부 조정: 신화 합성 대성공이 아니면 isGreatSuccess = false
            let finalIsGreatSuccess = isGreatSuccess;
            if (grade === 'mythic' && !isDivineMythic) {
                finalIsGreatSuccess = false;
            }

            // 5. Add to inventory
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventoryUtil(inventoryAfterRemoval, user.inventorySlots, [newItem]);
            if (!success) {
                return { error: '새 아이템을 받기에 인벤토리 공간이 부족합니다.' };
            }
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            
            // 실제로 인벤토리에 추가된 아이템 (ID가 변경되었을 수 있음)
            const actualAddedItem = finalItemsToAdd[0] || newItem;
            // 새로 만든 아이템의 createdAt 시간 저장 (나중에 정확히 찾기 위해)
            const newItemCreatedAt = actualAddedItem.createdAt;

            // 6. Add blacksmith XP
            const xpGainRange = BLACKSMITH_COMBINATION_XP_GAIN[grade];
            const xpGained = getRandomInt(xpGainRange[0], xpGainRange[1]);
            user.blacksmithXp += xpGained;

            while (user.blacksmithLevel < BLACKSMITH_MAX_LEVEL && user.blacksmithXp >= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel)) {
                user.blacksmithXp -= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel);
                user.blacksmithLevel++;
            }

            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[COMBINE_ITEMS] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[COMBINE_ITEMS] Error updating user ${user.id}:`, error);
                console.error(`[COMBINE_ITEMS] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'COMBINE_ITEMS');

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            // 시스템 메시지 전송 조건:
            // 1. 전설등급 3개를 합쳐서 대성공하여 신화등급이 나온 경우
            // 2. 신화등급 3개를 합쳐서 대성공하여 D.신화등급이 나온 경우
            const shouldSendMessage = 
                (grade === 'legendary' && outcomeGrade === 'mythic' && finalIsGreatSuccess) || // 전설 합성 대성공 → 신화
                (grade === 'mythic' && outcomeGrade === 'mythic' && isDivineMythic); // 신화 합성 대성공 → D.신화
            
            if (shouldSendMessage) {
                try {
                    // DB에서 다시 읽은 후 인벤토리에서 방금 만든 아이템 찾기
                    // createdAt 시간으로 정확히 찾기 (가장 최근에 만들어진 같은 조건의 아이템)
                    // 모든 공유되는 장비는 방금 만들어진 장비여야 함
                    let actualItem = user.inventory.find(i => 
                        i.name === actualAddedItem.name && 
                        i.grade === outcomeGrade && 
                        i.slot === actualAddedItem.slot &&
                        i.isDivineMythic === actualAddedItem.isDivineMythic &&
                        i.createdAt === newItemCreatedAt
                    );
                    
                    // createdAt이 정확히 일치하지 않으면, 같은 조건의 아이템 중 가장 최근 것을 찾기
                    if (!actualItem) {
                        const candidates = user.inventory.filter(i => 
                            i.name === actualAddedItem.name && 
                            i.grade === outcomeGrade && 
                            i.slot === actualAddedItem.slot &&
                            i.isDivineMythic === actualAddedItem.isDivineMythic
                        );
                        if (candidates.length > 0) {
                            // 가장 최근에 만들어진 아이템 선택
                            actualItem = candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
                        }
                    }
                    
                    // 그래도 찾지 못하면 actualAddedItem 사용
                    if (!actualItem) {
                        actualItem = actualAddedItem;
                    }
                    
                    const itemName = actualItem.name;
                    
                    // 조사 처리 (을/를)
                    const particle = /[가-힣]$/.test(itemName) && (itemName.charCodeAt(itemName.length - 1) - 0xAC00) % 28 === 0 ? '를' : '을';
                    
                    const systemMessage: ChatMessage = {
                        id: `msg-${randomUUID()}`,
                        user: { id: 'system', nickname: '시스템' },
                        text: `${user.nickname}님이 장비 합성을 통해 ${itemName}${particle} 획득했습니다`,
                        system: true,
                        timestamp: Date.now(),
                        itemLink: {
                            itemId: actualItem.id,
                            userId: user.id,
                            itemName: itemName,
                            itemGrade: actualItem.grade
                        },
                        userLink: {
                            userId: user.id,
                            userName: user.nickname
                        }
                    };

                    // 전체 채팅창에 메시지 추가
                    if (!volatileState.waitingRoomChats['global']) {
                        volatileState.waitingRoomChats['global'] = [];
                    }
                    volatileState.waitingRoomChats['global'].push(systemMessage);
                    if (volatileState.waitingRoomChats['global'].length > 100) {
                        volatileState.waitingRoomChats['global'].shift();
                    }


                    // 채팅 메시지를 모든 클라이언트에 브로드캐스트
                    broadcast({
                        type: 'WAITING_ROOM_CHAT_UPDATE',
                        payload: {
                            'global': volatileState.waitingRoomChats['global']
                        }
                    });
                } catch (error: any) {
                    console.error(`[COMBINE_ITEMS] 신화 등급 장비 시스템 메시지 전송 중 오류:`, error);
                }
            }

            return { 
                clientResponse: { 
                    updatedUser,
                    combinationResult: { 
                        item: newItem, 
                        xpGained: xpGained, 
                        isGreatSuccess: finalIsGreatSuccess 
                    }
                }
            };
        }

        case 'USE_ITEM': {
            const { itemId, quantity = 1 } = payload;
            const itemIndex = user.inventory.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return { error: '아이템을 찾을 수 없습니다.' };

            const item = user.inventory[itemIndex];
            if (item.type !== 'consumable') return { error: '사용할 수 없는 아이템입니다.' };

            const availableQuantity = item.quantity || 1;
            const useQuantity = Math.min(quantity, availableQuantity);
            if (useQuantity <= 0) return { error: '사용할 수량이 없습니다.' };

            // 골드 꾸러미 이름 통일: 띄어쓰기 없는 경우도 처리
            let normalizedItemName = item.name;
            if (normalizedItemName.startsWith('골드꾸러미')) {
                normalizedItemName = normalizedItemName.replace('골드꾸러미', '골드 꾸러미');
            } else if (normalizedItemName.startsWith('다이아꾸러미')) {
                normalizedItemName = normalizedItemName.replace('다이아꾸러미', '다이아 꾸러미');
            }
            
            // 디버깅: 아이템 이름 확인
            
            // 정규화된 이름으로 먼저 찾고, 없으면 원본 이름으로도 시도
            let bundleInfo = currencyBundles[normalizedItemName] || currencyBundles[item.name];
            if (bundleInfo) {
                const individualAmounts: number[] = [];
                let totalGoldGained = 0;
                let totalDiamondsGained = 0;

                // 여러 개를 사용하는 경우 - 각각의 랜덤 수치를 저장
                for (let i = 0; i < useQuantity; i++) {
                    const amount = getRandomInt(bundleInfo.min, bundleInfo.max);
                    individualAmounts.push(amount);
                    if (bundleInfo.type === 'gold') {
                        totalGoldGained += amount;
                    } else { // diamonds
                        totalDiamondsGained += amount;
                    }
                }

                // 골드/다이아 추가
                if (bundleInfo.type === 'gold') {
                    user.gold += totalGoldGained;
                } else { // diamonds
                    user.diamonds += totalDiamondsGained;
                }

                // 여러 슬롯에 걸쳐 있을 경우 모든 슬롯에서 정확히 수량만큼 소모
                // normalizedItemName도 확인하여 띄어쓰기 차이 무시
                let remainingToRemove = useQuantity;
                for (let i = user.inventory.length - 1; i >= 0 && remainingToRemove > 0; i--) {
                    const invItem = user.inventory[i];
                    // 아이템 이름 정규화 (띄어쓰기 차이 무시)
                    let invItemNormalized = invItem.name;
                    if (invItemNormalized.startsWith('골드꾸러미')) {
                        invItemNormalized = invItemNormalized.replace('골드꾸러미', '골드 꾸러미');
                    } else if (invItemNormalized.startsWith('다이아꾸러미')) {
                        invItemNormalized = invItemNormalized.replace('다이아꾸러미', '다이아 꾸러미');
                    }
                    
                    if (invItem.id === itemId || (invItemNormalized === normalizedItemName && invItem.type === 'consumable')) {
                        const itemQuantity = invItem.quantity || 1;
                        if (itemQuantity <= remainingToRemove) {
                            remainingToRemove -= itemQuantity;
                            user.inventory.splice(i, 1);
                        } else {
                            invItem.quantity = itemQuantity - remainingToRemove;
                            remainingToRemove = 0;
                        }
                    }
                }

                // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
                user.inventory = JSON.parse(JSON.stringify(user.inventory));
                
                try {
                    // 데이터베이스에 저장
                    await db.updateUser(user);
                    
                    // 저장 후 DB에서 다시 읽어서 검증
                    const savedUser = await db.getUser(user.id);
                    if (!savedUser) {
                        console.error(`[USE_ITEM] User not found after save (bundle): ${user.id}`);
                        return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                    }
                    
                    // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                    user = savedUser;
                } catch (error: any) {
                    console.error(`[USE_ITEM] Error updating user ${user.id} (bundle):`, error);
                    console.error(`[USE_ITEM] Error stack:`, error.stack);
                    return { error: '데이터 저장 중 오류가 발생했습니다.' };
                }
                
                // 각각의 획득 수치를 별도의 아이템으로 반환 (표시용)
                const obtainedItems: Partial<InventoryItem>[] = individualAmounts.map(amount => ({
                    name: bundleInfo.type === 'gold' ? '골드' : '다이아',
                    quantity: amount,
                    image: bundleInfo.type === 'gold' ? '/images/icon/Gold.png' : '/images/icon/Zem.png',
                    type: 'material' as const,
                    grade: bundleInfo.type === 'gold' ? ItemGrade.Uncommon : ItemGrade.Rare
                }));

                // 선택적 필드만 반환 (메시지 크기 최적화)
                // 하지만 bundle 처리의 경우에도 getSelectiveUserUpdate를 사용하여 일관성 유지
                const updatedUser = getSelectiveUserUpdate(user, 'USE_ITEM');
                
                // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
                const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
                broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
                
                return { clientResponse: { obtainedItemsBulk: obtainedItems, updatedUser } };
            }
            
            const shopItemKey = Object.keys(SHOP_ITEMS).find(key => SHOP_ITEMS[key as keyof typeof SHOP_ITEMS].name === item.name);
            if (!shopItemKey) return { error: '알 수 없는 아이템입니다.' };
            
            const shopItem = SHOP_ITEMS[shopItemKey as keyof typeof SHOP_ITEMS];
            const allObtainedItems: InventoryItem[] = [];
            
            // 여러 개를 사용하는 경우
            for (let i = 0; i < useQuantity; i++) {
                const obtainedItems = shopItem.onPurchase();
                const itemsArray = Array.isArray(obtainedItems) ? obtainedItems : [obtainedItems];
                allObtainedItems.push(...itemsArray);
            }

            const tempInventoryAfterUse = user.inventory.filter(i => i.id !== itemId);
            if (item.quantity && item.quantity > useQuantity) {
                tempInventoryAfterUse.push({ ...item, quantity: item.quantity - useQuantity });
            }

            const { success, finalItemsToAdd } = addItemsToInventoryUtil(tempInventoryAfterUse, user.inventorySlots, allObtainedItems);
            if (!success) return { error: '인벤토리 공간이 부족합니다.' };
            
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify([...tempInventoryAfterUse, ...finalItemsToAdd]));
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[USE_ITEM] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[USE_ITEM] Error updating user ${user.id}:`, error);
                console.error(`[USE_ITEM] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'USE_ITEM', { includeAll: true });
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
            
            return { clientResponse: { obtainedItemsBulk: allObtainedItems, updatedUser } };
        }
        
        case 'USE_ALL_ITEMS_OF_TYPE': {
            const { itemName } = payload;
            const itemsToUse = user.inventory.filter(i => i.name === itemName && i.type === 'consumable');
            if (itemsToUse.length === 0) return { error: '사용할 아이템이 없습니다.' };

            const totalQuantity = itemsToUse.reduce((sum, i) => sum + (i.quantity || 1), 0);
            const allObtainedItems: InventoryItem[] = [];
            let totalGoldGained = 0;
            let totalDiamondsGained = 0;

            const shopItemKey = Object.keys(SHOP_ITEMS).find(key => SHOP_ITEMS[key as keyof typeof SHOP_ITEMS].name === itemName);
            const bundleInfo = currencyBundles[itemName];
            
            // First, generate all potential rewards
            for (let i = 0; i < totalQuantity; i++) {
                if (bundleInfo) {
                    const amount = getRandomInt(bundleInfo.min, bundleInfo.max);
                    if (bundleInfo.type === 'gold') totalGoldGained += amount;
                    else totalDiamondsGained += amount;
                } else if (shopItemKey) {
                    const shopItem = SHOP_ITEMS[shopItemKey as keyof typeof SHOP_ITEMS];
                    const openedItems = shopItem.onPurchase();
                    if (Array.isArray(openedItems)) {
                        allObtainedItems.push(...openedItems);
                    } else {
                        allObtainedItems.push(openedItems);
                    }
                }
            }

            // Then, check for inventory space
            const inventoryAfterRemoval = user.inventory.filter(i => i.name !== itemName);
            const { success: hasSpace, finalItemsToAdd, updatedInventory } = addItemsToInventoryUtil(inventoryAfterRemoval, user.inventorySlots, allObtainedItems);
            if (!hasSpace) {
                return { error: '모든 아이템을 받기에 가방 공간이 부족합니다.' };
            }

            // If space is sufficient, apply all changes
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            user.gold += totalGoldGained;
            user.diamonds += totalDiamondsGained;

            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[USE_ALL_ITEMS_OF_TYPE] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[USE_ALL_ITEMS_OF_TYPE] Error updating user ${user.id}:`, error);
                console.error(`[USE_ALL_ITEMS_OF_TYPE] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            // Prepare client response
            const clientResponseItems = [...allObtainedItems];
            if (totalGoldGained > 0) clientResponseItems.push({ name: '골드', quantity: totalGoldGained, image: '/images/icon/Gold.png', type: 'material', grade: 'uncommon' } as any);
            if (totalDiamondsGained > 0) clientResponseItems.push({ name: '다이아', quantity: totalDiamondsGained, image: '/images/icon/Zem.png', type: 'material', grade: 'rare' } as any);

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'USE_ALL_ITEMS_OF_TYPE', { includeAll: true });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            return { clientResponse: { obtainedItemsBulk: clientResponseItems, updatedUser } };
        }

        case 'TOGGLE_EQUIP_ITEM': {
            const { itemId } = payload;
            const itemToToggle = user.inventory.find(i => i.id === itemId);

            if (!itemToToggle || itemToToggle.type !== 'equipment' || !itemToToggle.slot) {
                return { error: 'Invalid equipment item.' };
            }
            
            const requiredLevel = GRADE_LEVEL_REQUIREMENTS[itemToToggle.grade];
            const userLevelSum = user.strategyLevel + user.playfulLevel;

            if (!itemToToggle.isEquipped && userLevelSum < requiredLevel) {
                 return { error: `착용 레벨 합이 부족합니다. (필요: ${requiredLevel}, 현재: ${userLevelSum})` };
            }

            if (itemToToggle.isEquipped) {
                itemToToggle.isEquipped = false;
                delete user.equipment[itemToToggle.slot];
            } else {
                const currentItemInSlot = user.inventory.find(
                    i => i.isEquipped && i.slot === itemToToggle.slot
                );
                if (currentItemInSlot) {
                    currentItemInSlot.isEquipped = false;
                }
                itemToToggle.isEquipped = true;
                user.equipment[itemToToggle.slot] = itemToToggle.id;
            }

            // 장비 일관성 검증 및 수정
            validateAndFixEquipmentConsistency(user);

            const effects = effectService.calculateUserEffects(user);
            user.actionPoints.max = effects.maxActionPoints;
            user.actionPoints.current = Math.min(user.actionPoints.current, user.actionPoints.max);
            
            // 사용자 캐시 업데이트 (즉시 반영)
            const { updateUserCache } = await import('../gameCache.js');
            updateUserCache(user);
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'TOGGLE_EQUIP_ITEM', { includeAll: true });
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            // 캐시에 업데이트된 사용자 데이터를 사용하여 즉시 반영
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
            
            // DB 저장은 비동기로 처리하여 응답 지연 최소화
            db.updateUser(user).catch((error: any) => {
                console.error(`[TOGGLE_EQUIP_ITEM] Error updating user ${user.id}:`, error);
                console.error(`[TOGGLE_EQUIP_ITEM] Error stack:`, error.stack);
            });
            
            return { clientResponse: { updatedUser } };
        }

        case 'SELL_ITEM': {
            const { itemId, quantity } = payload as { itemId: string; quantity?: number };
            const itemIndex = user.inventory.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return { error: '아이템을 찾을 수 없습니다.' };

            const item = user.inventory[itemIndex];
            let sellPrice = 0;
            let sellQuantity = quantity || 1;

            if (item.type === 'equipment') {
                if (item.isEquipped) {
                    return { error: '장착 중인 아이템은 판매할 수 없습니다.' };
                }
                const basePrice = ITEM_SELL_PRICES[item.grade] || 0;
                const enhancementMultiplier = Math.pow(1.2, item.stars);
                sellPrice = Math.floor(basePrice * enhancementMultiplier);
                // 장비는 전체 판매
                user.inventory.splice(itemIndex, 1);
            } else if (item.type === 'material') {
                const pricePerUnit = MATERIAL_SELL_PRICES[item.name] || 1;
                const currentQuantity = item.quantity || 1;
                
                if (sellQuantity > currentQuantity) {
                    sellQuantity = currentQuantity;
                }
                
                sellPrice = pricePerUnit * sellQuantity;
                
                // 재료는 수량만큼만 제거
                if (sellQuantity >= currentQuantity) {
                    // 전체 판매
                    user.inventory.splice(itemIndex, 1);
                } else {
                    // 부분 판매
                    item.quantity = currentQuantity - sellQuantity;
                }
            } else if (item.type === 'consumable') {
                // 소비 아이템 판매 처리
                const itemName = item.name || '';
                const pricePerUnit = CONSUMABLE_SELL_PRICES[itemName] ?? 
                    CONSUMABLE_SELL_PRICES[itemName.replace('골드꾸러미', '골드 꾸러미')] ?? 
                    CONSUMABLE_SELL_PRICES[itemName.replace('골드 꾸러미', '골드꾸러미')] ?? 
                    0;
                
                const currentQuantity = item.quantity || 1;
                
                if (sellQuantity > currentQuantity) {
                    sellQuantity = currentQuantity;
                }
                
                sellPrice = pricePerUnit * sellQuantity;
                
                // 소비 아이템은 수량만큼만 제거
                if (sellQuantity >= currentQuantity) {
                    // 전체 판매
                    user.inventory.splice(itemIndex, 1);
                } else {
                    // 부분 판매
                    item.quantity = currentQuantity - sellQuantity;
                }
            } else {
                return { error: '판매할 수 없는 아이템입니다.' };
            }

            user.gold += sellPrice;
            
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(user.inventory));

            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[SELL_ITEM] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[SELL_ITEM] Error updating user ${user.id}:`, error);
                console.error(`[SELL_ITEM] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'SELL_ITEM');
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
            
            return { 
                clientResponse: { 
                    updatedUser,
                    sellResult: {
                        itemName: item.name,
                        sellPrice,
                        sellQuantity
                    }
                } 
            };
        }

        case 'ENHANCE_ITEM': {
            const { itemId } = payload;
            const item = user.inventory.find(i => i.id === itemId);
            if (!item || item.type !== 'equipment' || !item.options) return { error: '강화할 수 없는 아이템입니다.' };
            if (item.stars >= 10) return { error: '최대 강화 레벨입니다.' };

            const targetStars = item.stars + 1;
            const userLevelSum = user.strategyLevel + user.playfulLevel;
            const enhancementLevelRequirements: Record<number, number> = {
                4: 3,
                7: 8,
                10: 15,
            };

            if (enhancementLevelRequirements[targetStars] && userLevelSum < enhancementLevelRequirements[targetStars]) {
                return { error: `+${targetStars}강화 시도에는 유저 레벨 합 ${enhancementLevelRequirements[targetStars]}이(가) 필요합니다.` };
            }
            
            const originalItemState = JSON.parse(JSON.stringify(item));

            const costs = ENHANCEMENT_COSTS[item.grade]?.[item.stars];
            if (!costs) return { error: '강화 정보를 찾을 수 없습니다.' };

            const goldCost = calculateEnhancementGoldCost(item.grade, item.stars);
            if (user.gold < goldCost) {
                return { error: `골드가 부족합니다. (필요: ${goldCost}, 현재: ${user.gold})` };
            }

            if (!removeUserItems(user, costs)) {
                return { error: '재료가 부족합니다.' };
            }
            
            user.gold -= goldCost; // Deduct gold
            updateQuestProgress(user, 'enhancement_attempt');
            
            // Update Guild Mission Progress for equipment enhancements
            if (user.guildId) {
                const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                await guildService.updateGuildMissionProgress(user.guildId, 'equipmentEnhancements', 1, guilds);
            }

            const baseSuccessRate = ENHANCEMENT_SUCCESS_RATES[item.stars];
            const failBonusRate = ENHANCEMENT_FAIL_BONUS_RATES[item.grade] || 0.5;
            const failBonus = (item.enhancementFails || 0) * failBonusRate;
            const successRate = Math.min(100, baseSuccessRate + failBonus);

            const isSuccess = Math.random() * 100 < successRate;
            let resultMessage = '';

            if (isSuccess) {
                item.stars++;
                item.enhancementFails = 0;
                resultMessage = `강화 성공! +${item.stars} ${item.name}이(가) 되었습니다.`;
                
                // 7강화, 10강화 성공 시 전체 채팅창에 시스템 메시지 전송
                if (item.stars === 7 || item.stars === 10) {
                    const systemMessage: ChatMessage = {
                        id: `system-${randomUUID()}`,
                        user: { id: 'system', nickname: '시스템' },
                        text: `${user.nickname}님이 ${item.name}의 ${item.stars}강화에 성공했습니다.`,
                        system: true,
                        timestamp: Date.now(),
                        itemLink: {
                            itemId: item.id,
                            userId: user.id,
                            itemName: item.name,
                            itemGrade: item.grade
                        },
                        userLink: {
                            userId: user.id,
                            userName: user.nickname
                        }
                    };
                    
                    // global 채팅에 추가
                    if (!volatileState.waitingRoomChats['global']) {
                        volatileState.waitingRoomChats['global'] = [];
                    }
                    volatileState.waitingRoomChats['global'].push(systemMessage);
                    if (volatileState.waitingRoomChats['global'].length > 100) {
                        volatileState.waitingRoomChats['global'].shift();
                    }
                    
                    // 채팅 업데이트 브로드캐스트
                    broadcast({ 
                        type: 'WAITING_ROOM_CHAT_UPDATE', 
                        payload: { global: volatileState.waitingRoomChats['global'] } 
                    });
                }
                
                const main = item.options.main;
                if(main.baseValue) {
                    let increaseMultiplier = 1;
                    if (item.stars === 4) {
                        increaseMultiplier = 1.3; // 4강화: 1.3배 (반올림)
                    } else if (item.stars === 7) {
                        increaseMultiplier = 1.5; // 7강화: 1.5배 (반올림)
                    } else if (item.stars === 10) {
                        increaseMultiplier = 2; // 10강화: 2배
                    }
                    const increaseAmount = Math.round(main.baseValue * increaseMultiplier);
                    main.value = parseFloat((main.value + increaseAmount).toFixed(2));
                    main.display = `${main.type} +${main.value}${main.isPercentage ? '%' : ''}`;
                }

                if (item.options.combatSubs.length < 4) {
                    const rules = GRADE_SUB_OPTION_RULES[item.grade];
                    const existingSubTypes = new Set([main.type, ...item.options.combatSubs.map(s => s.type)]);
                    const combatTier = rules.combatTier;
                    const combatPool = SUB_OPTION_POOLS[item.slot!][combatTier].filter(opt => !existingSubTypes.has(opt.type));
                    if(combatPool.length > 0) {
                        const newSubDef = combatPool[Math.floor(Math.random() * combatPool.length)];
                        const value = getRandomInt(newSubDef.range[0], newSubDef.range[1]);
                        const newSub: ItemOption = {
                            type: newSubDef.type, value, isPercentage: newSubDef.isPercentage,
                            display: `${newSubDef.type} +${value}${newSubDef.isPercentage ? '%' : ''} [${newSubDef.range[0]}~${newSubDef.range[1]}]`,
                            range: newSubDef.range,
                            enhancements: 0,
                        };
                        item.options.combatSubs.push(newSub);
                    }
                } else {
                    const subToUpgrade = item.options.combatSubs[Math.floor(Math.random() * item.options.combatSubs.length)];
                    subToUpgrade.enhancements = (subToUpgrade.enhancements || 0) + 1;
        
                    const itemTier = GRADE_SUB_OPTION_RULES[item.grade].combatTier;
                    const subOptionPool = SUB_OPTION_POOLS[item.slot!][itemTier];
                    const subDef = subOptionPool.find(s => s.type === subToUpgrade.type && s.isPercentage === subToUpgrade.isPercentage);
        
                    if (subDef) {
                        const increaseAmount = getRandomInt(subDef.range[0], subDef.range[1]);
                        subToUpgrade.value += increaseAmount;
        
                        if (!subToUpgrade.range) {
                            subToUpgrade.range = [subDef.range[0], subDef.range[1]];
                        } else {
                            subToUpgrade.range[0] += subDef.range[0];
                            subToUpgrade.range[1] += subDef.range[1];
                        }
                        
                        subToUpgrade.display = `${subToUpgrade.type} +${subToUpgrade.value}${subToUpgrade.isPercentage ? '%' : ''} [${subToUpgrade.range[0]}~${subToUpgrade.range[1]}]`;

                    } else {
                        // Fallback for safety, though this shouldn't happen with valid data
                        subToUpgrade.value = parseFloat((subToUpgrade.value * 1.1).toFixed(2));
                        subToUpgrade.display = `${subToUpgrade.type} +${subToUpgrade.value}${subToUpgrade.isPercentage ? '%' : ''}`;
                    }
                }

            } else {
                item.enhancementFails = (item.enhancementFails || 0) + 1;
                const newFailBonus = item.enhancementFails * failBonusRate;
                resultMessage = `강화에 실패했습니다. (실패 보너스: +${newFailBonus.toFixed(1).replace(/\.0$/, '')}%)`;
            }

            // Add blacksmith XP
            let xpGained = 0;
            const xpGainRange = BLACKSMITH_ENHANCEMENT_XP_GAIN[item.grade];
            if (xpGainRange) {
                xpGained = getRandomInt(xpGainRange[0], xpGainRange[1]);
                user.blacksmithXp = (user.blacksmithXp || 0) + xpGained;

                while (user.blacksmithLevel < BLACKSMITH_MAX_LEVEL && user.blacksmithXp >= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel)) {
                    user.blacksmithXp -= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel);
                    user.blacksmithLevel++;
                }
            }
            
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(user.inventory));
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[ENHANCE_ITEM] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[ENHANCE_ITEM] Error updating user ${user.id}:`, error);
                console.error(`[ENHANCE_ITEM] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            const itemBeforeEnhancement = JSON.parse(JSON.stringify(originalItemState));
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'ENHANCE_ITEM');

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
            
            return { 
                clientResponse: { 
                    updatedUser,
                    enhancementOutcome: { 
                        message: resultMessage, 
                        success: isSuccess, 
                        itemBefore: itemBeforeEnhancement, 
                        itemAfter: item,
                        xpGained: xpGained
                    },
                    enhancementAnimationTarget: { itemId: item.id, stars: item.stars } 
                } 
            };
        }
        case 'DISASSEMBLE_ITEM': {
            const { itemIds } = payload as { itemIds: string[] };
            if (!itemIds || itemIds.length === 0) return { error: '분해할 아이템을 선택하세요.' };

            const gainedMaterials: Record<string, number> = {};
            const itemsToRemove: string[] = [];
            let totalXpGained = 0;

            for (const itemId of itemIds) {
                const item = user.inventory.find((i: InventoryItem) => i.id === itemId);
                if (!item) continue; // Item not found, skip

                if (item.type !== 'equipment') return { error: '장비 아이템만 분해할 수 있습니다.' };
                if (item.isEquipped) return { error: '장착 중인 아이템은 분해할 수 없습니다.' };

                // Calculate materials from next enhancement level costs (30%)
                const nextStars = item.stars + 1;
                const costsForNextLevel = ENHANCEMENT_COSTS[item.grade]?.[item.stars];
                
                if (costsForNextLevel) {
                    for (const cost of costsForNextLevel) {
                        const yieldRatio = getRandomInt(20, 50) / 100;
                        const yieldAmount = Math.max(1, Math.floor(cost.amount * yieldRatio));
                        if (yieldAmount > 0) {
                            gainedMaterials[cost.name] = (gainedMaterials[cost.name] || 0) + yieldAmount;
                        }
                    }
                }

                // Add blacksmith XP for disassembly
                const xpGainRange = BLACKSMITH_DISASSEMBLY_XP_GAIN[item.grade];
                if (xpGainRange) {
                    totalXpGained += getRandomInt(xpGainRange[0], xpGainRange[1]);
                }

                itemsToRemove.push(itemId);
            }

            if (itemsToRemove.length === 0) return { error: '분해할 수 있는 아이템이 없습니다.' };

            const baseJackpotRate = BLACKSMITH_DISASSEMBLY_JACKPOT_RATES[user.blacksmithLevel - 1] ?? 0;
            const mannerEffects = effectService.getMannerEffects(user);
            const jackpotRate = Math.min(100, baseJackpotRate + (mannerEffects.disassemblyJackpotBonusPercent ?? 0));
            const isJackpot = Math.random() * 100 < jackpotRate;
            if (isJackpot) {
                for (const key in gainedMaterials) {
                    gainedMaterials[key] *= 2;
                }
            }
            
            const itemsToAdd: InventoryItem[] = Object.entries(gainedMaterials).map(([name, quantity]) => ({
                ...MATERIAL_ITEMS[name], id: `item-${randomUUID()}`, quantity, createdAt: Date.now(), isEquipped: false, level: 1, stars: 0
            }));
            
            const inventoryAfterRemoval = user.inventory.filter(item => !itemsToRemove.includes(item.id));
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventoryUtil(inventoryAfterRemoval, user.inventorySlots, itemsToAdd);
            if (!success) return { error: '재료를 받기에 인벤토리 공간이 부족합니다.' };

            user.inventory = updatedInventory;

            // Update blacksmith XP
            user.blacksmithXp = (user.blacksmithXp || 0) + totalXpGained;
            while (user.blacksmithLevel < BLACKSMITH_MAX_LEVEL && user.blacksmithXp >= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel)) {
                user.blacksmithXp -= BLACKSMITH_XP_REQUIRED_FOR_LEVEL_UP(user.blacksmithLevel);
                user.blacksmithLevel++;
            }

            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(user.inventory));
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[DISASSEMBLE_ITEM] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[DISASSEMBLE_ITEM] Error updating user ${user.id}:`, error);
                console.error(`[DISASSEMBLE_ITEM] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'DISASSEMBLE_ITEM');

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            return { 
                clientResponse: { 
                    updatedUser,
                    disassemblyResult: { 
                        gained: Object.entries(gainedMaterials).map(([name, amount]) => ({ name, amount })), 
                        jackpot: isJackpot,
                        xpGained: totalXpGained
                    }
                }
            };
        }
        case 'CRAFT_MATERIAL': {
            const { materialName, craftType, quantity } = payload as { materialName: string, craftType: 'upgrade' | 'downgrade', quantity: number };
            const materialTiers = ['하급 강화석', '중급 강화석', '상급 강화석', '최상급 강화석', '신비의 강화석'];
            const tierIndex = materialTiers.indexOf(materialName);
            if (tierIndex === -1) return { error: '잘못된 재료입니다.' };
        
            let fromMaterialName: string, toMaterialName: string, fromCost: number, toYield: number;
        
            // 대장간 레벨에 따른 대박 확률 적용 (장비 분해와 동일)
            const blacksmithLevel = user.blacksmithLevel ?? 1;
            const baseJackpotRate = BLACKSMITH_DISASSEMBLY_JACKPOT_RATES[blacksmithLevel - 1] ?? 0;
            const mannerEffects = effectService.getMannerEffects(user);
            const jackpotRate = Math.min(100, baseJackpotRate + (mannerEffects.disassemblyJackpotBonusPercent ?? 0));
            const isJackpot = Math.random() * 100 < jackpotRate;
            
            if (craftType === 'upgrade') {
                if (tierIndex >= materialTiers.length - 1) return { error: '더 이상 제작할 수 없습니다.' };
                fromMaterialName = materialTiers[tierIndex];
                toMaterialName = materialTiers[tierIndex + 1];
                fromCost = 10 * quantity;
                toYield = 1 * quantity;
                // 대박 발생 시 재료를 2배로 획득
                if (isJackpot) {
                    toYield *= 2;
                }
            } else { // downgrade
                if (tierIndex === 0) return { error: '더 이상 분해할 수 없습니다.' };
                fromMaterialName = materialTiers[tierIndex];
                toMaterialName = materialTiers[tierIndex - 1];
                fromCost = 1 * quantity;
                // 분해 시 기본 분해 개수를 3~5개로 랜덤 분해
                const baseYieldPerItem = getRandomInt(3, 5);
                toYield = baseYieldPerItem * quantity;
                // 대박 발생 시 재료를 2배로 획득
                if (isJackpot) {
                    toYield *= 2;
                }
            }
        
            const tempUser = JSON.parse(JSON.stringify(user));
        
            if (!removeUserItems(tempUser, [{ name: fromMaterialName, amount: fromCost }])) {
                return { error: '재료가 부족합니다.' };
            }
        
            const toAddTemplate = MATERIAL_ITEMS[toMaterialName];
            const itemsToAdd: InventoryItem[] = [{
                ...toAddTemplate, id: `item-${randomUUID()}`, quantity: toYield, createdAt: 0, isEquipped: false, level: 1, stars: 0
            }];
        
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventoryUtil(tempUser.inventory, tempUser.inventorySlots, itemsToAdd);
            if (!success) {
                return { error: '인벤토리에 공간이 부족합니다.' };
            }
            
            // All checks passed, apply changes to the real user object
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            
            updateQuestProgress(user, 'craft_attempt');
            
            // Update Guild Mission Progress for material crafts
            if (user.guildId) {
                const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                await guildService.updateGuildMissionProgress(user.guildId, 'materialCrafts', quantity, guilds);
            }
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[CRAFT_MATERIAL] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[CRAFT_MATERIAL] Error updating user ${user.id}:`, error);
                console.error(`[CRAFT_MATERIAL] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'CRAFT_MATERIAL', { includeAll: true });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
        
            return {
                clientResponse: {
                    updatedUser,
                    craftResult: {
                        gained: [{ name: toMaterialName, amount: toYield }],
                        used: [{ name: fromMaterialName, amount: fromCost }],
                        craftType,
                        jackpot: isJackpot
                    }
                }
            };
        }

        case 'EXPAND_INVENTORY': {
            const { category } = payload as { category: 'equipment' | 'consumable' | 'material' };
            if (!category) return { error: '확장할 인벤토리 탭을 지정해야 합니다.' };

            const BASE_SLOTS_PER_CATEGORY = 30;
            const EXPANSION_AMOUNT = 10;
            const MAX_INVENTORY_SIZE = 100;

            const currentCategorySlots = user.inventorySlots[category] || BASE_SLOTS_PER_CATEGORY;

            if (currentCategorySlots >= MAX_INVENTORY_SIZE) {
                return { error: '이미 최대치까지 확장했습니다.' };
            }

            const expansionsMade = Math.max(0, (currentCategorySlots - BASE_SLOTS_PER_CATEGORY) / EXPANSION_AMOUNT);
            const expansionCost = 100 + (expansionsMade * 20);

            if (user.diamonds < expansionCost) {
                return { error: '다이아가 부족합니다.' };
            }

            user.diamonds -= expansionCost;
            user.inventorySlots[category] += EXPANSION_AMOUNT;

            await db.updateUser(user);
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'EXPAND_INVENTORY');
            
            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });
            
            return { clientResponse: { updatedUser } };
        }

        default:
            return { error: `Unknown inventory action: ${type}` };
    }
};