# Railway 크래시 루프 해결 가이드

## 문제 상황
- 서버가 정상적으로 시작되고 실행 중
- 에러 메시지 없음
- 메모리 사용량 정상 (156-183MB)
- 하지만 Railway가 계속 컨테이너를 재시작함

## Railway Dashboard에서 확인해야 할 사항

### 1. 자동 재배포 비활성화
1. Railway Dashboard 접속
2. 프로젝트 선택
3. **Sudam1** 서비스 선택
4. **Settings** 탭
5. **Deployments** 섹션에서:
   - **Auto Deploy** 확인
   - 필요시 일시적으로 **비활성화**하여 테스트

### 2. 재시작 정책 확인
1. **Settings** → **Deployments**
2. **Restart Policy** 확인:
   - "On Failure" 또는 "Always"로 설정되어 있으면 "Never"로 변경
   - 또는 Railway Dashboard에서 직접 설정 확인

### 3. 헬스체크 설정 확인
1. **Settings** → **Health Check**
2. 헬스체크가 활성화되어 있으면:
   - **비활성화** 또는
   - **Path**: `/api/health`
   - **Timeout**: 60초 이상
   - **Interval**: 120초 이상

### 4. 서비스 일시 중지 후 재시작
1. **Settings** → **Service**
2. **Pause** 클릭 (일시 중지)
3. 몇 초 후 **Resume** 클릭 (재시작)

### 5. 메모리 및 리소스 확인
1. **Metrics** 탭에서:
   - 메모리 사용량 확인
   - CPU 사용량 확인
   - Railway 메모리 제한 초과 여부 확인

## 코드 레벨 해결책 (이미 적용됨)
- ✅ `watchPatterns` 제거 (자동 재배포 방지)
- ✅ `restartPolicyType: "NEVER"` 설정
- ✅ 헬스체크 항상 200 반환
- ✅ 프로세스 종료 감지 및 로깅
- ✅ Keep-alive 메커니즘 추가

## Railway Dashboard에서 직접 확인할 필수 사항
Railway Dashboard → Sudam1 → Settings에서:
1. **Auto Deploy** 비활성화 (일시적으로)
2. **Restart Policy** 확인 및 "Never"로 설정
3. **Health Check** 비활성화 또는 매우 관대한 설정
4. 서비스 **Pause/Resume**하여 재시작

## 다음 단계
1. Railway Dashboard에서 위 설정 확인
2. 로그에서 "Stopping Container" 직전의 메시지 확인
3. Railway Metrics에서 리소스 사용량 확인

