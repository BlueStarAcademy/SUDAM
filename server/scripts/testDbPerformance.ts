import prisma from '../prismaClient.js';
import * as db from '../db.js';

async function testDbPerformance() {
    console.log('='.repeat(60));
    console.log('데이터베이스 성능 테스트 시작...');
    console.log('='.repeat(60));
    
    try {
        // 1. 기본 연결 테스트
        console.log('\n[1/6] 기본 연결 테스트...');
        const startConnect = Date.now();
        await prisma.$connect();
        const connectTime = Date.now() - startConnect;
        console.log(`  ✓ 연결 시간: ${connectTime}ms`);
        
        // 2. 간단한 쿼리 테스트 (User 테이블 카운트)
        console.log('\n[2/6] User 테이블 카운트 쿼리...');
        const startCount = Date.now();
        const userCount = await prisma.user.count();
        const countTime = Date.now() - startCount;
        console.log(`  ✓ 사용자 수: ${userCount}명`);
        console.log(`  ✓ 쿼리 시간: ${countTime}ms`);
        
        // 3. 단일 사용자 조회 테스트 (getUser)
        console.log('\n[3/6] 단일 사용자 조회 테스트 (getUser)...');
        const firstUser = await prisma.user.findFirst({ select: { id: true } });
        if (firstUser) {
            const iterations = 10;
            const times: number[] = [];
            
            for (let i = 0; i < iterations; i++) {
                const start = Date.now();
                await db.getUser(firstUser.id);
                const elapsed = Date.now() - start;
                times.push(elapsed);
            }
            
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);
            
            console.log(`  ✓ ${iterations}회 반복 테스트:`);
            console.log(`    - 평균: ${avgTime.toFixed(2)}ms`);
            console.log(`    - 최소: ${minTime}ms`);
            console.log(`    - 최대: ${maxTime}ms`);
        } else {
            console.log('  ⊘ 테스트할 사용자가 없습니다.');
        }
        
        // 4. 모든 사용자 조회 테스트 (getAllUsers)
        console.log('\n[4/6] 모든 사용자 조회 테스트 (getAllUsers)...');
        const startGetAll = Date.now();
        const allUsers = await db.getAllUsers();
        const getAllTime = Date.now() - startGetAll;
        console.log(`  ✓ 사용자 수: ${allUsers.length}명`);
        console.log(`  ✓ 쿼리 시간: ${getAllTime}ms`);
        console.log(`  ✓ 사용자당 평균: ${(getAllTime / allUsers.length).toFixed(2)}ms`);
        
        // 5. 복잡한 쿼리 테스트 (관계 포함)
        console.log('\n[5/6] 복잡한 쿼리 테스트 (관계 포함)...');
        if (firstUser) {
            const startComplex = Date.now();
            const complexUser = await prisma.user.findUnique({
                where: { id: firstUser.id },
                include: {
                    guildMember: true,
                    guild: true,
                    inventory: true,
                    equipment: true
                }
            });
            const complexTime = Date.now() - startComplex;
            console.log(`  ✓ 쿼리 시간: ${complexTime}ms`);
            console.log(`  ✓ 인벤토리 아이템 수: ${complexUser?.inventory?.length || 0}개`);
            console.log(`  ✓ 장비 수: ${complexUser?.equipment?.length || 0}개`);
        }
        
        // 6. 데이터베이스 연결 풀 상태 확인
        console.log('\n[6/6] 데이터베이스 연결 풀 상태...');
        const poolInfo = await prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()
        `;
        const activeConnections = Number(poolInfo[0]?.count || 0);
        console.log(`  ✓ 활성 연결 수: ${activeConnections}`);
        
        // 7. 느린 쿼리 확인 (1초 이상 걸린 쿼리)
        console.log('\n[7/7] 느린 쿼리 확인 (1초 이상)...');
        try {
            const slowQueries = await prisma.$queryRaw<Array<{
                query: string;
                mean_exec_time: number;
                calls: bigint;
            }>>`
                SELECT 
                    LEFT(query, 100) as query,
                    mean_exec_time,
                    calls
                FROM pg_stat_statements
                WHERE mean_exec_time > 1000
                ORDER BY mean_exec_time DESC
                LIMIT 10
            `;
            
            if (slowQueries.length > 0) {
                console.log(`  ⚠️  ${slowQueries.length}개의 느린 쿼리 발견:`);
                slowQueries.forEach((q, i) => {
                    console.log(`    ${i + 1}. 평균 실행 시간: ${q.mean_exec_time.toFixed(2)}ms, 호출 횟수: ${q.calls}`);
                    console.log(`       쿼리: ${q.query}...`);
                });
            } else {
                console.log('  ✓ 느린 쿼리 없음 (1초 이상)');
            }
        } catch (error: any) {
            console.log(`  ⊘ pg_stat_statements 확장이 활성화되지 않았습니다: ${error.message}`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✓ 데이터베이스 성능 테스트 완료');
        console.log('='.repeat(60));
        
    } catch (error: any) {
        console.error('\n❌ 오류 발생:', error);
        console.error('스택 트레이스:', error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

testDbPerformance().catch((error) => {
    console.error('예상치 못한 오류:', error);
    process.exit(1);
});

