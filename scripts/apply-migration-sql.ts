/**
 * 마이그레이션 SQL을 직접 실행하는 스크립트
 * 
 * 사용법:
 *   npx tsx --tsconfig server/tsconfig.json scripts/apply-migration-sql.ts <migration_name>
 * 
 * 예시:
 *   npx tsx --tsconfig server/tsconfig.json scripts/apply-migration-sql.ts 0001_init_schema
 */

import { PrismaClient } from '../generated/prisma/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

async function applyMigrationSQL(migrationName: string) {
    try {
        console.log(`[Apply Migration SQL] Applying migration: ${migrationName}`);
        
        // 마이그레이션 SQL 파일 읽기
        const migrationSQLPath = join(__dirname, '..', 'prisma', 'migrations', migrationName, 'migration.sql');
        const migrationSQL = readFileSync(migrationSQLPath, 'utf-8');
        
        console.log(`[Apply Migration SQL] Read SQL file from: ${migrationSQLPath}`);
        console.log(`[Apply Migration SQL] SQL length: ${migrationSQL.length} characters`);
        
        // SQL 실행 (Prisma의 $executeRawUnsafe 사용)
        await prisma.$executeRawUnsafe(migrationSQL);
        
        console.log(`[Apply Migration SQL] Successfully applied migration: ${migrationName}`);
        
        // 마이그레이션 상태 업데이트
        await prisma.$executeRaw`
            INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
            VALUES (gen_random_uuid(), '', NOW(), ${migrationName}, NULL, NULL, NOW(), 1)
            ON CONFLICT (migration_name) DO UPDATE
            SET finished_at = NOW(),
                applied_steps_count = 1,
                rolled_back_at = NULL
        `;
        
        console.log(`[Apply Migration SQL] Migration status updated in _prisma_migrations table`);
        console.log(`[Apply Migration SQL] Done. You can now run: npx prisma migrate deploy --schema prisma/schema.prisma`);
        
    } catch (error) {
        console.error(`[Apply Migration SQL] Error applying migration:`, error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// 명령줄 인자에서 마이그레이션 이름 가져오기
const migrationName = process.argv[2];

if (!migrationName) {
    console.error('Usage: npx tsx --tsconfig server/tsconfig.json scripts/apply-migration-sql.ts <migration_name>');
    console.error('Example: npx tsx --tsconfig server/tsconfig.json scripts/apply-migration-sql.ts 0001_init_schema');
    process.exit(1);
}

applyMigrationSQL(migrationName)
    .then(() => {
        console.log('[Apply Migration SQL] Done.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Apply Migration SQL] Failed:', error);
        process.exit(1);
    });

