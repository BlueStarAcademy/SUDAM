/**
 * Supabase에서 Railway Postgres로 데이터 마이그레이션 스크립트
 * 
 * 사용법:
 * 1. 환경 변수 설정:
 *    export SUPABASE_DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
 *    export RAILWAY_DATABASE_URL="postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway"
 * 
 * 2. 스크립트 실행:
 *    npm run migrate:to-railway
 *    또는
 *    npx tsx scripts/migrate-to-railway.ts
 */

import { PrismaClient } from '../generated/prisma/client.js';
import * as readline from 'readline';

let SUPABASE_DB_URL = process.env.SUPABASE_DATABASE_URL || '';
const RAILWAY_DB_URL = process.env.RAILWAY_DATABASE_URL || '';

if (!SUPABASE_DB_URL) {
    console.error('[오류] SUPABASE_DATABASE_URL 환경변수가 설정되지 않았습니다.');
    console.log('\n설정 방법:');
    console.log('export SUPABASE_DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"');
    process.exit(1);
}

// Connection Pooling URL에 Prisma 호환 파라미터 추가
if (SUPABASE_DB_URL.includes('.pooler.') || SUPABASE_DB_URL.includes(':6543/')) {
    console.log('[정보] Connection Pooling URL에 Prisma 호환 파라미터를 추가합니다.');
    // 이미 쿼리 파라미터가 있는지 확인
    const hasParams = SUPABASE_DB_URL.includes('?');
    if (hasParams) {
        SUPABASE_DB_URL += '&pgbouncer=true&connection_limit=1';
    } else {
        SUPABASE_DB_URL += '?pgbouncer=true&connection_limit=1';
    }
    console.log(`[정보] 수정된 URL: ${SUPABASE_DB_URL.replace(/:[^:@]+@/, ':****@')}`);
}

if (!RAILWAY_DB_URL) {
    console.error('[오류] RAILWAY_DATABASE_URL 환경변수가 설정되지 않았습니다.');
    console.log('\n설정 방법:');
    console.log('export RAILWAY_DATABASE_URL="postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway"');
    process.exit(1);
}

// 사용자 확인을 위한 readline 인터페이스
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
};

async function migrateData() {
    console.log('========================================');
    console.log('Supabase → Railway 데이터 마이그레이션');
    console.log('========================================\n');

    // 연결 정보 확인 (비밀번호 마스킹)
    const supabaseMasked = SUPABASE_DB_URL.replace(/:[^:@]+@/, ':****@');
    const railwayMasked = RAILWAY_DB_URL.replace(/:[^:@]+@/, ':****@');
    
    console.log('소스 (Supabase):', supabaseMasked);
    console.log('대상 (Railway):', railwayMasked);
    console.log('');

    // 사용자 확인
    const confirm = await askQuestion('마이그레이션을 시작하시겠습니까? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
        console.log('마이그레이션이 취소되었습니다.');
        rl.close();
        process.exit(0);
    }

    // Prisma 클라이언트 생성 (연결 풀링 문제 방지를 위해 각각 별도 인스턴스 생성)
    const supabaseClient = new PrismaClient({
        datasources: {
            db: { url: SUPABASE_DB_URL }
        },
        log: ['error', 'warn']
    });

    const railwayClient = new PrismaClient({
        datasources: {
            db: { url: RAILWAY_DB_URL }
        },
        log: ['error', 'warn']
    });

    try {
        console.log('\n[1/7] 데이터베이스 연결 확인...');
        await supabaseClient.$connect();
        await railwayClient.$connect();
        console.log('✓ 연결 성공\n');

        console.log('[2/7] Supabase 데이터 개수 확인...');
        const supabaseCounts = {
            users: await supabaseClient.user.count(),
            inventories: await supabaseClient.userInventory.count(),
            equipment: await supabaseClient.userEquipment.count(),
            mails: await supabaseClient.userMail.count(),
            quests: await supabaseClient.userQuest.count(),
            missions: await supabaseClient.userMission.count(),
            credentials: await supabaseClient.userCredential.count(),
            games: await supabaseClient.liveGame.count(),
            guilds: await supabaseClient.guild.count(),
        };
        console.log('Supabase 데이터:');
        console.log(`  - 사용자: ${supabaseCounts.users}명`);
        console.log(`  - 인벤토리: ${supabaseCounts.inventories}개`);
        console.log(`  - 장비: ${supabaseCounts.equipment}개`);
        console.log(`  - 메일: ${supabaseCounts.mails}개`);
        console.log(`  - 퀘스트: ${supabaseCounts.quests}개`);
        console.log(`  - 미션: ${supabaseCounts.missions}개`);
        console.log(`  - 인증정보: ${supabaseCounts.credentials}개`);
        console.log(`  - 게임: ${supabaseCounts.games}개`);
        console.log(`  - 길드: ${supabaseCounts.guilds}개`);
        console.log('');

        // Railway 데이터 확인
        const railwayCounts = {
            users: await railwayClient.user.count(),
            inventories: await railwayClient.userInventory.count(),
        };
        
        if (railwayCounts.users > 0 || railwayCounts.inventories > 0) {
            console.warn('⚠️  Railway에 이미 데이터가 있습니다!');
            const autoOverwrite = process.env.AUTO_OVERWRITE === 'true';
            let overwrite = 'no';
            if (autoOverwrite) {
                overwrite = 'yes';
                console.log('AUTO_OVERWRITE=true로 설정되어 있어 자동으로 덮어쓰기를 진행합니다.');
            } else {
                overwrite = await askQuestion('기존 데이터를 덮어쓰시겠습니까? (yes/no): ');
            }
            if (overwrite.toLowerCase() !== 'yes') {
                console.log('마이그레이션이 취소되었습니다.');
                rl.close();
                process.exit(0);
            }
            console.log('기존 데이터를 삭제합니다...');
            // 외래 키 순서를 고려하여 역순으로 삭제
            // CASCADE로 인해 자동 삭제되지만, 명시적으로 삭제 순서 보장
            await railwayClient.inventoryHistory.deleteMany({});
            await railwayClient.userEquipment.deleteMany({});
            await railwayClient.userInventory.deleteMany({});
            await railwayClient.userMail.deleteMany({});
            await railwayClient.userQuest.deleteMany({});
            await railwayClient.userMission.deleteMany({});
            await railwayClient.emailVerificationToken.deleteMany({});
            await railwayClient.userCredential.deleteMany({});
            await railwayClient.guildWarMatch.deleteMany({});
            await railwayClient.guildWar.deleteMany({});
            await railwayClient.guildDonation.deleteMany({});
            await railwayClient.guildShop.deleteMany({});
            await railwayClient.guildMission.deleteMany({});
            await railwayClient.guildMessage.deleteMany({});
            await railwayClient.guildMember.deleteMany({});
            await railwayClient.guild.deleteMany({});
            await railwayClient.liveGame.deleteMany({});
            // 사용자는 마지막에 삭제 (모든 외래 키 참조가 제거된 후)
            await railwayClient.user.deleteMany({});
            
            // 삭제 확인
            const remainingUsers = await railwayClient.user.count();
            if (remainingUsers > 0) {
                console.warn(`⚠️  경고: ${remainingUsers}명의 사용자가 여전히 남아있습니다. 강제 삭제를 시도합니다.`);
                // 모든 관련 데이터를 다시 삭제
                await railwayClient.user.deleteMany({});
            }
            console.log('✓ 기존 데이터 삭제 완료\n');
        }

        console.log('[3/7] 사용자 데이터 마이그레이션...');
        const users = await supabaseClient.user.findMany({
            include: {
                credential: true,
            }
        });
        console.log(`  ${users.length}명의 사용자 데이터 복사 중...`);
        
        // 사용자별로 순차 삽입 (외래 키 제약 조건 보장)
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            
            // 1. 사용자 데이터 삽입 (nickname 충돌 방지를 위해 기존 사용자 확인)
            try {
                await railwayClient.user.upsert({
                    where: { id: user.id },
                    create: {
                        id: user.id,
                        nickname: user.nickname,
                        username: user.username,
                        isAdmin: user.isAdmin,
                        email: user.email,
                        strategyLevel: user.strategyLevel,
                        strategyXp: user.strategyXp,
                        playfulLevel: user.playfulLevel,
                        playfulXp: user.playfulXp,
                        actionPointCurr: user.actionPointCurr,
                        actionPointMax: user.actionPointMax,
                        gold: user.gold,
                        diamonds: user.diamonds,
                        league: user.league,
                        tournamentScore: user.tournamentScore,
                        towerFloor: user.towerFloor,
                        lastTowerClearTime: user.lastTowerClearTime,
                        monthlyTowerFloor: user.monthlyTowerFloor,
                        status: user.status,
                        createdAt: user.createdAt,
                        updatedAt: user.updatedAt,
                        version: user.version,
                    },
                    update: {
                        nickname: user.nickname,
                        username: user.username,
                        isAdmin: user.isAdmin,
                        email: user.email,
                        strategyLevel: user.strategyLevel,
                        strategyXp: user.strategyXp,
                        playfulLevel: user.playfulLevel,
                        playfulXp: user.playfulXp,
                        actionPointCurr: user.actionPointCurr,
                        actionPointMax: user.actionPointMax,
                        gold: user.gold,
                        diamonds: user.diamonds,
                        league: user.league,
                        tournamentScore: user.tournamentScore,
                        towerFloor: user.towerFloor,
                        lastTowerClearTime: user.lastTowerClearTime,
                        monthlyTowerFloor: user.monthlyTowerFloor,
                        status: user.status,
                        updatedAt: user.updatedAt,
                        version: user.version,
                    },
                });
            } catch (error: any) {
                // nickname 충돌 시 기존 사용자 삭제 후 재시도
                if (error.code === 'P2002' && error.meta?.target?.includes('nickname')) {
                    console.warn(`[경고] nickname 충돌: ${user.nickname}, 기존 사용자 삭제 후 재시도...`);
                    await railwayClient.user.deleteMany({ where: { nickname: user.nickname } });
                    await railwayClient.user.create({
                        data: {
                            id: user.id,
                            nickname: user.nickname,
                            username: user.username,
                            isAdmin: user.isAdmin,
                            email: user.email,
                            strategyLevel: user.strategyLevel,
                            strategyXp: user.strategyXp,
                            playfulLevel: user.playfulLevel,
                            playfulXp: user.playfulXp,
                            actionPointCurr: user.actionPointCurr,
                            actionPointMax: user.actionPointMax,
                            gold: user.gold,
                            diamonds: user.diamonds,
                            league: user.league,
                            tournamentScore: user.tournamentScore,
                            towerFloor: user.towerFloor,
                            lastTowerClearTime: user.lastTowerClearTime,
                            monthlyTowerFloor: user.monthlyTowerFloor,
                            status: user.status,
                            createdAt: user.createdAt,
                            updatedAt: user.updatedAt,
                            version: user.version,
                        },
                    });
                } else {
                    throw error;
                }
            }
            
            // 2. 사용자 삽입 후 인증 정보 복사 (외래 키 제약 조건 해결)
            if (user.credential) {
                await railwayClient.userCredential.upsert({
                    where: { username: user.credential.username },
                    create: {
                        username: user.credential.username,
                        passwordHash: user.credential.passwordHash,
                        userId: user.id, // 항상 user.id 사용
                        kakaoId: user.credential.kakaoId,
                        emailVerified: user.credential.emailVerified,
                        createdAt: user.credential.createdAt,
                        updatedAt: user.credential.updatedAt,
                    },
                    update: {
                        passwordHash: user.credential.passwordHash,
                        userId: user.id, // 업데이트 시에도 user.id 사용
                        kakaoId: user.credential.kakaoId,
                        emailVerified: user.credential.emailVerified,
                        updatedAt: user.credential.updatedAt,
                    },
                });
            }
            
            if ((i + 1) % 10 === 0) {
                process.stdout.write(`  진행: ${i + 1}/${users.length}\r`);
            }
        }
        console.log(`\n✓ 사용자 데이터 마이그레이션 완료 (${users.length}명)\n`);

        console.log('[4/7] 인벤토리 데이터 마이그레이션...');
        const inventories = await supabaseClient.userInventory.findMany();
        console.log(`  ${inventories.length}개의 인벤토리 항목 복사 중...`);
        
        // Railway에 존재하는 사용자 ID 목록 가져오기
        const railwayUserIds = new Set((await railwayClient.user.findMany({ select: { id: true } })).map(u => u.id));
        
        // 존재하는 사용자의 인벤토리만 필터링
        const validInventories = inventories.filter(inv => railwayUserIds.has(inv.userId));
        console.log(`  유효한 인벤토리: ${validInventories.length}개 (전체: ${inventories.length}개)`);
        
        const batchSize = 100;
        for (let i = 0; i < validInventories.length; i += batchSize) {
            const batch = validInventories.slice(i, i + batchSize);
            await railwayClient.userInventory.createMany({
                data: batch.map(inv => ({
                    id: inv.id,
                    userId: inv.userId,
                    templateId: inv.templateId,
                    quantity: inv.quantity,
                    slot: inv.slot,
                    enhancementLvl: inv.enhancementLvl,
                    stars: inv.stars,
                    rarity: inv.rarity,
                    metadata: inv.metadata,
                    isEquipped: inv.isEquipped,
                    createdAt: inv.createdAt,
                    updatedAt: inv.updatedAt,
                    version: inv.version,
                })),
                skipDuplicates: true,
            });
            process.stdout.write(`  진행: ${Math.min(i + batchSize, validInventories.length)}/${validInventories.length}\r`);
        }
        console.log(`\n✓ 인벤토리 데이터 마이그레이션 완료 (${inventories.length}개)\n`);

        console.log('[5/7] 장비 데이터 마이그레이션...');
        const equipment = await supabaseClient.userEquipment.findMany();
        console.log(`  ${equipment.length}개의 장비 항목 복사 중...`);
        
        // 존재하는 사용자의 장비만 필터링
        const validEquipment = equipment.filter(eq => railwayUserIds.has(eq.userId));
        console.log(`  유효한 장비: ${validEquipment.length}개 (전체: ${equipment.length}개)`);
        
        for (let i = 0; i < validEquipment.length; i += batchSize) {
            const batch = validEquipment.slice(i, i + batchSize);
            await railwayClient.userEquipment.createMany({
                data: batch.map(eq => ({
                    id: eq.id,
                    userId: eq.userId,
                    slot: eq.slot,
                    inventoryId: eq.inventoryId,
                    createdAt: eq.createdAt,
                    updatedAt: eq.updatedAt,
                    version: eq.version,
                })),
                skipDuplicates: true,
            });
            process.stdout.write(`  진행: ${Math.min(i + batchSize, validEquipment.length)}/${validEquipment.length}\r`);
        }
        console.log(`\n✓ 장비 데이터 마이그레이션 완료 (${equipment.length}개)\n`);

        console.log('[6/7] 기타 데이터 마이그레이션...');
        
        // 메일
        const mails = await supabaseClient.userMail.findMany();
        if (mails.length > 0) {
            const validMails = mails.filter(m => railwayUserIds.has(m.userId));
            for (let i = 0; i < validMails.length; i += batchSize) {
                const batch = validMails.slice(i, i + batchSize);
                await railwayClient.userMail.createMany({
                    data: batch.map(m => ({
                        id: m.id,
                        userId: m.userId,
                        title: m.title,
                        body: m.body,
                        attachments: m.attachments,
                        isRead: m.isRead,
                        expiresAt: m.expiresAt,
                        createdAt: m.createdAt,
                        updatedAt: m.updatedAt,
                    })),
                    skipDuplicates: true,
                });
            }
            console.log(`  ✓ 메일: ${validMails.length}개 (전체: ${mails.length}개)`);
        }

        // 퀘스트
        const quests = await supabaseClient.userQuest.findMany();
        if (quests.length > 0) {
            const validQuests = quests.filter(q => railwayUserIds.has(q.userId));
            for (let i = 0; i < validQuests.length; i += batchSize) {
                const batch = validQuests.slice(i, i + batchSize);
                await railwayClient.userQuest.createMany({
                    data: batch.map(q => ({
                        id: q.id,
                        userId: q.userId,
                        questId: q.questId,
                        status: q.status,
                        progress: q.progress,
                        createdAt: q.createdAt,
                        updatedAt: q.updatedAt,
                    })),
                    skipDuplicates: true,
                });
            }
            console.log(`  ✓ 퀘스트: ${validQuests.length}개 (전체: ${quests.length}개)`);
        }

        // 미션
        const missions = await supabaseClient.userMission.findMany();
        if (missions.length > 0) {
            const validMissions = missions.filter(m => railwayUserIds.has(m.userId));
            for (let i = 0; i < validMissions.length; i += batchSize) {
                const batch = validMissions.slice(i, i + batchSize);
                await railwayClient.userMission.createMany({
                    data: batch.map(m => ({
                        id: m.id,
                        userId: m.userId,
                        missionId: m.missionId,
                        level: m.level,
                        state: m.state,
                        createdAt: m.createdAt,
                        updatedAt: m.updatedAt,
                    })),
                    skipDuplicates: true,
                });
            }
            console.log(`  ✓ 미션: ${validMissions.length}개 (전체: ${missions.length}개)`);
        }

        // 게임
        const games = await supabaseClient.liveGame.findMany();
        if (games.length > 0) {
            for (let i = 0; i < games.length; i += batchSize) {
                const batch = games.slice(i, i + batchSize);
                await railwayClient.liveGame.createMany({
                    data: batch.map(g => ({
                        id: g.id,
                        status: g.status,
                        category: g.category,
                        isEnded: g.isEnded,
                        data: g.data,
                        createdAt: g.createdAt,
                        updatedAt: g.updatedAt,
                    })),
                    skipDuplicates: true,
                });
            }
            console.log(`  ✓ 게임: ${games.length}개`);
        }

        // 길드 관련 데이터
        const guilds = await supabaseClient.guild.findMany();
        if (guilds.length > 0) {
            // 길드
            for (let i = 0; i < guilds.length; i += batchSize) {
                const batch = guilds.slice(i, i + batchSize);
                await railwayClient.guild.createMany({
                    data: batch.map(g => ({
                        id: g.id,
                        name: g.name,
                        leaderId: g.leaderId,
                        description: g.description,
                        emblem: g.emblem,
                        settings: g.settings,
                        gold: g.gold,
                        level: g.level,
                        experience: g.experience,
                        createdAt: g.createdAt,
                        updatedAt: g.updatedAt,
                    })),
                    skipDuplicates: true,
                });
            }
            console.log(`  ✓ 길드: ${guilds.length}개`);

            // 길드 멤버
            const guildMembers = await supabaseClient.guildMember.findMany();
            if (guildMembers.length > 0) {
                for (let i = 0; i < guildMembers.length; i += batchSize) {
                    const batch = guildMembers.slice(i, i + batchSize);
                    await railwayClient.guildMember.createMany({
                        data: batch.map(gm => ({
                            id: gm.id,
                            guildId: gm.guildId,
                            userId: gm.userId,
                            role: gm.role,
                            joinDate: gm.joinDate,
                            contributionTotal: gm.contributionTotal,
                            createdAt: gm.createdAt,
                            updatedAt: gm.updatedAt,
                        })),
                        skipDuplicates: true,
                    });
                }
                console.log(`  ✓ 길드 멤버: ${guildMembers.length}개`);
            }
        }

        console.log('');

        console.log('[7/7] 데이터 검증...');
        const railwayFinalCounts = {
            users: await railwayClient.user.count(),
            inventories: await railwayClient.userInventory.count(),
            equipment: await railwayClient.userEquipment.count(),
        };
        
        console.log('Railway 데이터:');
        console.log(`  - 사용자: ${railwayFinalCounts.users}명 (예상: ${supabaseCounts.users}명)`);
        console.log(`  - 인벤토리: ${railwayFinalCounts.inventories}개 (예상: ${supabaseCounts.inventories}개)`);
        console.log(`  - 장비: ${railwayFinalCounts.equipment}개 (예상: ${supabaseCounts.equipment}개)`);
        
        if (railwayFinalCounts.users === supabaseCounts.users &&
            railwayFinalCounts.inventories === supabaseCounts.inventories &&
            railwayFinalCounts.equipment === supabaseCounts.equipment) {
            console.log('\n✓ 마이그레이션 성공! 모든 데이터가 정상적으로 복사되었습니다.');
        } else {
            console.warn('\n⚠️  일부 데이터가 누락되었을 수 있습니다. 수동으로 확인해주세요.');
        }

        console.log('\n========================================');
        console.log('다음 단계:');
        console.log('1. Railway Dashboard에서 Backend 서비스의 DATABASE_URL을 Railway Postgres URL로 변경');
        console.log('2. 서비스를 재시작하여 새로운 데이터베이스 연결 확인');
        console.log('3. 기능 테스트 (로그인, 게임 시작 등)');
        console.log('========================================\n');

    } catch (error) {
        console.error('\n[오류] 마이그레이션 중 오류가 발생했습니다:');
        console.error(error);
        process.exit(1);
    } finally {
        await supabaseClient.$disconnect();
        await railwayClient.$disconnect();
        rl.close();
    }
}

migrateData().catch((error) => {
    console.error('예상치 못한 오류:', error);
    process.exit(1);
});

