# Railway 다운그레이드 후 크래시 해결 가이드

## 문제 상황

리소스를 다운그레이드하자마자 크래시가 발생:
- 서버는 정상적으로 시작됨
- 초기화 완료
- "Server is ready" 메시지 출력
- 그 후 갑자기 컨테이너 종료

## 원인 분석

### 1. 리소스 부족 가능성

**확인할 사항:**
- Railway Dashboard → Metrics 탭
- 메모리 사용률 확인
- CPU 사용률 확인

**다운그레이드 시 문제:**
- 메모리: 8GB → 2GB 또는 4GB로 줄였을 경우
- CPU: 4 vCPU → 2 vCPU로 줄였을 경우
- 실제 사용량이 설정한 리소스를 초과할 수 있음

### 2. Health Check 타임아웃

**확인할 사항:**
- Railway Dashboard → Settings → Deploy
- Health Check 설정 확인
- Health Check가 응답하지 못할 수 있음

## 즉시 해결 방법

### 1단계: 리소스 다시 증가 (가장 중요!)

**Railway Dashboard에서:**
1. Settings → Deploy 섹션
2. Resource Limits:
   - **CPU**: 최소 **2 vCPU** (2 vCPU 이상)
   - **Memory**: 최소 **4 GB** (4 GB 이상)

**권장 설정:**
```
CPU: 2-4 vCPU
Memory: 4-8 GB
```

### 2단계: Health Check 설정 확인

**Railway Dashboard → Settings → Deploy:**
- Healthcheck Path: `/api/health`
- Healthcheck Timeout: `60` (초)
- Healthcheck Interval: `120` (초)

### 3단계: Restart Policy 확인

**Railway Dashboard → Settings:**
- Restart Policy: `Never` (또는 `Off`)

## 단계별 리소스 조정 전략

### 안전한 다운그레이드 방법

```
1단계: 현재 (4 vCPU / 8 GB) - 안정적
    ↓
2단계: 약간 감소 (4 vCPU / 4 GB) - 테스트
    ↓
3단계: 1주일 모니터링
    ↓
4단계: 문제없으면 더 감소 (2 vCPU / 4 GB)
```

### 권장 최소 리소스

**현재 사용량 기준:**
- 메모리: ~150-180MB 실제 사용
- **안전 마진 포함: 4 GB 권장**

**이유:**
- 기본 메모리: 150MB
- 100명 동시 사용자: +800MB = 950MB
- 200명 동시 사용자: +1.6GB = 1.75GB
- **4 GB는 안전한 최소값**

## 임시 해결 (즉시 적용)

### 옵션 1: 리소스 다시 증가
```
CPU: 4 vCPU
Memory: 8 GB
```
- 가장 안전하고 확실한 방법
- 비용은 증가하지만 안정성 확보

### 옵션 2: 중간 설정
```
CPU: 4 vCPU
Memory: 4 GB
```
- 절반만 증가
- 비용 절감하면서 안정성 확보

### 옵션 3: 최소 설정
```
CPU: 2 vCPU
Memory: 4 GB
```
- 최소 안전 설정
- 모니터링 필요

## 확인해야 할 사항

### Railway Dashboard 확인

1. **Metrics 탭**
   - 메모리 사용률 확인
   - CPU 사용률 확인
   - 피크 시간대 확인

2. **Logs 탭**
   - "Stopping Container" 메시지 전후 로그
   - 메모리 부족 에러 확인
   - OOM (Out of Memory) 에러 확인

3. **Settings → Deploy**
   - 현재 리소스 설정 확인
   - Health Check 설정 확인

## 근본 원인 확인

### 메모리 부족 확인

로그에서 다음 메시지 확인:
```
- "Out of memory"
- "Memory limit exceeded"
- "OOM"
- "killed"
```

### Health Check 실패 확인

```
- "Health check failed"
- "Health check timeout"
- "Application failed to respond"
```

## 권장 조치 순서

### 즉시 (5분 이내)

1. ✅ **리소스 다시 증가**
   - CPU: 4 vCPU
   - Memory: 4-8 GB

2. ✅ **Railway Dashboard에서 재배포**
   - Settings → Redeploy

### 단기 (1일 이내)

3. ✅ **Metrics 모니터링**
   - 실제 메모리/CPU 사용률 확인
   - 피크 시간대 확인

4. ✅ **로그 분석**
   - 크래시 원인 로그 확인
   - 메모리 부족 또는 Health Check 실패 확인

### 중기 (1주일 이내)

5. ✅ **점진적 다운그레이드**
   - 리소스를 단계적으로 감소
   - 각 단계마다 1주일 모니터링

## 결론

**현재 상황:**
- 리소스 다운그레이드 후 크래시 발생
- 서버는 시작되지만 즉시 종료

**즉시 조치:**
1. **리소스를 4 vCPU / 4 GB 이상으로 증가**
2. **모니터링 후 점진적으로 감소**

**권장 설정:**
- **최소 안전값: 2 vCPU / 4 GB**
- **현재 권장값: 4 vCPU / 4-8 GB**

리소스를 너무 낮게 설정하면 서버가 시작은 되지만 실행 중에 리소스 부족으로 종료될 수 있습니다.

