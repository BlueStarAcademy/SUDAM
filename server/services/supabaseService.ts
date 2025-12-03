// DEPRECATED: This file is no longer used. Supabase has been migrated to Railway PostgreSQL.
// All database operations now use Prisma with DATABASE_URL pointing to Railway DB.
// This file is kept for reference only and can be safely deleted.

// import { createClient } from '@supabase/supabase-js';
// import 'dotenv/config';

// Supabase is no longer used. All database operations use Railway PostgreSQL via Prisma.
// The broadcast functionality has been replaced with WebSocket-based broadcasting in server/socket.ts

export const broadcast = async (payload: object) => {
    // Deprecated: Supabase broadcast is no longer used.
    // All broadcasting is now handled via WebSocket in server/socket.ts
    // This function is kept for backward compatibility but does nothing.
    return;
};
