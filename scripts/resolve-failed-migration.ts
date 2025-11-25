/**
 * 실패한 Prisma 마이그레이션을 해결하는 스크립트
 * 
 * 사용법:
 *   npx tsx --tsconfig server/tsconfig.json scripts/resolve-failed-migration.ts <migration_name>
 * 
 * 예시:
 *   npx tsx --tsconfig server/tsconfig.json scripts/resolve-failed-migration.ts 0001_init_schema
 */

import { PrismaClient } from '../generated/prisma/index.js';

const prisma = new PrismaClient();

async function resolveFailedMigration(migrationName: string) {
    try {
        console.log(`[Resolve Migration] Attempting to resolve failed migration: ${migrationName}`);
        
        // 실패한 마이그레이션 확인
        const failedMigration = await prisma.$queryRaw<Array<{
            migration_name: string;
            finished_at: Date | null;
            applied_steps_count: number;
        }>>`
            SELECT migration_name, finished_at, applied_steps_count
            FROM "_prisma_migrations"
            WHERE migration_name = ${migrationName}
        `;
        
        if (failedMigration.length === 0) {
            console.log(`[Resolve Migration] Migration ${migrationName} not found in database.`);
            return;
        }
        
        const migration = failedMigration[0];
        
        if (migration.finished_at !== null) {
            console.log(`[Resolve Migration] Migration ${migrationName} is already marked as completed.`);
            return;
        }
        
        console.log(`[Resolve Migration] Found failed migration: ${migrationName}`);
        console.log(`[Resolve Migration] Current state: finished_at=${migration.finished_at}, applied_steps_count=${migration.applied_steps_count}`);
        
        // 실패한 마이그레이션을 해결 (applied로 표시)
        await prisma.$executeRaw`
            UPDATE "_prisma_migrations"
            SET finished_at = NOW(),
                applied_steps_count = 1
            WHERE migration_name = ${migrationName}
              AND finished_at IS NULL
        `;
        
        console.log(`[Resolve Migration] Successfully resolved migration: ${migrationName}`);
        console.log(`[Resolve Migration] You can now run: npx prisma migrate deploy --schema prisma/schema.prisma`);
        
    } catch (error) {
        console.error(`[Resolve Migration] Error resolving migration:`, error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// 명령줄 인자에서 마이그레이션 이름 가져오기
const migrationName = process.argv[2];

if (!migrationName) {
    console.error('Usage: npx tsx --tsconfig server/tsconfig.json scripts/resolve-failed-migration.ts <migration_name>');
    console.error('Example: npx tsx --tsconfig server/tsconfig.json scripts/resolve-failed-migration.ts 0001_init_schema');
    process.exit(1);
}

resolveFailedMigration(migrationName)
    .then(() => {
        console.log('[Resolve Migration] Done.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Resolve Migration] Failed:', error);
        process.exit(1);
    });

