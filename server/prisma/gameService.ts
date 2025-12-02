import prisma from "../prismaClient.js";
import type { LiveGameSession, GameStatus } from "../../types/index.js";

const ENDED_STATUSES: GameStatus[] = ["ended", "no_contest"];

const mapRowToGame = (row: { id: string; data: unknown; status: string; category: string | null }): LiveGameSession | null => {
  if (!row) return null;
  const game = JSON.parse(JSON.stringify(row.data)) as LiveGameSession;
  if (!game) return null;
  game.id = row.id;
  if (!game.gameStatus) {
    game.gameStatus = row.status as GameStatus;
  }
  if (!game.gameCategory && row.category) {
    game.gameCategory = row.category as any;
  }
  return game;
};

const deriveMeta = (game: LiveGameSession) => {
  const status: GameStatus = (game.gameStatus as GameStatus) ?? "pending";
  const category =
    game.gameCategory ??
    (game.isSinglePlayer ? "singleplayer" : game.gameCategory ?? "normal");
  const isEnded = ENDED_STATUSES.includes(status);
  return { status, category, isEnded };
};

export async function getLiveGame(id: string): Promise<LiveGameSession | null> {
  try {
    const row = await prisma.liveGame.findUnique({
      where: { id }
    });
    if (!row) return null;
    return mapRowToGame(row);
  } catch (error: any) {
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[gameService] Database connection lost, retrying...');
      try {
        await prisma.$connect();
        const row = await prisma.liveGame.findUnique({
          where: { id }
        });
        if (!row) return null;
        return mapRowToGame(row);
      } catch (retryError) {
        console.error('[gameService] Retry failed:', retryError);
        return null;
      }
    }
    console.error('[gameService] Error fetching game:', error);
    return null;
  }
}

export async function getAllActiveGames(): Promise<LiveGameSession[]> {
  try {
    const rows = await prisma.liveGame.findMany({
      where: { isEnded: false }
    });
    return rows.map((row) => mapRowToGame(row)).filter((g): g is LiveGameSession => g !== null);
  } catch (error: any) {
    // 연결 오류 시 재시도
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[gameService] Database connection lost, retrying...');
      try {
        await prisma.$connect();
        const rows = await prisma.liveGame.findMany({
          where: { isEnded: false }
        });
        return rows.map((row) => mapRowToGame(row)).filter((g): g is LiveGameSession => g !== null);
      } catch (retryError) {
        console.error('[gameService] Retry failed:', retryError);
        return []; // 재시도 실패 시 빈 배열 반환
      }
    }
    console.error('[gameService] Error fetching active games:', error);
    return []; // 다른 오류 시에도 빈 배열 반환
  }
}

export async function getAllEndedGames(): Promise<LiveGameSession[]> {
  try {
    const rows = await prisma.liveGame.findMany({
      where: { isEnded: true }
    });
    return rows.map((row) => mapRowToGame(row)).filter((g): g is LiveGameSession => g !== null);
  } catch (error: any) {
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[gameService] Database connection lost, retrying...');
      try {
        await prisma.$connect();
        const rows = await prisma.liveGame.findMany({
          where: { isEnded: true }
        });
        return rows.map((row) => mapRowToGame(row)).filter((g): g is LiveGameSession => g !== null);
      } catch (retryError) {
        console.error('[gameService] Retry failed:', retryError);
        return [];
      }
    }
    console.error('[gameService] Error fetching ended games:', error);
    return [];
  }
}

/**
 * 사용자 ID로 활성 게임 찾기 (로그인 최적화용)
 */
export async function getLiveGameByPlayerId(playerId: string): Promise<LiveGameSession | null> {
  try {
    // JSON 필드에서 player1.id 또는 player2.id로 검색
    // Prisma는 JSON 필드 검색이 제한적이므로, 모든 활성 게임을 가져와서 필터링
    // 하지만 성능을 위해 최대 100개만 조회
    const rows = await prisma.liveGame.findMany({
      where: { isEnded: false },
      take: 100 // 최대 100개만 조회하여 성능 최적화
    });
    
    for (const row of rows) {
      const game = mapRowToGame(row);
      if (game && (game.player1?.id === playerId || game.player2?.id === playerId)) {
        return game;
      }
    }
    return null;
  } catch (error: any) {
    console.error('[gameService] Error fetching game by player ID:', error);
    return null;
  }
}

export async function saveGame(game: LiveGameSession): Promise<void> {
  try {
    const { status, category, isEnded } = deriveMeta(game);
    await prisma.liveGame.upsert({
      where: { id: game.id },
      create: {
        id: game.id,
        status,
        category,
        isEnded,
        data: game
      },
      update: {
        status,
        category,
        isEnded,
        data: game,
        updatedAt: new Date()
      }
    });
  } catch (error: any) {
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[gameService] Database connection lost, retrying saveGame...');
      try {
        await prisma.$connect();
        const { status, category, isEnded } = deriveMeta(game);
        await prisma.liveGame.upsert({
          where: { id: game.id },
          create: {
            id: game.id,
            status,
            category,
            isEnded,
            data: game
          },
          update: {
            status,
            category,
            isEnded,
            data: game,
            updatedAt: new Date()
          }
        });
      } catch (retryError) {
        console.error('[gameService] Retry saveGame failed:', retryError);
        throw retryError;
      }
    } else {
      console.error('[gameService] Error saving game:', error);
      throw error;
    }
  }
}

export async function deleteGame(id: string): Promise<void> {
  try {
    await prisma.liveGame.delete({
      where: { id }
    });
  } catch (error: any) {
    if (error.code === 'P1017' || error.message?.includes('closed the connection')) {
      console.warn('[gameService] Database connection lost, retrying deleteGame...');
      try {
        await prisma.$connect();
        await prisma.liveGame.delete({
          where: { id }
        });
      } catch (retryError) {
        console.error('[gameService] Retry deleteGame failed:', retryError);
        throw retryError;
      }
    } else {
      console.error('[gameService] Error deleting game:', error);
      throw error;
    }
  }
}

