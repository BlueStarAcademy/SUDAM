/**
 * 모든 길드 정보 초기화 스크립트
 * 
 * 실행 방법:
 * npx tsx --tsconfig server/tsconfig.json server/scripts/resetAllGuilds.ts
 * 
 * 주의: 이 스크립트는 모든 길드 관련 데이터를 삭제합니다.
 * - Guild
 * - GuildMember
 * - GuildMessage
 * - GuildMission
 * - GuildShop
 * - GuildDonation
 * - GuildWar
 * - GuildWarMatch
 * - User의 guildId 필드도 초기화
 */

import prisma from '../prismaClient.js';
import * as db from '../db.js';

async function resetAllGuilds() {
    console.log('='.repeat(60));
    console.log('길드 정보 초기화 시작...');
    console.log('='.repeat(60));
    
    try {
        // 트랜잭션으로 모든 길드 관련 데이터 삭제 (타임아웃 30초로 설정)
        await prisma.$transaction(async (tx) => {
            // 1. GuildWarMatch 삭제 (외래키 제약 때문에 먼저 삭제)
            console.log('[1/8] GuildWarMatch 삭제 중...');
            const warMatchesCount = await tx.guildWarMatch.deleteMany({});
            console.log(`  ✓ ${warMatchesCount.count}개의 GuildWarMatch 삭제됨`);
            
            // 2. GuildWar 삭제
            console.log('[2/8] GuildWar 삭제 중...');
            const warsCount = await tx.guildWar.deleteMany({});
            console.log(`  ✓ ${warsCount.count}개의 GuildWar 삭제됨`);
            
            // 3. GuildDonation 삭제
            console.log('[3/8] GuildDonation 삭제 중...');
            const donationsCount = await tx.guildDonation.deleteMany({});
            console.log(`  ✓ ${donationsCount.count}개의 GuildDonation 삭제됨`);
            
            // 4. GuildShop 삭제
            console.log('[4/8] GuildShop 삭제 중...');
            const shopItemsCount = await tx.guildShop.deleteMany({});
            console.log(`  ✓ ${shopItemsCount.count}개의 GuildShop 삭제됨`);
            
            // 5. GuildMission 삭제
            console.log('[5/8] GuildMission 삭제 중...');
            const missionsCount = await tx.guildMission.deleteMany({});
            console.log(`  ✓ ${missionsCount.count}개의 GuildMission 삭제됨`);
            
            // 6. GuildMessage 삭제
            console.log('[6/8] GuildMessage 삭제 중...');
            const messagesCount = await tx.guildMessage.deleteMany({});
            console.log(`  ✓ ${messagesCount.count}개의 GuildMessage 삭제됨`);
            
            // 7. GuildMember 삭제
            console.log('[7/8] GuildMember 삭제 중...');
            const membersCount = await tx.guildMember.deleteMany({});
            console.log(`  ✓ ${membersCount.count}개의 GuildMember 삭제됨`);
            
            // 8. Guild 삭제 (CASCADE로 관련 데이터 자동 삭제되지만 명시적으로 삭제)
            console.log('[8/8] Guild 삭제 중...');
            const guildsCount = await tx.guild.deleteMany({});
            console.log(`  ✓ ${guildsCount.count}개의 Guild 삭제됨`);
            
            // 9. User의 status JSON 필드에서 guildId 제거
            console.log('[9/9] User의 길드 관계 확인 및 초기화 중...');
            const usersWithGuild = await tx.user.findMany({
                where: {
                    OR: [
                        { guild: { isNot: null } },
                        { guildMember: { isNot: null } }
                    ]
                },
                select: { id: true, status: true }
            });
            
            // status JSON 필드에서 guildId 제거
            let usersUpdated = 0;
            for (const user of usersWithGuild) {
                if (user.status && typeof user.status === 'object') {
                    const status = user.status as any;
                    if (status.guildId) {
                        delete status.guildId;
                        await tx.user.update({
                            where: { id: user.id },
                            data: { status: status }
                        });
                        usersUpdated++;
                    }
                }
            }
            console.log(`  ✓ ${usersWithGuild.length}명의 사용자가 길드 관계를 가지고 있었음`);
            console.log(`  ✓ ${usersUpdated}명의 사용자 status에서 guildId 제거됨`);
        }, {
            timeout: 30000, // 30초 타임아웃
        });
        
        // 10. KV store의 guilds 초기화
        console.log('[10/10] KV store의 길드 정보 초기화 중...');
        await db.setKV('guilds', {});
        console.log('  ✓ KV store의 길드 정보 초기화됨');
        
        // 11. 모든 사용자의 길드 정보 완전히 제거
        console.log('[11/11] 모든 사용자의 길드 정보 완전히 제거 중...');
        const allUsers = await prisma.user.findMany({
            select: { 
                id: true, 
                status: true,
                guild: { select: { id: true } },
                guildMember: { select: { id: true } }
            }
        });
        
        let usersUpdated = 0;
        for (const user of allUsers) {
            let needsUpdate = false;
            const status = user.status && typeof user.status === 'object' ? { ...(user.status as any) } : {};
            
            // status JSON에서 guildId 제거
            if (status.guildId) {
                delete status.guildId;
                needsUpdate = true;
            }
            
            // status JSON에서 guildApplications 제거
            if (status.guildApplications) {
                delete status.guildApplications;
                needsUpdate = true;
            }
            
            // Prisma 관계가 있는 경우에만 disconnect/delete 시도
            const hasGuildRelation = user.guild !== null;
            const hasGuildMemberRelation = user.guildMember !== null;
            
            if (needsUpdate || hasGuildRelation || hasGuildMemberRelation) {
                const updateData: any = {};
                
                // status 업데이트가 필요한 경우
                if (needsUpdate) {
                    updateData.status = status;
                }
                
                // Guild 관계가 있는 경우 (이미 Guild는 삭제되었지만 관계 레코드가 남아있을 수 있음)
                // Guild가 삭제되었으므로 disconnect는 불가능, 대신 GuildMember만 삭제
                if (hasGuildMemberRelation) {
                    updateData.guildMember = { delete: true };
                }
                
                await prisma.user.update({
                    where: { id: user.id },
                    data: updateData
                });
                usersUpdated++;
            }
        }
        console.log(`  ✓ ${usersUpdated}명의 사용자에서 모든 길드 정보 제거됨`);
        
        console.log('\n' + '='.repeat(60));
        console.log('✓ 모든 길드 정보가 성공적으로 초기화되었습니다!');
        console.log('='.repeat(60));
        
    } catch (error: any) {
        console.error('\n❌ 오류 발생:', error);
        console.error('스택 트레이스:', error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// 스크립트 실행
resetAllGuilds().catch((error) => {
    console.error('예상치 못한 오류:', error);
    process.exit(1);
});

