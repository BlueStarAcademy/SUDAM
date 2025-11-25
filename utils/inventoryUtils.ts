import { randomUUID } from 'crypto';
import { InventoryItem, InventoryItemType } from '../types/index.js';
import { ItemGrade } from '../types/enums.js';
import { CONSUMABLE_ITEMS, MATERIAL_ITEMS } from '../constants';

const CONSUMABLE_TEMPLATE_MAP: Record<string, Omit<InventoryItem, 'id'|'createdAt'|'isEquipped'|'level'|'stars'|'options'|'enhancementFails'>> = CONSUMABLE_ITEMS.reduce((map, item) => {
    map[item.name] = item;
    return map;
}, {} as Record<string, Omit<InventoryItem, 'id'|'createdAt'|'isEquipped'|'level'|'stars'|'options'|'enhancementFails'>>);

const MATERIAL_TEMPLATE_MAP: Record<string, Omit<InventoryItem, 'id'|'createdAt'|'isEquipped'|'level'|'stars'|'options'|'enhancementFails'>> = { ...MATERIAL_ITEMS };

export const getItemTemplateByName = (itemName: string) => {
    const trimmedName = itemName?.trim();
    if (!trimmedName) return null;
    
    // 먼저 정확한 이름으로 찾기
    let template = CONSUMABLE_TEMPLATE_MAP[trimmedName] || MATERIAL_TEMPLATE_MAP[trimmedName];
    if (template) return template;
    
    // 이름 불일치 처리: '골드꾸러미1' <-> '골드 꾸러미1'
    // '골드꾸러미' -> '골드 꾸러미' 변환
    if (trimmedName.includes('골드꾸러미')) {
        const withSpace = trimmedName.replace('골드꾸러미', '골드 꾸러미');
        template = CONSUMABLE_TEMPLATE_MAP[withSpace] || MATERIAL_TEMPLATE_MAP[withSpace];
        if (template) return template;
    }
    
    // 반대 방향: '골드 꾸러미1' -> '골드꾸러미1'
    if (trimmedName.includes('골드 꾸러미')) {
        const withoutSpace = trimmedName.replace('골드 꾸러미', '골드꾸러미');
        template = CONSUMABLE_TEMPLATE_MAP[withoutSpace] || MATERIAL_TEMPLATE_MAP[withoutSpace];
        if (template) return template;
    }
    
    return null;
};

export const addItemsToInventory = (currentInventory: InventoryItem[], inventorySlots: { equipment: number; consumable: number; material: number; }, itemsToAdd: InventoryItem[]): { success: boolean, finalItemsToAdd: InventoryItem[], updatedInventory: InventoryItem[] } => {
    const tempInventory = JSON.parse(JSON.stringify(currentInventory));
    const finalItemsToAdd: InventoryItem[] = [];

    const itemsByType = {
        equipment: itemsToAdd.filter(item => item.type === 'equipment'),
        consumable: itemsToAdd.filter(item => item.type === 'consumable'),
        material: itemsToAdd.filter(item => item.type === 'material'),
    };

    // First, check space for non-stackable items (equipment)
    const currentEquipmentCount = tempInventory.filter((item: InventoryItem) => item.type === 'equipment').length;
    if (itemsByType.equipment.length > (inventorySlots.equipment - currentEquipmentCount)) {
        return { success: false, finalItemsToAdd: [], updatedInventory: currentInventory };
    }
    finalItemsToAdd.push(...itemsByType.equipment);

    // Then, check space and process stackable items (consumables and materials)
    for (const category of ['consumable', 'material'] as const) {
        const items = itemsByType[category];
        if (items.length === 0) continue;

        const currentCategoryItems = tempInventory.filter((item: InventoryItem) => item.type === category);
        let currentCategorySlotsUsed = currentCategoryItems.length;

        const stackableToAdd: Record<string, number> = {};
        for(const item of items) {
            stackableToAdd[item.name] = (stackableToAdd[item.name] || 0) + (item.quantity || 1);
        }

        let neededNewSlots = 0;
        for (const name in stackableToAdd) {
            let quantityToPlace = stackableToAdd[name];
            
            // Try to stack into existing items first
            for (const existingItem of currentCategoryItems) {
                if (quantityToPlace <= 0) break;
                if (existingItem.name === name && (existingItem.quantity || 0) < 100) {
                    const space = 100 - (existingItem.quantity || 0);
                    const toAdd = Math.min(quantityToPlace, space);
                    // Simulate stacking in temp inventory
                    existingItem.quantity = (existingItem.quantity || 0) + toAdd;
                    quantityToPlace -= toAdd;
                }
            }
            // If still quantity left, new slots are needed
            if (quantityToPlace > 0) {
                neededNewSlots += Math.ceil(quantityToPlace / 100);
            }
        }

        if ((currentCategorySlotsUsed + neededNewSlots) > inventorySlots[category]) {
            return { success: false, finalItemsToAdd: [], updatedInventory: currentInventory };
        }

        // If successful, add remaining items that couldn't be stacked to finalItemsToAdd
        // We already stacked into existing items in tempInventory, so we only need to add the remaining quantities
        for (const name in stackableToAdd) {
            let quantityLeft = stackableToAdd[name];
            
            // Subtract what was already stacked into existing items
            for (const existingItem of currentCategoryItems) {
                if (quantityLeft <= 0) break;
                if (existingItem.name === name) {
                    // Calculate how much was added to this item
                    const originalQuantity = (currentInventory.find(i => i.id === existingItem.id)?.quantity || 0);
                    const addedQuantity = (existingItem.quantity || 0) - originalQuantity;
                    quantityLeft -= addedQuantity;
                }
            }
            
            // Any remaining quantity needs new slots
            if (quantityLeft > 0) {
                // Try to stack into items already in finalItemsToAdd (from this batch)
                for (const finalItem of finalItemsToAdd) {
                    if (quantityLeft <= 0) break;
                    if (finalItem.name === name && (finalItem.quantity || 0) < 100) {
                        const space = 100 - (finalItem.quantity || 0);
                        const toAdd = Math.min(quantityLeft, space);
                        finalItem.quantity = (finalItem.quantity || 0) + toAdd;
                        quantityLeft -= toAdd;
                    }
                }
                
                // If still quantity left, add as new items
                while (quantityLeft > 0) {
                    const toAdd = Math.min(quantityLeft, 100);
                    const template = getItemTemplateByName(name);
                    if (template) {
                        finalItemsToAdd.push({ ...template, id: `item-${randomUUID()}`, quantity: toAdd, createdAt: Date.now(), isEquipped: false, stars: 0, level: 1 });
                    } else {
                        console.error(`[addItemsToInventory] Unable to find template for stackable item '${name}'.`);
                        finalItemsToAdd.push({
                            name,
                            description: '보상 아이템',
                            type: 'consumable',
                            slot: null,
                            image: '/images/icon/Reward.png',
                            grade: 'normal',
                            id: `item-${randomUUID()}`,
                            quantity: toAdd,
                            createdAt: Date.now(),
                            isEquipped: false,
                            stars: 0,
                            level: 1,
                        } as InventoryItem);
                    }
                    quantityLeft -= toAdd;
                }
            }
        }
    }

    // Create updated inventory
    // tempInventory already has stacking applied to existing items (quantities increased)
    // finalItemsToAdd contains only new items that couldn't be stacked
    // So we need to combine tempInventory (with updated quantities) and finalItemsToAdd
    // But we need to be careful: tempInventory contains ALL existing items, and finalItemsToAdd contains only new items
    
    // The updated inventory should be:
    // 1. All items from tempInventory (existing items with updated quantities from stacking)
    // 2. Plus all items from finalItemsToAdd (new items that need new slots)
    const updatedInventory: InventoryItem[] = [];
    
    // Add all items from tempInventory (these include the stacked items with updated quantities)
    updatedInventory.push(...tempInventory);
    
    // Add new items from finalItemsToAdd (these are items that couldn't be stacked and need new slots)
    updatedInventory.push(...finalItemsToAdd);

    return { success: true, finalItemsToAdd, updatedInventory };
};

export const createItemInstancesFromReward = (itemRefs: (InventoryItem | { itemId: string; quantity: number })[]): InventoryItem[] => {
    const createdItems: InventoryItem[] = [];
    for (const itemRef of itemRefs) {
        if ('id' in itemRef) { // It's a full InventoryItem, just pass it through
            createdItems.push(itemRef);
            continue;
        }

        const { itemId, quantity } = itemRef;
        
        // This logic finds the item template and creates an instance, which is correct for granting a reward item.
        // It avoids the previous issue of "opening" the item via shop logic.
        const template = getItemTemplateByName(itemId);

        if (template) {
            const newItem: InventoryItem = {
                ...template,
                id: `item-${randomUUID()}`,
                createdAt: Date.now(),
                quantity: quantity,
                isEquipped: false, 
                level: 1,
                stars: 0,
                options: undefined,
            };
            createdItems.push(newItem);
        } else {
            console.error(`[Reward] Could not find consumable/material item template for: ${itemId}`);
            createdItems.push({
                name: itemId,
                description: '보상 아이템',
                type: 'consumable',
                slot: null,
                image: '/images/icon/Reward.png',
                grade: ItemGrade.Normal,
                id: `item-${randomUUID()}`,
                createdAt: Date.now(),
                quantity,
                isEquipped: false,
                stars: 0,
                level: 1,
                options: undefined,
            });
        }
    }
    return createdItems;
};