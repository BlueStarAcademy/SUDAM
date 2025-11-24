import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const SALT_ROUNDS = 10;

/**
 * 비밀번호를 해싱합니다.
 */
export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * pbkdf2로 비밀번호를 해싱합니다 (기존 방식 호환용).
 */
export const hashPasswordPbkdf2 = (password: string, salt: string): string => {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
};

/**
 * 비밀번호를 검증합니다.
 * bcrypt와 pbkdf2 두 방식을 모두 지원합니다.
 */
export const verifyPassword = async (password: string, hash: string, salt?: string): Promise<boolean> => {
    if (!hash) return false;
    
    // bcrypt 해시인지 확인 (항상 $2a$, $2b$, $2y$로 시작)
    if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
        return await bcrypt.compare(password, hash);
    }
    
    // pbkdf2 해시인 경우 (기존 방식)
    // hash 형식: "hash:salt" 또는 salt가 별도로 제공된 경우
    if (salt) {
        const expectedHash = hashPasswordPbkdf2(password, salt);
        return hash === expectedHash;
    }
    
    // hash에 salt가 포함된 경우 (형식: "hash:salt")
    if (hash.includes(':')) {
        const [storedHash, storedSalt] = hash.split(':');
        const expectedHash = hashPasswordPbkdf2(password, storedSalt);
        return storedHash === expectedHash;
    }
    
    // hash만 있는 경우, 기존 데이터베이스에서 salt가 별도로 저장되지 않았을 수 있음
    // 이 경우 직접 비교는 불가능하므로 false 반환
    // 하지만 기존 사용자의 경우 hash 자체가 pbkdf2 해시일 수 있으므로
    // 일반적인 pbkdf2 해시 길이(128자 hex)인지 확인
    if (hash.length === 128 && /^[0-9a-f]+$/i.test(hash)) {
        // pbkdf2 해시로 보이지만 salt가 없어서 검증 불가
        // 기존 사용자의 경우 비밀번호 재설정이 필요할 수 있음
        console.warn('[PasswordUtils] pbkdf2 hash detected but salt is missing. Password verification may fail.');
        return false;
    }
    
    return false;
};

