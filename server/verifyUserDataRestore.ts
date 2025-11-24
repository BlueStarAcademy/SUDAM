/**
 * 복구된 사용자 데이터 확인 스크립트
 * 
 * 사용법:
 * node --loader tsx server/verifyUserDataRestore.ts 이수호 천재이안
 */

import prisma from './prismaClient.js';
import * as db from './db.js';

const verifyUserData = async (nickname: string) => {
    console.log(`\n[확인 시작] 사용자: ${nickname}`);
    console.log('='.repeat(60));
    
    try {
        // 현재 데이터베이스에서 사용자 찾기
        const user = await prisma.user.findUnique({
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
        
        if (!user) {
            console.error(`[오류] 사용자를 찾을 수 없습니다: ${nickname}`);
            return;
        }
        
        console.log(`[사용자 정보]`);
        console.log(`  ID: ${user.id}`);
        console.log(`  닉네임: ${user.nickname}`);
        console.log(`  레벨: 전략 ${user.strategyLevel}, 놀이 ${user.playfulLevel}`);
        
        // 장비 확인
        console.log(`\n[장비 정보]`);
        if (user.equipment && user.equipment.length > 0) {
            console.log(`  총 ${user.equipment.length}개 슬롯에 장비 착용 중:`);
            for (const eq of user.equipment) {
                const itemName = eq.inventory?.templateId || '알 수 없음';
                console.log(`    - ${eq.slot}: ${itemName} (ID: ${eq.inventoryId || '없음'})`);
            }
        } else {
            console.log(`  착용 중인 장비 없음`);
        }
        
        // 인벤토리 확인
        console.log(`\n[인벤토리 정보]`);
        if (user.inventory && user.inventory.length > 0) {
            console.log(`  총 ${user.inventory.length}개 아이템:`);
            
            // 장비 아이템
            const equipmentItems = user.inventory.filter(inv => inv.slot);
            if (equipmentItems.length > 0) {
                console.log(`  [장비 아이템] ${equipmentItems.length}개:`);
                equipmentItems.forEach(inv => {
                    console.log(`    - ${inv.templateId} (${inv.slot}, 강화+${inv.enhancementLvl}, 별${inv.stars}, ${inv.rarity || 'Normal'})`);
                });
            }
            
            // 재료/소모품
            const materialItems = user.inventory.filter(inv => !inv.slot);
            if (materialItems.length > 0) {
                console.log(`  [재료/소모품] ${materialItems.length}개:`);
                const grouped = materialItems.reduce((acc, inv) => {
                    const key = inv.templateId;
                    acc[key] = (acc[key] || 0) + inv.quantity;
                    return acc;
                }, {} as Record<string, number>);
                Object.entries(grouped).forEach(([name, qty]) => {
                    console.log(`    - ${name}: ${qty}개`);
                });
            }
        } else {
            console.log(`  인벤토리 비어있음`);
        }
        
        // 프리셋 확인
        console.log(`\n[프리셋 정보]`);
        if (user.status && typeof user.status === 'object') {
            const status = user.status as any;
            const presets = status.store?.equipmentPresets;
            if (presets && Array.isArray(presets) && presets.length > 0) {
                console.log(`  총 ${presets.length}개 프리셋:`);
                presets.forEach((preset: any, index: number) => {
                    const equipmentCount = preset.equipment ? Object.keys(preset.equipment).length : 0;
                    console.log(`    ${index + 1}. ${preset.name || `프리셋 ${index + 1}`}: ${equipmentCount}개 장비`);
                });
            } else {
                console.log(`  프리셋 없음`);
            }
        } else {
            console.log(`  프리셋 정보 없음`);
        }
        
        // User 객체로 로드해서 확인
        console.log(`\n[로드된 User 객체 확인]`);
        const loadedUser = await db.getUser(user.id);
        if (loadedUser) {
            const equipmentCount = loadedUser.equipment ? Object.keys(loadedUser.equipment).length : 0;
            const inventoryCount = loadedUser.inventory ? loadedUser.inventory.length : 0;
            const presetCount = loadedUser.equipmentPresets ? loadedUser.equipmentPresets.length : 0;
            
            console.log(`  장비: ${equipmentCount}개 슬롯`);
            console.log(`  인벤토리: ${inventoryCount}개 아이템`);
            console.log(`  프리셋: ${presetCount}개`);
            
            if (equipmentCount === 0 && user.equipment && user.equipment.length > 0) {
                console.warn(`  [경고] UserEquipment 테이블에는 있지만 User 객체에는 로드되지 않았습니다!`);
            }
            if (inventoryCount === 0 && user.inventory && user.inventory.length > 0) {
                console.warn(`  [경고] UserInventory 테이블에는 있지만 User 객체에는 로드되지 않았습니다!`);
            }
        }
        
        console.log(`\n[확인 완료]`);
        console.log('='.repeat(60));
        
    } catch (error: any) {
        console.error(`[오류] 확인 중 오류 발생:`, error);
        console.error(`[스택]`, error.stack);
        throw error;
    }
};

// 메인 실행
const main = async () => {
    const nicknames = process.argv.slice(2);
    
    if (nicknames.length === 0) {
        console.log('사용법: node --loader tsx server/verifyUserDataRestore.ts <닉네임1> <닉네임2> ...');
        console.log('예시: node --loader tsx server/verifyUserDataRestore.ts 이수호 천재이안');
        process.exit(1);
    }
    
    console.log('='.repeat(60));
    console.log('복구된 사용자 데이터 확인');
    console.log('='.repeat(60));
    console.log(`확인 대상: ${nicknames.join(', ')}`);
    console.log('='.repeat(60));
    
    try {
        for (const nickname of nicknames) {
            await verifyUserData(nickname);
        }
        
        console.log('\n[모든 확인 완료]');
    } catch (error: any) {
        console.error('\n[치명적 오류]', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
};

main();

