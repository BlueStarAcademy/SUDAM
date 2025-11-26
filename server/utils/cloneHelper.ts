/**
 * 성능 최적화된 깊은 복사 헬퍼
 * JSON.parse(JSON.stringify())보다 빠르고 메모리 효율적
 */

/**
 * structuredClone을 사용한 깊은 복사 (Node.js 17+)
 * JSON.parse(JSON.stringify())보다 약 2-3배 빠름
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    // structuredClone 사용 가능하면 사용
    if (typeof structuredClone !== 'undefined') {
        try {
            return structuredClone(obj);
        } catch (error) {
            // structuredClone이 실패하면 JSON 방식으로 폴백
            // (예: 순환 참조가 있는 경우)
        }
    }
    
    // 폴백: JSON 방식 (호환성을 위해)
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (error) {
        console.error('[cloneHelper] Deep clone failed:', error);
        // 복사 실패 시 원본 반환 (최악의 경우)
        return obj;
    }
}

/**
 * 얕은 복사 (속도 우선, 참조 복사)
 */
export function shallowClone<T>(obj: T): T {
    if (Array.isArray(obj)) {
        return [...obj] as unknown as T;
    }
    if (obj !== null && typeof obj === 'object') {
        return { ...obj } as T;
    }
    return obj;
}

/**
 * 선택적 깊은 복사 (특정 필드만 깊은 복사)
 */
export function selectiveDeepClone<T extends Record<string, any>>(
    obj: T,
    deepFields: (keyof T)[]
): T {
    const result = { ...obj } as T;
    
    for (const field of deepFields) {
        if (field in obj && obj[field] !== undefined && obj[field] !== null) {
            if (typeof obj[field] === 'object') {
                result[field] = deepClone(obj[field]);
            }
        }
    }
    
    return result;
}

