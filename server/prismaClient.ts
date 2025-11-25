import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.ts";

// DATABASE_URL에 연결 풀링 파라미터 추가 (없는 경우)
const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL || '';
  if (!url) return url;
  
  // 이미 연결 풀링 파라미터가 있는지 확인
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }
  
  // 연결 풀링 파라미터 추가 (Railway 환경 최적화)
  // Railway 무료/스타터 플랜에 맞게 연결 수 조정
  // connection_limit: 최대 연결 수 (Railway 제한 고려)
  // pool_timeout: 연결 대기 시간 단축
  // connect_timeout: 연결 타임아웃 단축
  // statement_cache_size: 쿼리 캐시 크기
  const separator = url.includes('?') ? '&' : '?';
  // Railway 환경에서는 연결 수를 줄이고 타임아웃을 단축하여 성능 최적화
  const isRailway = url.includes('railway') || process.env.RAILWAY_ENVIRONMENT;
  const connectionLimit = isRailway ? '10' : '25'; // Railway는 연결 수 제한이 있으므로 줄임
  const poolTimeout = isRailway ? '10' : '20'; // Railway는 대기 시간 단축
  const connectTimeout = isRailway ? '5' : '10'; // Railway는 연결 타임아웃 단축
  return `${url}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}&connect_timeout=${connectTimeout}&statement_cache_size=0`;
};

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});

// 연결 오류 처리
prisma.$on('error' as never, (e: any) => {
  console.error('[Prisma] Database error:', e);
});

// 연결 끊김 시 재연결 시도
let isReconnecting = false;

const reconnectPrisma = async () => {
  if (isReconnecting) return;
  isReconnecting = true;
  
  try {
    console.log('[Prisma] Attempting to reconnect...');
    await prisma.$disconnect();
    await prisma.$connect();
    console.log('[Prisma] Reconnected successfully');
  } catch (error) {
    console.error('[Prisma] Reconnection failed:', error);
  } finally {
    isReconnecting = false;
  }
};

// 주기적으로 연결 상태 확인
setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error: any) {
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[Prisma] Connection lost, attempting to reconnect...');
      await reconnectPrisma();
    }
  }
}, 30000); // 30초마다 확인

// 프로세스 종료 시 정리
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;

