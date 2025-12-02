# Railway Cron Schedule 제거 가이드

## 🚨 중요: Cron Schedule 제거 필요

### 현재 문제
- **Cron Schedule**: `0 1 * * *` 설정됨
- 이것이 서버가 24/7 실행되지 않는 주요 원인일 수 있습니다!

### 왜 문제인가?
- **Cron Schedule**은 특정 시간에만 작업을 실행하는 용도입니다
- 웹 서버는 **24/7 계속 실행**되어야 합니다
- Cron이 설정되어 있으면 Railway가 서버를 특정 시간에만 실행할 수 있습니다

## 즉시 조치: Cron Schedule 제거

### 1단계: Cron Schedule 찾기
Railway Dashboard → Sudam1 → Settings → Deploy 섹션에서:
- 아래로 스크롤하여 **"Cron Schedule"** 섹션 찾기

### 2단계: 값 삭제
- **Cron Schedule** 입력 필드에 있는 `0 1 * * *` 값을 **완전히 삭제**
- 입력 필드를 **비우기**

### 3단계: 저장
- 다른 설정 변경 사항이 있다면 확인
- **"Apply 3 changes"** 버튼 클릭
- 또는 **"Deploy ⇧+Enter"** 클릭

## 서버 내부 스케줄 작업은 그대로 유지

### 참고
- 서버 내부의 스케줄 작업 (`server/scheduledTasks.ts`)은 **그대로 유지**하세요
- 이것들은 서버가 24/7 실행 중일 때 서버 내부에서 자동으로 실행됩니다
- Railway의 Cron Schedule은 서버 자체를 스케줄링하는 것이므로 **제거**해야 합니다

## 수정 후 확인

1. **Cron Schedule**이 비어있는지 확인
2. 서버가 정상적으로 24/7 실행되는지 확인
3. Logs 탭에서 Keep-alive 메시지가 계속 나타나는지 확인

## 요약

### ❌ 제거해야 할 것
- **Cron Schedule**: `0 1 * * *` 삭제

### ✅ 유지할 것
- Resource Limits: 4 vCPU / 8 GB
- Healthcheck Path: `/api/health`
- Healthcheck Timeout: `60`
- Teardown: OFF
- Serverless: OFF
- 서버 내부 스케줄 작업 코드 (`server/scheduledTasks.ts`)

