/**
 * 이미지 경로 유틸리티
 * WebP를 지원하는 브라우저에서는 WebP를 우선적으로 사용합니다.
 */

// Modernizr 타입 선언
declare global {
    interface Window {
        Modernizr?: {
            webp?: boolean;
        };
    }
}

/**
 * 이미지 경로를 WebP로 변환 (브라우저 지원 시)
 * @param path 원본 이미지 경로 (.png, .jpg 등)
 * @returns WebP 경로 또는 원본 경로
 */
export function getOptimizedImagePath(path: string): string {
  // WebP 지원 확인
  if (typeof window !== 'undefined' && window.Modernizr?.webp) {
    // Modernizr가 있는 경우
    return path.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  }
  
  // WebP 지원 여부를 직접 확인
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const supportsWebP = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    if (supportsWebP) {
      return path.replace(/\.(png|jpg|jpeg)$/i, '.webp');
    }
  }
  
  // WebP를 지원하지 않으면 원본 경로 반환
  return path;
}

/**
 * 이미지 경로를 강제로 WebP로 변환
 * @param path 원본 이미지 경로
 * @returns WebP 경로
 */
export function toWebP(path: string): string {
  return path.replace(/\.(png|jpg|jpeg)$/i, '.webp');
}

/**
 * 이미지 경로를 원본 형식으로 변환
 * @param path 이미지 경로
 * @returns 원본 형식 경로
 */
export function toOriginal(path: string): string {
  return path.replace(/\.webp$/i, '.png');
}
