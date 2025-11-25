// @ts-nocheck
import prisma from "../prismaClient.js";
import type { Prisma } from "@prisma/client";

export type PrismaCredential = Prisma.UserCredentialGetPayload<{
  select: {
    username: true;
    passwordHash: true;
    userId: true;
    kakaoId?: true;
    emailVerified?: true;
  };
}>;

export const getUserCredentialByUsername = async (
  username: string
): Promise<PrismaCredential | null> => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{
      username: string;
      passwordHash: string | null;
      userId: string;
      kakaoId?: string | null;
      emailVerified?: boolean;
    }>>(
      `SELECT username, "passwordHash", "userId", "kakaoId", "emailVerified" 
       FROM "UserCredential" 
       WHERE username = $1`,
      username.toLowerCase()
    );
    return result[0] || null;
  } catch (error: any) {
    // kakaoId나 emailVerified 컬럼이 없는 경우 기본 필드만 조회
    const errorCode = error.code || error.meta?.code;
    const errorMessage = error.message || '';
    if (errorCode === 'P2022' || errorCode === '42703' || 
        errorMessage.includes('kakaoId') || errorMessage.includes('emailVerified') || 
        errorMessage.includes('column') || errorMessage.includes('does not exist')) {
      const result = await prisma.$queryRawUnsafe<Array<{
        username: string;
        passwordHash: string | null;
        userId: string;
      }>>(
        `SELECT username, "passwordHash", "userId" 
         FROM "UserCredential" 
         WHERE username = $1`,
        username.toLowerCase()
      );
      const row = result[0];
      if (!row) return null;
      return {
        username: row.username,
        passwordHash: row.passwordHash,
        userId: row.userId,
        kakaoId: null,
        emailVerified: false,
      };
    }
    throw error;
  }
};

export const getUserCredentialByUserId = async (
  userId: string
): Promise<PrismaCredential | null> => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{
      username: string;
      passwordHash: string | null;
      userId: string;
      kakaoId?: string | null;
      emailVerified?: boolean;
    }>>(
      `SELECT username, "passwordHash", "userId", "kakaoId", "emailVerified" 
       FROM "UserCredential" 
       WHERE "userId" = $1`,
      userId
    );
    return result[0] || null;
  } catch (error: any) {
    // kakaoId나 emailVerified 컬럼이 없는 경우 기본 필드만 조회
    const errorCode = error.code || error.meta?.code;
    const errorMessage = error.message || '';
    if (errorCode === 'P2022' || errorCode === '42703' || 
        errorMessage.includes('kakaoId') || errorMessage.includes('emailVerified') || 
        errorMessage.includes('column') || errorMessage.includes('does not exist')) {
      const result = await prisma.$queryRawUnsafe<Array<{
        username: string;
        passwordHash: string | null;
        userId: string;
      }>>(
        `SELECT username, "passwordHash", "userId" 
         FROM "UserCredential" 
         WHERE "userId" = $1`,
        userId
      );
      const row = result[0];
      if (!row) return null;
      return {
        username: row.username,
        passwordHash: row.passwordHash,
        userId: row.userId,
        kakaoId: null,
        emailVerified: false,
      };
    }
    throw error;
  }
};

export const createUserCredential = async (
  username: string,
  passwordHash: string | null,
  userId: string,
  kakaoId?: string | null
): Promise<void> => {
  const normalizedUsername = username.toLowerCase();
  try {
    // 먼저 새 컬럼이 있는지 확인하고 시도
    await prisma.$executeRawUnsafe(`
      INSERT INTO "UserCredential" (username, "passwordHash", "userId", "kakaoId", "emailVerified")
      VALUES ($1, $2, $3, $4, $5)
    `, normalizedUsername, passwordHash, userId, kakaoId || null, false);
  } catch (error: any) {
    // kakaoId나 emailVerified 컬럼이 아직 없는 경우 기본 필드만 사용
    const errorCode = error.code || error.meta?.code;
    const errorMessage = error.message || '';
    if (errorCode === 'P2022' || errorCode === '42703' || 
        errorMessage.includes('kakaoId') || errorMessage.includes('emailVerified') || 
        errorMessage.includes('column') || errorMessage.includes('does not exist')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "UserCredential" (username, "passwordHash", "userId")
        VALUES ($1, $2, $3)
      `, normalizedUsername, passwordHash, userId);
    } else {
      throw error;
    }
  }
};

export const updateUserCredential = async (
  userId: string,
  updates: {
    passwordHash?: string | null;
    kakaoId?: string | null;
    emailVerified?: boolean;
  }
): Promise<void> => {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.passwordHash !== undefined) {
      setClauses.push(`"passwordHash" = $${paramIndex++}`);
      values.push(updates.passwordHash);
    }
    if (updates.kakaoId !== undefined) {
      setClauses.push(`"kakaoId" = $${paramIndex++}`);
      values.push(updates.kakaoId);
    }
    if (updates.emailVerified !== undefined) {
      setClauses.push(`"emailVerified" = $${paramIndex++}`);
      values.push(updates.emailVerified);
    }

    if (setClauses.length === 0) return;

    values.push(userId);
    await prisma.$executeRawUnsafe(
      `UPDATE "UserCredential" SET ${setClauses.join(', ')} WHERE "userId" = $${paramIndex}`,
      ...values
    );
  } catch (error: any) {
    // kakaoId나 emailVerified 컬럼이 아직 없는 경우 해당 필드 제외하고 업데이트
    const errorCode = error.code || error.meta?.code;
    const errorMessage = error.message || '';
    if (errorCode === 'P2022' || errorCode === '42703' || 
        errorMessage.includes('kakaoId') || errorMessage.includes('emailVerified') || 
        errorMessage.includes('column') || errorMessage.includes('does not exist')) {
      const { kakaoId, emailVerified, ...basicUpdates } = updates;
      if (Object.keys(basicUpdates).length > 0) {
        const setClauses: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (basicUpdates.passwordHash !== undefined) {
          setClauses.push(`"passwordHash" = $${paramIndex++}`);
          values.push(basicUpdates.passwordHash);
        }

        if (setClauses.length > 0) {
          values.push(userId);
          await prisma.$executeRawUnsafe(
            `UPDATE "UserCredential" SET ${setClauses.join(', ')} WHERE "userId" = $${paramIndex}`,
            ...values
          );
        }
      }
    } else {
      throw error;
    }
  }
};

export const getUserCredentialByKakaoId = async (
  kakaoId: string
): Promise<PrismaCredential | null> => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{
      username: string;
      passwordHash: string | null;
      userId: string;
      kakaoId?: string | null;
      emailVerified?: boolean;
    }>>(
      `SELECT username, "passwordHash", "userId", "kakaoId", "emailVerified" 
       FROM "UserCredential" 
       WHERE "kakaoId" = $1`,
      kakaoId
    );
    return result[0] || null;
  } catch (error: any) {
    // kakaoId 컬럼이 아직 없는 경우 null 반환
    const errorCode = error.code || error.meta?.code;
    const errorMessage = error.message || '';
    if (errorCode === 'P2022' || errorCode === '42703' || 
        errorMessage.includes('kakaoId') || errorMessage.includes('column') || 
        errorMessage.includes('does not exist')) {
      return null;
    }
    throw error;
  }
};

export const deleteUserCredentialByUsername = async (
  username: string
): Promise<void> => {
  await prisma.userCredential.delete({
    where: { username: username.toLowerCase() }
  });
};

export const updateUserCredentialUsername = async (
  oldUsername: string,
  newUsername: string
): Promise<void> => {
  const normalizedOldUsername = oldUsername.toLowerCase();
  const normalizedNewUsername = newUsername.toLowerCase();
  
  await prisma.$executeRawUnsafe(
    `UPDATE "UserCredential" SET username = $1 WHERE username = $2`,
    normalizedNewUsername,
    normalizedOldUsername
  );
};

