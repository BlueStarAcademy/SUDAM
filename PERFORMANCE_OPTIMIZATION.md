# 배포 환경 성능 최적화 가이드

## 현재 성능 병목 지점 분석

### 1. 데이터베이스 연결 풀링
- 현재 설정: `connection_limit=25`
- Railway Postgres는 연결 수 제한이 있을 수 있음

### 2. KataGo 분석
- 타임아웃: 300초 (5분)
- HTTP API 모드에서 자기 자신을 호출하는 루프 가능성

### 3. 사용자 데이터 로딩
- `getAllUsers()`가 모든 사용자를 한 번에 로드
- 인벤토리, 장비 등 관련 데이터를 모두 포함

### 4. 캐싱 전략
- 사용자 캐시는 있지만 TTL이 없음
- 무기한 캐시로 인한 메모리 누수 가능성

## 최적화 방안

### 1. 데이터베이스 연결 풀링 최적화

**Railway 환경 변수 추가:**
```env
DATABASE_URL=postgresql://...?connection_limit=10&pool_timeout=10&connect_timeout=5
```

**권장 설정:**
- `connection_limit=10`: Railway 무료 플랜에 적합
- `pool_timeout=10`: 연결 대기 시간 단축
- `connect_timeout=5`: 연결 타임아웃 단축

### 2. Prisma 쿼리 최적화

**문제점:**
- `getAllUsers()`가 모든 사용자와 관련 데이터를 한 번에 로드
- 불필요한 `include` 사용

**해결책:**
- 필요한 필드만 선택 (`select` 사용)
- 페이지네이션 적용
- 배치 처리

### 3. KataGo 최적화

**현재 문제:**
- 타임아웃이 너무 길음 (300초)
- HTTP API 모드에서 자기 자신을 호출

**해결책:**
- 타임아웃 단축 (60초)
- 로컬 KataGo 프로세스 사용 (HTTP API 비활성화)
- `maxVisits` 값 조정

### 4. 캐싱 전략 개선

**현재 문제:**
- 캐시 TTL이 없음
- 메모리 누수 가능성

**해결책:**
- TTL 추가 (5분)
- LRU 캐시 사용
- 캐시 크기 제한

### 5. Railway 리소스 최적화

**확인 사항:**
- 서비스 리소스 제한 (CPU, RAM)
- 데이터베이스 리소스 제한

**권장 사항:**
- Railway Pro 플랜 고려 (더 많은 리소스)
- 데이터베이스 인덱스 최적화

## 즉시 적용 가능한 최적화

### 1. DATABASE_URL 최적화
Railway 환경 변수에서 `DATABASE_URL`에 연결 풀링 파라미터 추가

### 2. KataGo 타임아웃 단축
`server/kataGoService.ts`에서 타임아웃을 60초로 단축

### 3. 사용자 데이터 로딩 최적화
`getAllUsers()`를 배치 처리로 변경

### 4. 캐시 TTL 추가
사용자 캐시에 TTL 추가

