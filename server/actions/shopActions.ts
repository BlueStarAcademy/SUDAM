


import { randomUUID } from 'crypto';
import * as db from '../db.js';
import { type ServerAction, type User, type VolatileState, InventoryItem } from '../../types/index.js';
import * as shop from '../shop.js';
import { SHOP_ITEMS } from '../shop.js';
import { broadcast } from '../socket.js';
import { isSameDayKST, isDifferentWeekKST } from '../../utils/timeUtils.js';
import { CONSUMABLE_ITEMS, MATERIAL_ITEMS, ACTION_POINT_PURCHASE_COSTS_DIAMONDS, MAX_ACTION_POINT_PURCHASES_PER_DAY, ACTION_POINT_PURCHASE_REFILL_AMOUNT, SHOP_BORDER_ITEMS } from '../../constants';
import { addItemsToInventory } from '../../utils/inventoryUtils.js';
import { getSelectiveUserUpdate } from '../utils/userUpdateHelper.js';
import * as guildService from '../guildService.js';

type HandleActionResult = { 
    clientResponse?: any;
    error?: string;
};

export const handleShopAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;

    switch (type) {
        case 'BUY_SHOP_ITEM': {
            try {
                const { itemId, quantity } = payload;
                
                if (!itemId || typeof quantity !== 'number' || quantity <= 0) {
                    return { error: '유효하지 않은 요청입니다.' };
                }
                
                const shopItem = SHOP_ITEMS[itemId as keyof typeof SHOP_ITEMS];
                if (!shopItem || shopItem.type !== 'equipment') {
                    return { error: '유효하지 않은 장비 상자입니다.' };
                }

                const cost = shopItem.cost;
                const totalGoldCost = (cost.gold || 0) * quantity;
                const totalDiamondCost = (cost.diamonds || 0) * quantity;

                if (!user.isAdmin) {
                    if (user.gold < totalGoldCost || user.diamonds < totalDiamondCost) {
                        return { error: '재화가 부족합니다.' };
                    }
                }

                const obtainedItems: InventoryItem[] = [];
                for (let i = 0; i < quantity; i++) {
                    try {
                        const result = shopItem.onPurchase();
                        obtainedItems.push(...(Array.isArray(result) ? result : [result]));
                    } catch (error: any) {
                        console.error(`[BUY_SHOP_ITEM] Error in onPurchase for item ${itemId}:`, error);
                        return { error: '아이템 생성 중 오류가 발생했습니다.' };
                    }
                }

                if (!user.inventory) {
                    user.inventory = [];
                }
                if (!user.inventorySlots) {
                    user.inventorySlots = { equipment: 30, consumable: 30, material: 30 };
                }

                const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, obtainedItems);
                if (!success || !updatedInventory) {
                    return { error: '인벤토리 공간이 부족합니다.' };
                }
                
                if (!user.isAdmin) {
                    user.gold -= totalGoldCost;
                    user.diamonds -= totalDiamondCost;
                    
                    // Update Guild Mission Progress for diamonds spent
                    if (totalDiamondCost > 0 && user.guildId) {
                        const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                        await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', totalDiamondCost, guilds);
                    }
                }

                // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
                user.inventory = JSON.parse(JSON.stringify(updatedInventory));
                
                try {
                    // 데이터베이스에 저장
                    await db.updateUser(user);
                    
                    // 저장 후 DB에서 다시 읽어서 검증 (저장이 제대로 되었는지 확인)
                    const savedUser = await db.getUser(user.id);
                    if (!savedUser) {
                        console.error(`[BUY_SHOP_ITEM] User not found after save: ${user.id}`);
                        return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                    }
                    
                    // 저장된 인벤토리 길이 확인
                    if (!savedUser.inventory || savedUser.inventory.length !== user.inventory.length) {
                        console.error(`[BUY_SHOP_ITEM] Inventory mismatch after save. Expected: ${user.inventory.length}, Got: ${savedUser.inventory?.length || 0}`);
                        // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                        user = savedUser;
                    } else {
                        // 저장이 성공했으므로 저장된 사용자 데이터 사용
                        user = savedUser;
                    }
                } catch (error: any) {
                    console.error(`[BUY_SHOP_ITEM] Error updating user ${user.id}:`, error);
                    console.error(`[BUY_SHOP_ITEM] Error stack:`, error.stack);
                    return { error: '데이터 저장 중 오류가 발생했습니다.' };
                }

                // 선택적 필드만 반환 (메시지 크기 최적화)
                const updatedUser = getSelectiveUserUpdate(user, 'BUY_SHOP_ITEM', { includeAll: true });

                // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
                const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
                broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

                return { clientResponse: { obtainedItemsBulk: obtainedItems, updatedUser } };
            } catch (error: any) {
                console.error(`[BUY_SHOP_ITEM] Unexpected error:`, error);
                console.error(`[BUY_SHOP_ITEM] Error stack:`, error.stack);
                return { error: '구매 처리 중 오류가 발생했습니다.' };
            }
        }
        case 'BUY_MATERIAL_BOX': {
            const { itemId, quantity } = payload;
            const shopItem = SHOP_ITEMS[itemId as keyof typeof SHOP_ITEMS] as any;

            if (!shopItem || shopItem.type !== 'material') {
                return { error: '유효하지 않은 재료 상자입니다.' };
            }
            
            const now = Date.now();
            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const purchaseRecord = user.dailyShopPurchases[itemId];

            let purchasesThisPeriod = 0;
            let limit = Infinity;
            let limitText = '';
            let resetPurchaseRecord = false;
        
            if (shopItem.weeklyLimit) {
                limit = shopItem.weeklyLimit;
                // FIX: Corrected typo from `limitType` to `limitText`.
                limitText = '이번 주';
                if (purchaseRecord && !isDifferentWeekKST(purchaseRecord.date, now)) {
                    purchasesThisPeriod = purchaseRecord.quantity;
                } else {
                    resetPurchaseRecord = true;
                }
            } else if (shopItem.dailyLimit) {
                limit = shopItem.dailyLimit;
                // FIX: Corrected typo from `limitType` to `limitText`.
                limitText = '오늘';
                if (purchaseRecord && isSameDayKST(purchaseRecord.date, now)) {
                    purchasesThisPeriod = purchaseRecord.quantity;
                } else {
                    resetPurchaseRecord = true;
                }
            }
            
            if (!user.isAdmin) {
                if (purchasesThisPeriod + quantity > limit) {
                    // FIX: Corrected typo from `limitType` to `limitText`.
                    return { error: `${limitText} 구매 한도를 초과했습니다.` };
                }
            }
            
            const allObtainedItems: InventoryItem[] = [];
            for (let i = 0; i < quantity; i++) {
                const itemsFromBox = shopItem.onPurchase();
                allObtainedItems.push(...itemsFromBox);
            }
            
            if (!user.inventory) {
                user.inventory = [];
            }
            if (!user.inventorySlots) {
                user.inventorySlots = { equipment: 30, consumable: 30, material: 30 };
            }
            
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, allObtainedItems);
            if (!success || !updatedInventory) {
                return { error: '모든 아이템을 받기에 가방 공간이 부족합니다.' };
            }

            const totalCost = {
                gold: (shopItem.cost.gold || 0) * quantity,
                diamonds: (shopItem.cost.diamonds || 0) * quantity,
            };
            
            if (!user.isAdmin) {
                if (user.gold < totalCost.gold || user.diamonds < totalCost.diamonds) {
                    return { error: '재화가 부족합니다.' };
                }
                user.gold -= totalCost.gold;
                user.diamonds -= totalCost.diamonds;
                
                // Update Guild Mission Progress for diamonds spent
                if (totalCost.diamonds > 0 && user.guildId) {
                    const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', totalCost.diamonds, guilds);
                }
            }
            
            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            
            if (!user.isAdmin) {
                if (resetPurchaseRecord || !user.dailyShopPurchases[itemId]) {
                    user.dailyShopPurchases[itemId] = { quantity: 0, date: now };
                }
                user.dailyShopPurchases[itemId].quantity = purchasesThisPeriod + quantity;
                user.dailyShopPurchases[itemId].date = now;
            }
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[BUY_MATERIAL_BOX] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[BUY_MATERIAL_BOX] Error updating user ${user.id}:`, error);
                console.error(`[BUY_MATERIAL_BOX] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }
            
            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'BUY_MATERIAL_BOX', { includeAll: true });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            // 아이템을 이름별로 집계하되, 원본 아이템의 모든 속성(image 포함)을 보존
            const itemMap = new Map<string, InventoryItem>();
            allObtainedItems.forEach(item => {
                if (itemMap.has(item.name)) {
                    const existing = itemMap.get(item.name)!;
                    existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
                } else {
                    // 원본 아이템을 깊은 복사하여 보존
                    itemMap.set(item.name, {
                        ...item,
                        quantity: item.quantity || 1
                    });
                }
            });
            const itemsToAdd = Array.from(itemMap.values());

            return { clientResponse: { obtainedItemsBulk: itemsToAdd, updatedUser } };
        }
        case 'PURCHASE_ACTION_POINTS': {
            const now = Date.now();
            const purchasesToday = isSameDayKST(user.lastActionPointPurchaseDate || 0, now) 
                ? (user.actionPointPurchasesToday || 0) 
                : 0;

            if (purchasesToday >= MAX_ACTION_POINT_PURCHASES_PER_DAY && !user.isAdmin) {
                return { error: '오늘 구매 한도를 초과했습니다.' };
            }

            const cost = ACTION_POINT_PURCHASE_COSTS_DIAMONDS[purchasesToday];
            if (user.diamonds < cost && !user.isAdmin) {
                return { error: '다이아가 부족합니다.' };
            }

            if (!user.isAdmin) {
                user.diamonds -= cost;
                user.actionPointPurchasesToday = purchasesToday + 1;
                user.lastActionPointPurchaseDate = now;
                
                // Update Guild Mission Progress for diamonds spent
                if (cost > 0 && user.guildId) {
                    const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', cost, guilds);
                }
            }
            user.actionPoints.current += ACTION_POINT_PURCHASE_REFILL_AMOUNT;
            
            await db.updateUser(user);
            const updatedUser = JSON.parse(JSON.stringify(user));
            
            // WebSocket으로 사용자 업데이트 브로드캐스트
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: updatedUser } });
            
            return { clientResponse: { updatedUser } };
        }
        case 'EXPAND_INVENTORY': {
            const { category } = payload;
            const EXPANSION_COST_DIAMONDS = 100;
            const EXPANSION_AMOUNT = 10;
            const MAX_INVENTORY_SIZE = 100;
            
            if (user.inventorySlots[category] >= MAX_INVENTORY_SIZE) {
                return { error: '가방을 더 이상 확장할 수 없습니다.' };
            }

            if (!user.isAdmin) {
                if (user.diamonds < EXPANSION_COST_DIAMONDS) {
                    return { error: '다이아가 부족합니다.' };
                }
                user.diamonds -= EXPANSION_COST_DIAMONDS;
                
                // Update Guild Mission Progress for diamonds spent
                if (user.guildId) {
                    const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', EXPANSION_COST_DIAMONDS, guilds);
                }
            }
            
            user.inventorySlots[category] = Math.min(MAX_INVENTORY_SIZE, user.inventorySlots[category] + EXPANSION_AMOUNT);
            
            await db.updateUser(user);
            const updatedUser = JSON.parse(JSON.stringify(user));
            
            // WebSocket으로 사용자 업데이트 브로드캐스트
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: updatedUser } });
            
            return { clientResponse: { updatedUser } };
        }
        case 'BUY_BORDER': {
            const { borderId } = payload;
            const borderItem = SHOP_BORDER_ITEMS.find(b => b.id === borderId);
            if (!borderItem) return { error: '판매하지 않는 테두리입니다.' };
            if (user.ownedBorders.includes(borderId)) return { error: '이미 보유한 테두리입니다.' };

            const cost = borderItem.price.gold || 0;
            if (user.gold < cost && !user.isAdmin) return { error: '골드가 부족합니다.' };
            
            const diamondCost = borderItem.price.diamonds || 0;
            if (user.diamonds < diamondCost && !user.isAdmin) return { error: '다이아가 부족합니다.' };

            if (!user.isAdmin) {
                user.gold -= cost;
                user.diamonds -= diamondCost;
                
                // Update Guild Mission Progress for diamonds spent
                if (diamondCost > 0 && user.guildId) {
                    const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', diamondCost, guilds);
                }
            }

            user.ownedBorders.push(borderId);
            await db.updateUser(user);
            const updatedUser = JSON.parse(JSON.stringify(user));
            
            // WebSocket으로 사용자 업데이트 브로드캐스트
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: updatedUser } });
            
            return { clientResponse: { updatedUser } };
        }
        case 'BUY_CONDITION_POTION': {
            const { potionType, quantity } = payload as { potionType: 'small' | 'medium' | 'large'; quantity: number };
            
            const potionInfo = {
                small: { name: '컨디션회복제(소)', price: 100 },
                medium: { name: '컨디션회복제(중)', price: 150 },
                large: { name: '컨디션회복제(대)', price: 200 }
            }[potionType];

            if (!potionInfo) {
                return { error: '유효하지 않은 회복제 타입입니다.' };
            }

            if (typeof quantity !== 'number' || quantity <= 0) {
                return { error: '유효하지 않은 수량입니다.' };
            }

            const now = Date.now();
            const itemId = `condition_potion_${potionType}`;
            const DAILY_LIMIT = 3;

            // 일일 구매 제한 체크
            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const purchaseRecord = user.dailyShopPurchases[itemId];
            
            let purchasesToday = 0;
            if (purchaseRecord && isSameDayKST(purchaseRecord.date, now)) {
                purchasesToday = purchaseRecord.quantity;
            }

            if (!user.isAdmin) {
                if (purchasesToday + quantity > DAILY_LIMIT) {
                    return { error: `오늘 구매 한도를 초과했습니다. (남은 구매 가능: ${DAILY_LIMIT - purchasesToday}개)` };
                }
            }

            const totalCost = potionInfo.price * quantity;
            if (!user.isAdmin) {
                if (user.gold < totalCost) {
                    return { error: `골드가 부족합니다. (필요: ${totalCost} 골드)` };
                }
            }

            // 아이템 생성
            const template = CONSUMABLE_ITEMS.find(item => item.name === potionInfo.name);
            if (!template) {
                return { error: '회복제 템플릿을 찾을 수 없습니다.' };
            }

            const newItem: InventoryItem = {
                ...template,
                id: `item-${randomUUID()}`,
                createdAt: Date.now(),
                quantity: quantity,
                isEquipped: false,
                level: 1,
                stars: 0,
            };

            if (!user.inventory) {
                user.inventory = [];
            }
            if (!user.inventorySlots) {
                user.inventorySlots = { equipment: 30, consumable: 30, material: 30 };
            }

            // 인벤토리에 추가
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, [newItem]);
            if (!success || !updatedInventory) {
                return { error: '인벤토리 공간이 부족합니다.' };
            }

            // 골드 차감 및 구매 기록 업데이트
            if (!user.isAdmin) {
                user.gold -= totalCost;
                if (!user.dailyShopPurchases[itemId] || !isSameDayKST(purchaseRecord?.date || 0, now)) {
                    user.dailyShopPurchases[itemId] = { quantity: 0, date: now };
                }
                user.dailyShopPurchases[itemId].quantity = purchasesToday + quantity;
                user.dailyShopPurchases[itemId].date = now;
            }

            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[BUY_CONDITION_POTION] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[BUY_CONDITION_POTION] Error updating user ${user.id}:`, error);
                console.error(`[BUY_CONDITION_POTION] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'BUY_CONDITION_POTION', { includeAll: true });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            return { 
                clientResponse: { 
                    obtainedItemsBulk: [{ ...newItem }], 
                    updatedUser 
                } 
            };
        }
        case 'BUY_CONSUMABLE': {
            const { itemId, quantity } = payload;
            
            if (!itemId || typeof quantity !== 'number' || quantity <= 0) {
                return { error: '유효하지 않은 요청입니다.' };
            }

            // 변경권 아이템 정의
            const consumableItems: Record<string, { name: string; price: number; dailyLimit: number }> = {
                'option_type_change_ticket': { name: '옵션 종류 변경권', price: 500, dailyLimit: 10 },
                'option_value_change_ticket': { name: '옵션 수치 변경권', price: 500, dailyLimit: 10 },
                'mythic_option_change_ticket': { name: '신화 옵션 종류 변경권', price: 500, dailyLimit: 10 },
            };

            const itemInfo = consumableItems[itemId];
            if (!itemInfo) {
                return { error: '유효하지 않은 아이템입니다.' };
            }

            const now = Date.now();
            const DAILY_LIMIT = itemInfo.dailyLimit;

            // 일일 구매 제한 체크
            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const purchaseRecord = user.dailyShopPurchases[itemId];
            
            let purchasesToday = 0;
            if (purchaseRecord && isSameDayKST(purchaseRecord.date, now)) {
                purchasesToday = purchaseRecord.quantity;
            }

            if (!user.isAdmin) {
                if (purchasesToday + quantity > DAILY_LIMIT) {
                    return { error: `오늘 구매 한도를 초과했습니다. (남은 구매 가능: ${DAILY_LIMIT - purchasesToday}개)` };
                }
            }

            const totalCost = itemInfo.price * quantity;
            if (!user.isAdmin) {
                if (user.gold < totalCost) {
                    return { error: `골드가 부족합니다. (필요: ${totalCost} 골드)` };
                }
            }

            // 아이템 생성
            const template = CONSUMABLE_ITEMS.find(item => item.name === itemInfo.name);
            if (!template) {
                return { error: '아이템 템플릿을 찾을 수 없습니다.' };
            }

            const newItem: InventoryItem = {
                ...template,
                id: `item-${randomUUID()}`,
                createdAt: Date.now(),
                quantity: quantity,
                isEquipped: false,
                level: 1,
                stars: 0,
            };

            if (!user.inventory) {
                user.inventory = [];
            }
            if (!user.inventorySlots) {
                user.inventorySlots = { equipment: 30, consumable: 30, material: 30 };
            }

            // 인벤토리에 추가
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, [newItem]);
            if (!success || !updatedInventory) {
                return { error: '인벤토리 공간이 부족합니다.' };
            }

            // 골드 차감 및 구매 기록 업데이트
            if (!user.isAdmin) {
                user.gold -= totalCost;
                if (!user.dailyShopPurchases[itemId] || !isSameDayKST(purchaseRecord?.date || 0, now)) {
                    user.dailyShopPurchases[itemId] = { quantity: 0, date: now };
                }
                user.dailyShopPurchases[itemId].quantity = purchasesToday + quantity;
                user.dailyShopPurchases[itemId].date = now;
            }

            // 인벤토리를 깊은 복사하여 새로운 배열로 할당 (참조 문제 방지)
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));
            
            try {
                // 데이터베이스에 저장
                await db.updateUser(user);
                
                // 저장 후 DB에서 다시 읽어서 검증
                const savedUser = await db.getUser(user.id);
                if (!savedUser) {
                    console.error(`[BUY_CONSUMABLE] User not found after save: ${user.id}`);
                    return { error: '저장 후 사용자를 찾을 수 없습니다.' };
                }
                
                // 저장된 사용자 데이터 사용 (DB에 실제로 저장된 것)
                user = savedUser;
            } catch (error: any) {
                console.error(`[BUY_CONSUMABLE] Error updating user ${user.id}:`, error);
                console.error(`[BUY_CONSUMABLE] Error stack:`, error.stack);
                return { error: '데이터 저장 중 오류가 발생했습니다.' };
            }

            // 선택적 필드만 반환 (메시지 크기 최적화)
            const updatedUser = getSelectiveUserUpdate(user, 'BUY_CONSUMABLE', { includeAll: true });

            // WebSocket으로 사용자 업데이트 브로드캐스트 (전체 객체는 WebSocket에서만)
            const fullUserForBroadcast = JSON.parse(JSON.stringify(user));
            broadcast({ type: 'USER_UPDATE', payload: { [user.id]: fullUserForBroadcast } });

            return { 
                clientResponse: { 
                    obtainedItemsBulk: [{ ...newItem }], 
                    updatedUser 
                } 
            };
        }
        case 'BUY_TOWER_ITEM': {
            const { itemId, quantity } = payload;
            
            if (!itemId || typeof quantity !== 'number' || quantity <= 0) {
                return { error: '유효하지 않은 요청입니다.' };
            }

            // 도전의 탑 아이템 정의
            const towerItems: Record<string, { name: string; price: { gold?: number; diamonds?: number }; maxOwned: number; dailyLimit: number }> = {
                '턴 추가': { name: '턴 추가', price: { gold: 300 }, maxOwned: 3, dailyLimit: 3 },
                '미사일': { name: '미사일', price: { gold: 300 }, maxOwned: 2, dailyLimit: 2 },
                '히든': { name: '히든', price: { gold: 500 }, maxOwned: 2, dailyLimit: 2 },
                '배치변경': { name: '배치변경', price: { gold: 100 }, maxOwned: 5, dailyLimit: 5 }
            };

            const itemInfo = towerItems[itemId];
            if (!itemInfo) {
                return { error: '유효하지 않은 아이템입니다.' };
            }

            const now = Date.now();
            
            // 현재 보유 개수 확인
            const inventory = user.inventory || [];
            const currentItem = inventory.find((inv: any) => inv.name === itemInfo.name || inv.id === itemInfo.name);
            const currentOwned = currentItem?.quantity ?? 0;

            // 보유 제한 확인
            if (!user.isAdmin && currentOwned + quantity > itemInfo.maxOwned) {
                return { error: `최대 보유 개수(${itemInfo.maxOwned}개)를 초과할 수 없습니다.` };
            }

            // 하루 구매 제한 확인
            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const purchaseRecord = user.dailyShopPurchases[itemId];
            const todayPurchased = (purchaseRecord && isSameDayKST(purchaseRecord.date, now)) ? purchaseRecord.quantity : 0;

            if (!user.isAdmin && todayPurchased + quantity > itemInfo.dailyLimit) {
                return { error: `하루 구매 한도(${itemInfo.dailyLimit}개)를 초과했습니다.` };
            }

            // 가격 확인
            const totalGoldCost = (itemInfo.price.gold || 0) * quantity;
            const totalDiamondCost = (itemInfo.price.diamonds || 0) * quantity;

            if (!user.isAdmin) {
                if (user.gold < totalGoldCost || user.diamonds < totalDiamondCost) {
                    return { error: '재화가 부족합니다.' };
                }
            }

            // 아이템 템플릿 찾기
            const template = CONSUMABLE_ITEMS.find(item => item.name === itemInfo.name);
            if (!template) {
                return { error: '아이템 템플릿을 찾을 수 없습니다.' };
            }

            // 아이템 생성
            const newItem: InventoryItem = {
                ...template,
                id: `item-${randomUUID()}`,
                createdAt: now,
                quantity: quantity,
                isEquipped: false,
                level: 1,
                stars: 0,
            };

            if (!user.inventory) {
                user.inventory = [];
            }
            if (!user.inventorySlots) {
                user.inventorySlots = { equipment: 30, consumable: 30, material: 30 };
            }

            // 인벤토리에 추가
            const { success, finalItemsToAdd, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, [newItem]);
            if (!success || !updatedInventory) {
                return { error: '인벤토리 공간이 부족합니다.' };
            }

            // 골드/다이아 차감
            if (!user.isAdmin) {
                user.gold -= totalGoldCost;
                user.diamonds -= totalDiamondCost;
                
                // Update Guild Mission Progress for diamonds spent
                if (totalDiamondCost > 0 && user.guildId) {
                    const guilds = await db.getKV<Record<string, any>>('guilds') || {};
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', totalDiamondCost, guilds);
                }
            }

            // 인벤토리 업데이트
            user.inventory = JSON.parse(JSON.stringify(updatedInventory));

            // 구매 기록 업데이트
            if (!user.isAdmin) {
                if (!purchaseRecord || !isSameDayKST(purchaseRecord.date, now)) {
                    user.dailyShopPurchases[itemId] = { quantity: 0, date: now };
                }
                user.dailyShopPurchases[itemId].quantity = todayPurchased + quantity;
                user.dailyShopPurchases[itemId].date = now;
            }

            try {
                await db.updateUser(user);
                const updatedUser = getSelectiveUserUpdate(user, 'BUY_TOWER_ITEM', { includeAll: true });
                broadcast({ type: 'USER_UPDATE', payload: { [user.id]: updatedUser } });

                return {
                    clientResponse: {
                        obtainedItems: finalItemsToAdd,
                        updatedUser
                    }
                };
            } catch (error: any) {
                console.error(`[BUY_TOWER_ITEM] Error updating user ${user.id}:`, error);
                return { error: '구매 처리 중 오류가 발생했습니다.' };
            }
        }
        default:
            return { error: 'Unknown shop action.' };
    }
};