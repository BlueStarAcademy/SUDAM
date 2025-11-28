/**
 * Supabase 백업에서 특정 유저의 장비 및 인벤토리 데이터 복구 스크립트
 * 
 * 사용법:
 * 1. Supabase 대시보드에서 백업 데이터베이스 URL 가져오기
 * 2. BACKUP_DATABASE_URL 환경변수 설정 또는 스크립트 내에서 수정
 * 3. node --loader tsx server/restoreUserFromSupabaseBackup.ts 이수호 천재이안
 */

import prisma from './prismaClient.js';
import { PrismaClient } from '../generated/prisma/client.ts';
import * as db from './db.js';

// 백업 데이터베이스 URL (Supabase 백업에서 가져온 URL)
// 예: postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres?schema=public
const BACKUP_DATABASE_URL = process.env.BACKUP_DATABASE_URL || '';

// 백업 Prisma 클라이언트 생성
let backupPrisma: PrismaClient | null = null;

const createBackupPrismaClient = () => {
    if (!BACKUP_DATABASE_URL) {
        throw new Error('BACKUP_DATABASE_URL 환경변수가 설정되지 않았습니다.');
    }
    
    return new PrismaClient({
        datasources: {
            db: {
                url: BACKUP_DATABASE_URL
            }
        }
    });
};

interface BackupUserData {
    id: string;
    nickname: string;
    status: any;
    equipment?: Array<{ slot: string; inventoryId: string | null }>;
    inventory?: Array<{
        id: string;
        templateId: string;
        quantity: number;
        slot: string | null;
        enhancementLvl: number;
        stars: number;
        rarity: string | null;
        metadata: any;
        isEquipped: boolean;
    }>;
}

const restoreUserFromBackup = async (nickname: string) => {
    console.log(`\n[복구 시작] 사용자: ${nickname}`);
    console.log('='.repeat(60));
    
    try {
        // 백업 데이터베이스 연결
        if (!backupPrisma) {
            backupPrisma = createBackupPrismaClient();
        }
        
        // 현재 데이터베이스에서 사용자 찾기
        const currentUser = await prisma.user.findUnique({
            where: { nickname },
            include: {
                equipment: true,
                inventory: true
            }
        });
        
        if (!currentUser) {
            console.error(`[오류] 현재 데이터베이스에서 사용자를 찾을 수 없습니다: ${nickname}`);
            return;
        }
        
        console.log(`[현재 사용자] ID: ${currentUser.id}, 닉네임: ${currentUser.nickname}`);
        console.log(`[현재 장비] ${currentUser.equipment?.length || 0}개 슬롯`);
        console.log(`[현재 인벤토리] ${currentUser.inventory?.length || 0}개 아이템`);
        
        // 백업 데이터베이스에서 사용자 찾기
        const backupUser = await backupPrisma.user.findUnique({
            where: { nickname },
            include: {
                equipment: {
                    include: {
                        inventory: true
                    }
                },
                inventory: true
            }
        });
        
        if (!backupUser) {
            console.error(`[오류] 백업 데이터베이스에서 사용자를 찾을 수 없습니다: ${nickname}`);
            console.log(`[팁] 백업 데이터베이스 URL을 확인하거나 다른 백업 날짜를 시도해보세요.`);
            return;
        }
        
        console.log(`\n[백업 데이터 발견]`);
        console.log(`[백업 장비] ${backupUser.equipment?.length || 0}개 슬롯`);
        console.log(`[백업 인벤토리] ${backupUser.inventory?.length || 0}개 아이템`);
        
        // 백업 데이터 확인
        if ((!backupUser.equipment || backupUser.equipment.length === 0) && 
            (!backupUser.inventory || backupUser.inventory.length === 0)) {
            console.warn(`[경고] 백업 데이터에 장비나 인벤토리가 없습니다.`);
            return;
        }
        
        // 복구 시작
        console.log(`\n[복구 진행 중...]`);
        
        // 1. 기존 장비 삭제
        if (currentUser.equipment && currentUser.equipment.length > 0) {
            await prisma.userEquipment.deleteMany({
                where: { userId: currentUser.id }
            });
            console.log(`[완료] 기존 장비 삭제: ${currentUser.equipment.length}개`);
        }
        
        // 2. 기존 인벤토리 삭제
        if (currentUser.inventory && currentUser.inventory.length > 0) {
            await prisma.userInventory.deleteMany({
                where: { userId: currentUser.id }
            });
            console.log(`[완료] 기존 인벤토리 삭제: ${currentUser.inventory.length}개`);
        }
        
        // 3. 백업 인벤토리 복구
        if (backupUser.inventory && backupUser.inventory.length > 0) {
            const inventoryData = backupUser.inventory.map((inv: any) => ({
                id: inv.id,
                userId: currentUser.id,
                templateId: inv.templateId,
                quantity: inv.quantity,
                slot: inv.slot,
                enhancementLvl: inv.enhancementLvl,
                stars: inv.stars,
                rarity: inv.rarity,
                metadata: inv.metadata,
                isEquipped: inv.isEquipped
            }));
            
            await prisma.userInventory.createMany({
                data: inventoryData
            });
            console.log(`[완료] 인벤토리 복구: ${inventoryData.length}개 아이템`);
        }
        
        // 4. 백업 장비 복구
        if (backupUser.equipment && backupUser.equipment.length > 0) {
            for (const eq of backupUser.equipment) {
                // inventoryId가 존재하는지 확인
                if (eq.inventoryId) {
                    const inventoryExists = await prisma.userInventory.findUnique({
                        where: { id: eq.inventoryId }
                    });
                    
                    if (!inventoryExists) {
                        console.warn(`[경고] 장비 슬롯 ${eq.slot}의 인벤토리 아이템 ${eq.inventoryId}를 찾을 수 없습니다. 건너뜁니다.`);
                        continue;
                    }
                }
                
                await prisma.userEquipment.create({
                    data: {
                        userId: currentUser.id,
                        slot: eq.slot,
                        inventoryId: eq.inventoryId
                    }
                });
            }
            console.log(`[완료] 장비 복구: ${backupUser.equipment.length}개 슬롯`);
        }
        
        // 5. 프리셋 복구 (status.store.equipmentPresets에서)
        if (backupUser.status && typeof backupUser.status === 'object') {
            const backupStatus = backupUser.status as any;
            const backupPresets = backupStatus.store?.equipmentPresets;
            
            if (backupPresets && Array.isArray(backupPresets) && backupPresets.length > 0) {
                // 현재 사용자의 status 업데이트
                const currentStatus = (currentUser.status as any) || {};
                currentStatus.store = currentStatus.store || {};
                currentStatus.store.equipmentPresets = backupPresets;
                
                await prisma.user.update({
                    where: { id: currentUser.id },
                    data: {
                        status: currentStatus
                    }
                });
                console.log(`[완료] 프리셋 복구: ${backupPresets.length}개`);
            }
        }
        
        console.log(`\n[복구 완료]`);
        console.log('='.repeat(60));
        
        // 복구 결과 확인
        const restoredUser = await prisma.user.findUnique({
            where: { id: currentUser.id },
            include: {
                equipment: true,
                inventory: true
            }
        });
        
        if (restoredUser) {
            console.log(`[최종 확인]`);
            console.log(`[장비] ${restoredUser.equipment?.length || 0}개 슬롯`);
            console.log(`[인벤토리] ${restoredUser.inventory?.length || 0}개 아이템`);
        }
        
    } catch (error: any) {
        console.error(`[오류] 복구 중 오류 발생:`, error);
        console.error(`[스택]`, error.stack);
        throw error;
    }
};

// 메인 실행
const main = async () => {
    const nicknames = process.argv.slice(2);
    
    if (nicknames.length === 0) {
        console.log('사용법: node --loader tsx server/restoreUserFromSupabaseBackup.ts <닉네임1> <닉네임2> ...');
        console.log('예시: node --loader tsx server/restoreUserFromSupabaseBackup.ts 이수호 천재이안');
        console.log('\n환경변수 설정:');
        console.log('BACKUP_DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres?schema=public');
        process.exit(1);
    }
    
    if (!BACKUP_DATABASE_URL) {
        console.error('\n[오류] BACKUP_DATABASE_URL 환경변수가 설정되지 않았습니다.');
        console.log('\nSupabase 백업 데이터베이스 URL 설정 방법:');
        console.log('1. Supabase 대시보드 > Settings > Database > Connection string');
        console.log('2. 백업 데이터베이스의 연결 문자열 복사');
        console.log('3. 환경변수 설정: export BACKUP_DATABASE_URL="postgresql://..."');
        console.log('   또는 스크립트 내 BACKUP_DATABASE_URL 변수 직접 수정');
        process.exit(1);
    }
    
    console.log('='.repeat(60));
    console.log('Supabase 백업에서 사용자 데이터 복구');
    console.log('='.repeat(60));
    console.log(`백업 DB: ${BACKUP_DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
    console.log(`복구 대상: ${nicknames.join(', ')}`);
    console.log('='.repeat(60));
    
    try {
        for (const nickname of nicknames) {
            await restoreUserFromBackup(nickname);
        }
        
        console.log('\n[모든 복구 완료]');
    } catch (error: any) {
        console.error('\n[치명적 오류]', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        if (backupPrisma) {
            await backupPrisma.$disconnect();
        }
    }
};

main();

