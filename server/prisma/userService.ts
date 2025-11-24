import prisma from "../prismaClient.js";
import type { Prisma } from "@prisma/client";
import type { User } from "../../types/index.js";
import { deserializeUser, serializeUser, PrismaUserWithStatus } from "./userAdapter.js";

const toBigInt = (value: number | undefined): bigint => {
  if (typeof value === "bigint") return value;
  if (value == null || Number.isNaN(value)) return 0n;
  return BigInt(Math.trunc(value));
};

const buildPersistentFields = (user: User) => {
  const status = serializeUser(user);
  // Convert status to Prisma-compatible JSON type
  const statusJson = JSON.parse(JSON.stringify(status)) as Prisma.JsonValue;

  return {
    nickname: user.nickname,
    username: user.username,
    isAdmin: user.isAdmin ?? false,
    strategyLevel: user.strategyLevel,
    strategyXp: user.strategyXp,
    playfulLevel: user.playfulLevel,
    playfulXp: user.playfulXp,
    actionPointCurr: user.actionPoints?.current ?? 0,
    actionPointMax: user.actionPoints?.max ?? 0,
    gold: toBigInt(user.gold),
    diamonds: toBigInt(user.diamonds),
    league: user.league ?? null,
    tournamentScore: user.tournamentScore ?? 0,
    towerFloor: user.towerFloor ?? 0,
    lastTowerClearTime: user.lastTowerClearTime != null ? BigInt(user.lastTowerClearTime) : null,
    monthlyTowerFloor: user.monthlyTowerFloor ?? 0,
    status: statusJson
  };
};

const mapUser = (row: PrismaUserWithStatus): User => deserializeUser(row);

// equipment와 inventory를 별도로 로드하는 헬퍼 함수
const loadUserWithEquipmentAndInventory = async (query: () => Promise<any>) => {
  try {
    // 먼저 equipment와 inventory 포함해서 시도
    return await query();
  } catch (error: any) {
    // 실패 시 equipment/inventory 없이 재시도
    if (error.message?.includes('equipment') || error.message?.includes('inventory') || error.message?.includes('Can\'t reach database')) {
      // 원래 쿼리를 equipment/inventory 없이 재실행
      const baseQuery = query.toString();
      if (baseQuery.includes('findMany')) {
        return await prisma.user.findMany({
          include: { guildMember: true }
        });
      } else if (baseQuery.includes('findUnique')) {
        // findUnique의 경우 where 조건을 추출하기 어려우므로, 원래 쿼리를 수정
        return null;
      }
    }
    throw error;
  }
};

export async function listUsers(): Promise<User[]> {
  try {
    const rows = await prisma.user.findMany({
      include: { guildMember: true, equipment: true, inventory: true }
    });
    return rows.map(mapUser);
  } catch (error: any) {
    // equipment/inventory 로드 실패 시 없이 재시도
    const rows = await prisma.user.findMany({
      include: { guildMember: true }
    });
    return rows.map(mapUser);
  }
}

export async function getUserById(id: string): Promise<User | null> {
  try {
    const row = await prisma.user.findUnique({ 
      where: { id },
      include: { guildMember: true, equipment: true, inventory: true }
    });
    return row ? mapUser(row) : null;
  } catch (error: any) {
    // equipment/inventory 로드 실패 시 없이 재시도
    const row = await prisma.user.findUnique({ 
      where: { id },
      include: { guildMember: true }
    });
    return row ? mapUser(row) : null;
  }
}

export async function getUserByNickname(nickname: string): Promise<User | null> {
  try {
    const row = await prisma.user.findUnique({ 
      where: { nickname },
      include: { guildMember: true, equipment: true, inventory: true }
    });
    return row ? mapUser(row) : null;
  } catch (error: any) {
    // equipment/inventory 로드 실패 시 없이 재시도
    const row = await prisma.user.findUnique({ 
      where: { nickname },
      include: { guildMember: true }
    });
    return row ? mapUser(row) : null;
  }
}

export async function createUser(user: User): Promise<User> {
  const data = buildPersistentFields(user);
  const created = await prisma.user.create({
    data: {
      id: user.id,
      ...data
    }
  });
  return mapUser(created);
}

export async function updateUser(user: User): Promise<User> {
  const data = buildPersistentFields(user);
  
  // equipment와 inventory를 UserEquipment와 UserInventory 테이블에 동기화
  await syncEquipmentAndInventory(user);
  
  const updated = await prisma.user.update({
    where: { id: user.id },
    data
  });
  return mapUser(updated);
}

// equipment와 inventory를 테이블에 동기화하는 함수
async function syncEquipmentAndInventory(user: User): Promise<void> {
  try {
    // 1. Inventory 동기화
    if (user.inventory && Array.isArray(user.inventory)) {
      // 기존 인벤토리 아이템 ID 수집
      const existingItems = await prisma.userInventory.findMany({
        where: { userId: user.id },
        select: { id: true }
      });
      const existingItemIds = new Set(existingItems.map(item => item.id));
      
      // 현재 인벤토리 아이템들을 upsert
      for (const item of user.inventory) {
        if (!item.id) continue; // ID가 없으면 스킵
        
        const inventoryData = {
          id: item.id,
          userId: user.id,
          templateId: item.name || item.templateId || '',
          quantity: item.quantity || 1,
          slot: item.slot || null,
          enhancementLvl: (item as any).enhancementLvl ?? item.level ?? 0,
          stars: item.stars || 0,
          rarity: (item as any).rarity || item.grade || null,
          metadata: (item as any).metadata || { 
            options: item.options || [],
            enhancementFails: (item as any).enhancementFails || 0,
            isDivineMythic: (item as any).isDivineMythic || false
          },
          isEquipped: item.isEquipped || false
        };
        
        await prisma.userInventory.upsert({
          where: { id: item.id },
          create: inventoryData,
          update: {
            templateId: inventoryData.templateId,
            quantity: inventoryData.quantity,
            slot: inventoryData.slot,
            enhancementLvl: inventoryData.enhancementLvl,
            stars: inventoryData.stars,
            rarity: inventoryData.rarity,
            metadata: inventoryData.metadata,
            isEquipped: inventoryData.isEquipped
          }
        });
        
        existingItemIds.delete(item.id);
      }
      
      // 더 이상 존재하지 않는 아이템 삭제
      if (existingItemIds.size > 0) {
        await prisma.userInventory.deleteMany({
          where: {
            userId: user.id,
            id: { in: Array.from(existingItemIds) }
          }
        });
      }
    }
    
    // 2. Equipment 동기화
    if (user.equipment && typeof user.equipment === 'object') {
      // 기존 장비 슬롯 수집
      const existingEquipment = await prisma.userEquipment.findMany({
        where: { userId: user.id },
        select: { slot: true }
      });
      const existingSlots = new Set(existingEquipment.map(eq => eq.slot));
      
      // 현재 장비를 슬롯별로 upsert
      for (const [slot, itemId] of Object.entries(user.equipment)) {
        if (!itemId) {
          // itemId가 없으면 장비 해제
          await prisma.userEquipment.deleteMany({
            where: {
              userId: user.id,
              slot: slot
            }
          });
          continue;
        }
        
        // itemId로 inventory 아이템 찾기
        const inventoryItem = await prisma.userInventory.findFirst({
          where: {
            userId: user.id,
            id: itemId
          }
        });
        
        if (inventoryItem) {
          await prisma.userEquipment.upsert({
            where: {
              userId_slot: {
                userId: user.id,
                slot: slot
              }
            },
            create: {
              userId: user.id,
              slot: slot,
              inventoryId: itemId
            },
            update: {
              inventoryId: itemId
            }
          });
        } else {
          // inventory에 없는 경우에도 장비 슬롯은 유지 (데이터 손실 방지)
          await prisma.userEquipment.upsert({
            where: {
              userId_slot: {
                userId: user.id,
                slot: slot
              }
            },
            create: {
              userId: user.id,
              slot: slot,
              inventoryId: null // inventory에 없어도 슬롯은 유지
            },
            update: {
              inventoryId: null
            }
          });
        }
        
        existingSlots.delete(slot);
      }
      
      // 더 이상 사용되지 않는 슬롯 삭제
      if (existingSlots.size > 0) {
        await prisma.userEquipment.deleteMany({
          where: {
            userId: user.id,
            slot: { in: Array.from(existingSlots) }
          }
        });
      }
    }
  } catch (error: any) {
    // 동기화 실패 시 로그만 남기고 계속 진행 (데이터 손실 방지)
    console.error(`[userService] Failed to sync equipment/inventory for user ${user.id}:`, error.message);
    // 에러를 throw하지 않아서 updateUser가 계속 진행되도록 함
  }
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({ where: { id } });
}

