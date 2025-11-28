# Railway Dashboard 설정 가이드

## Deploy 섹션에서 설정할 항목

### 1. Restart Policy (재시작 정책)
- **항목 이름**: "Restart Policy" 또는 "Auto Restart"
- **설정 값**: `Never` 또는 `OFF` 선택
- **목적**: 자동 재시작 비활성화

### 2. Health Check (헬스 체크)

#### A. Health Check Path (헬스 체크 경로)
- **항목 이름**: "Health Check Path" 또는 "Healthcheck Path"
- **입력 값**: `/api/health`
- **설명**: 서버 상태 확인 엔드포인트

#### B. Health Check Timeout (타임아웃)
- **항목 이름**: "Health Check Timeout" 또는 "Timeout"
- **입력 값**: `60` (초)
- **설명**: 헬스 체크 응답 대기 시간

#### C. Health Check Interval (간격)
- **항목 이름**: "Health Check Interval" 또는 "Interval"
- **입력 값**: `120` (초)
- **설명**: 헬스 체크 수행 간격

#### D. Restart Policy Max Retries (최대 재시도 횟수)
- **항목 이름**: "Max Retries" 또는 "Restart Policy Max Retries"
- **입력 값**: `0` 또는 `3`
- **설명**: 헬스 체크 실패 시 재시도 횟수

## UI에 따라 다를 수 있는 항목 이름

- "Restart Policy" = "Auto Restart" = "Restart on Failure"
- "Health Check Path" = "Healthcheck Path" = "Health Endpoint"
- "Health Check Timeout" = "Timeout" = "Healthcheck Timeout"
- "Health Check Interval" = "Interval" = "Healthcheck Interval"

## 설정이 보이지 않는 경우

1. **"Deploy" 섹션을 찾을 수 없음**
   - Settings 페이지 오른쪽 메뉴에서 "Deploy" 클릭
   - 또는 페이지를 아래로 스크롤

2. **Health Check 설정이 없음**
   - Railway의 일부 플랜에서는 Health Check 설정이 없을 수 있습니다
   - 이 경우 `railway.json` 파일의 설정이 우선 적용됩니다

3. **설정을 저장하는 방법**
   - 변경 후 자동 저장되거나
   - "Save" 또는 "Update" 버튼 클릭
