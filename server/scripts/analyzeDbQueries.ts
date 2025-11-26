import prisma from '../prismaClient.js';

/**
 * 데이터베이스 쿼리 분석 스크립트
 * 어떤 쿼리가 자주 호출되는지, 얼마나 느린지 확인
 */
async function analyzeDbQueries() {
    console.log('='.repeat(60));
    console.log('데이터베이스 쿼리 분석 시작...');
    console.log('='.repeat(60));
    
    try {
        // 1. 데이터베이스 연결 확인
        console.log('\n[1/3] 데이터베이스 연결 확인...');
        const startConnect = Date.now();
        await prisma.$connect();
        const connectTime = Date.now() - startConnect;
        console.log(`  ✓ 연결 시간: ${connectTime}ms`);
        
        if (connectTime > 1000) {
            console.log(`  ⚠️  경고: 연결 시간이 1초를 초과합니다. 원격 데이터베이스를 사용 중일 수 있습니다.`);
        }
        
        // 2. DATABASE_URL 확인 (민감 정보 제외)
        const dbUrl = process.env.DATABASE_URL || '';
        if (dbUrl) {
            const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
            console.log(`  ✓ DATABASE_URL: ${maskedUrl.substring(0, 50)}...`);
            if (dbUrl.includes('railway') || dbUrl.includes('amazonaws') || dbUrl.includes('azure')) {
                console.log(`  ⚠️  원격 데이터베이스를 사용 중입니다. 네트워크 지연이 성능에 영향을 줄 수 있습니다.`);
            }
        } else {
            console.log(`  ✗ DATABASE_URL이 설정되지 않았습니다.`);
        }
        
        // 3. 연결 풀 설정 확인
        console.log('\n[2/3] 연결 풀 설정 확인...');
        const poolInfo = await prisma.$queryRaw<Array<{ 
            setting: string; 
            current_setting: string 
        }>>`
            SELECT 
                'max_connections' as setting,
                current_setting('max_connections') as current_setting
            UNION ALL
            SELECT 
                'shared_buffers' as setting,
                current_setting('shared_buffers') as current_setting
        `;
        
        poolInfo.forEach(info => {
            console.log(`  ✓ ${info.setting}: ${info.current_setting}`);
        });
        
        // 4. 인덱스 확인 (User 테이블)
        console.log('\n[3/3] User 테이블 인덱스 확인...');
        const indexes = await prisma.$queryRaw<Array<{
            indexname: string;
            indexdef: string;
        }>>`
            SELECT 
                indexname,
                indexdef
            FROM pg_indexes
            WHERE tablename = 'User'
            ORDER BY indexname
        `;
        
        if (indexes.length > 0) {
            console.log(`  ✓ 인덱스 ${indexes.length}개 발견:`);
            indexes.forEach(idx => {
                console.log(`    - ${idx.indexname}`);
            });
        } else {
            console.log(`  ⚠️  인덱스가 없습니다. 성능에 영향을 줄 수 있습니다.`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✓ 데이터베이스 쿼리 분석 완료');
        console.log('='.repeat(60));
        
        // 성능 개선 권장사항
        console.log('\n📋 성능 개선 권장사항:');
        if (connectTime > 1000) {
            console.log('  1. 로컬 데이터베이스 사용을 고려하세요 (PostgreSQL 로컬 설치)');
            console.log('  2. 데이터베이스 연결 풀 설정을 확인하세요');
        }
        if (indexes.length === 0) {
            console.log('  3. User 테이블에 인덱스를 추가하세요 (id, username, nickname 등)');
        }
        console.log('  4. 캐시를 적극 활용하세요 (이미 구현됨)');
        console.log('  5. equipment/inventory는 필요한 경우에만 로드하세요 (이미 최적화됨)');
        
    } catch (error: any) {
        console.error('\n❌ 오류 발생:', error);
        console.error('스택 트레이스:', error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

analyzeDbQueries().catch((error) => {
    console.error('예상치 못한 오류:', error);
    process.exit(1);
});

