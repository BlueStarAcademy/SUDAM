# KataGo 배포 환경 및 설치 방식 설명

## 배포 환경 확인

### Railway 배포 환경
- **운영체제**: Linux (Alpine Linux)
- **Dockerfile**: `Dockerfile.backend` 사용
- **베이스 이미지**: `node:20-alpine` (리눅스)

### 로컬 개발 환경
- **운영체제**: Windows
- **필요한 파일**: `katago.exe` (Windows 바이너리)

## KataGo 설치 방식

### 1. 배포 환경 (Railway/Linux) - 자동 설치 ✅

**현재 설정: 자동 다운로드**

`Dockerfile.backend`의 40-58번째 줄을 보면:

```dockerfile
# Download KataGo Linux binary and model
RUN mkdir -p /app/katago /tmp/katago_extract && \
    cd /tmp && \
    wget https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip && \
    unzip katago.zip && \
    cp katago /app/katago/katago && \
    wget https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
```

**결론**: 
- ✅ **수동 다운로드 불필요**
- ✅ **Git에 넣을 필요 없음**
- ✅ **배포 시 자동으로 다운로드됨**

### 2. 로컬 개발 환경 (Windows) - 수동 설치 필요

**필요한 파일:**
- `katago/katago.exe` (Windows 바이너리)
- `katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz` (모델 파일)

**설치 방법:**
1. Windows 바이너리 다운로드
2. `katago` 폴더에 `katago.exe` 저장
3. 모델 파일 다운로드하여 `katago` 폴더에 저장

## 현재 상황 정리

### 배포 환경 (Railway)
- ✅ **자동 설치됨** - Dockerfile에서 빌드 시 자동 다운로드
- ✅ **Linux 바이너리 사용** - `katago` (확장자 없음)
- ❌ **Git에 넣을 필요 없음** - 자동 다운로드되므로

### 로컬 환경 (Windows)
- ✅ **수동 설치 필요** - `katago.exe` 필요
- ✅ **Git에 넣어도 됨** (선택사항) - 팀원과 공유하려면
- ⚠️ **주의**: Windows 바이너리는 Git LFS 사용 권장 (파일 크기)

## Git에 넣을지 말지?

### 배포 환경용 (Linux)
- ❌ **넣을 필요 없음** - Dockerfile에서 자동 다운로드
- ✅ **넣으면 빌드 시간 단축** - 다운로드 시간 절약 가능

### 로컬 환경용 (Windows)
- ✅ **넣으면 좋음** - 팀원들이 로컬 개발 시 사용
- ⚠️ **Git LFS 필수** - 파일 크기가 크므로

## 권장 사항

### 옵션 1: Git에 넣지 않기 (현재 방식)
- **장점**: 
  - Git 저장소 크기 작음
  - Dockerfile에서 항상 최신 버전 다운로드
- **단점**: 
  - 배포 빌드 시간 증가 (다운로드 시간)
  - 로컬 개발 시 수동 설치 필요

### 옵션 2: Git에 넣기 (Git LFS 사용)
- **장점**: 
  - 배포 빌드 시간 단축
  - 로컬 개발 시 자동 사용 가능
  - 팀원과 공유 용이
- **단점**: 
  - Git LFS 설정 필요
  - 저장소 크기 증가

## 현재 코드 확인

### Dockerfile.backend (40-58줄)
```dockerfile
# Download KataGo Linux binary and model
RUN wget ... katago-v1.16.4-eigenavx2-linux-x64.zip
```

### server/kataGoService.ts (18줄)
```typescript
const KATAGO_PATH = process.env.KATAGO_PATH || path.resolve(PROJECT_ROOT, 'katago/katago.exe');
```

**문제**: 기본값이 `katago.exe`인데, Linux에서는 확장자가 없어야 함!

## 결론

1. **배포 환경 (Railway)**: 
   - ✅ 자동 설치됨 (Dockerfile에서)
   - ✅ Linux 바이너리 자동 다운로드
   - ❌ Git에 넣을 필요 없음

2. **로컬 환경 (Windows)**:
   - ✅ 수동으로 `katago.exe` 다운로드 필요
   - ✅ Git에 넣으면 팀원과 공유 가능 (Git LFS 권장)

3. **현재 `katago` 폴더의 파일들**:
   - Windows용: `katago.exe` ✅ (로컬 개발용)
   - Linux용: `katago` ✅ (배포용, Dockerfile에서 자동 다운로드)
   - 모델: `kata1-b28c512nbt-s9853922560-d5031756885.bin.gz` ✅

## 다음 단계

1. **배포는 그대로 두기** - Dockerfile이 자동으로 처리
2. **로컬 개발만 확인** - `katago.exe`가 있는지 확인
3. **Git에 넣을지 결정** - 팀 공유가 필요하면 Git LFS로 추가

