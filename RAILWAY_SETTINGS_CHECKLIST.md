# Railway Dashboard 설정 체크리스트 (현재 화면 기준)

## 현재 화면에서 확인된 설정

### ✅ 이미 설정됨 (railway.json에 있음)
- **Healthcheck Path**: `/api/health` ✅
- **Healthcheck Timeout**: `60` ✅
- **Restart Policy**: `Never` ✅
- **Serverless**: `OFF` ✅

## 추가로 확인해야 할 설정

### 1. Resource Limits (리소스 제한) - 중요!

**Railway Dashboard → Settings → Deploy:**
- 아래로 스크롤하여 **"Resource Limits"** 섹션 찾기
- 또는 오른쪽 메뉴에서 **"Deploy"** 클릭

**설정 값:**
```
CPU: 4 vCPU (최소 2 vCPU)
Memory: 4-8 GB (최소 4 GB 권장)
```

**확인 방법:**
- 현재 설정된 값 확인
- 만약 2GB 이하로 설정되어 있다면 **즉시 4GB 이상으로 증가**

### 2. Pre-deploy Command

**Railway Dashboard → Settings → Deploy:**
- 아래로 스크롤하여 **"Pre-deploy Command"** 섹션 찾기

**현재 설정 확인:**
- 비어있거나 최소화되어 있는지 확인
- 만약 복잡한 명령어가 있다면:
  ```
  npx prisma db push --schema prisma/schema.prisma --accept-data-loss --skip-generate
  ```
  또는 비우기

### 3. Custom Start Command

**Railway Dashboard → Settings → Deploy:**
- **"Custom Start Command"** 섹션 찾기

**현재 설정 확인:**
- `npm run start-server` 또는 비어있어야 함
- railway.json의 `startCommand`가 우선 적용됨

### 4. Regions (지역)

**Railway Dashboard → Settings → Deploy:**
- **"Regions"** 섹션 찾기

**권장 설정:**
- **지역**: `Southeast Asia (Singapore)` ✅ (한국에서 가장 가까움)
- **인스턴스 수**: `1 Instance` ✅

### 5. Teardown

**Railway Dashboard → Settings → Deploy:**
- **"Teardown"** 섹션 찾기

**권장 설정:**
- **Enable Teardown**: `OFF` ✅ (비활성화)

### 6. Config-as-code

**Railway Dashboard → Settings:**
- **"Config-as-code"** 섹션 확인

**확인 사항:**
- `railway.json` 파일 경로가 올바른지 확인
- 또는 "Open file" 버튼으로 `railway.json` 내용 확인

## 현재 서버 상태 (로그 기준)

### ✅ 정상 작동 중
- 서버 시작: 성공
- 포트 리스닝: 4000
- 메모리 사용량: 194MB (정상)
- 데이터베이스 연결: 성공
- KataGo 초기화: 완료

### 📊 확인할 사항
1. **Resource Limits**: 4 vCPU / 4-8 GB 확인
2. **Pre-deploy Command**: 최소화 또는 비우기
3. **서버 안정성**: 계속 모니터링

## 즉시 확인할 항목 순위

### 🔴 최우선 (즉시 확인)
1. **Resource Limits**
   - CPU: 최소 2 vCPU (4 vCPU 권장)
   - Memory: 최소 4 GB (8 GB 권장)
   - 현재 다운그레이드했다면 다시 증가 필요

### 🟡 중요 (확인 권장)
2. **Pre-deploy Command**
   - 최소화 또는 비우기
   - 복잡한 명령어가 있다면 간소화

3. **서버 안정성 모니터링**
   - Logs 탭에서 Keep-alive 메시지 확인
   - 크래시 없이 계속 실행되는지 확인

## 현재 설정 요약

### ✅ 잘 설정된 항목
- Healthcheck Path: `/api/health` ✅
- Healthcheck Timeout: `60` ✅
- Restart Policy: `Never` ✅
- Serverless: `OFF` ✅

### ⚠️ 확인 필요한 항목
- Resource Limits (CPU, Memory)
- Pre-deploy Command
- 서버 안정성 (모니터링)

## 다음 단계

1. **Resource Limits 확인 및 조정**
   - Deploy 섹션에서 확인
   - 4 vCPU / 4-8 GB로 설정

2. **서버 안정성 확인**
   - Logs 탭에서 Keep-alive 메시지 확인
   - 1시간 이상 안정적으로 실행되는지 확인

3. **모니터링**
   - Metrics 탭에서 메모리/CPU 사용률 확인
   - 정상 범위 내인지 확인

