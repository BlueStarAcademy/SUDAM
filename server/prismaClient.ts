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
  // Railway DB 연결 최적화 (로컬에서도 Railway DB 사용)
  // Railway는 연결 수 제한이 있으므로 적절히 설정
  const isRailway = url.includes('railway') || process.env.RAILWAY_ENVIRONMENT;
  // Railway DB는 네트워크 지연이 있으므로 연결 풀을 적절히 설정
  // 연결 수를 늘려서 동시 요청 처리 능력 향상 (1000명 동시 접속 대응)
  // 1000명 동시 접속 시 WebSocket 초기 상태 로드로 인한 동시 쿼리 증가 고려
  const connectionLimit = isRailway ? '100' : '150'; // Railway: 100개, 로컬: 150개 연결 (1000명 대응)
  const poolTimeout = isRailway ? '60' : '40'; // Railway: 60초, 로컬: 40초 대기 시간 (증가)
  const connectTimeout = isRailway ? '20' : '15'; // Railway: 20초, 로컬: 15초 타임아웃 (증가)
  // statement_cache_size를 0으로 설정하면 매번 쿼리를 파싱하므로, 캐시 활성화
  const statementCacheSize = '500'; // 쿼리 캐시 크기 증가 (1000명 대응)
  return `${url}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}&connect_timeout=${connectTimeout}&statement_cache_size=${statementCacheSize}`;
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

