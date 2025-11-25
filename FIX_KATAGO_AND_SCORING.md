# KataGo 설치 및 계가 문제 해결

## 문제 분석

### 1. KataGo 모델 다운로드 실패
이전 배포 로그에서:
```
[KataGo] Model file not found and download failed. Tried paths:
Download error: HTTP 403
```

### 2. 계가 진행 안 됨
- 계가는 `getGameResult` 함수에서 KataGo 분석을 수행
- KataGo가 초기화되지 않으면 계가가 진행되지 않음

## 해결 방법

### 방법 1: KataGo HTTP API 사용 (권장)

Railway에서 KataGo 모델 다운로드가 실패할 수 있으므로, 별도의 KataGo HTTP API를 사용하는 것이 안정적입니다.

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `KATAGO_API_URL` 설정:
   ```
   https://katago-api.yourdomain.com/api/analyze
   ```
   또는 배포된 KataGo API URL

3. 서비스 재시작

### 방법 2: KataGo 모델 수동 다운로드

Dockerfile에서 모델 다운로드가 실패하는 경우:

1. 로컬에서 모델 다운로드:
   ```bash
   wget https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
   ```

2. 프로젝트에 포함:
   - `katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz` 파일 추가
   - Git에 커밋 (파일 크기가 크므로 Git LFS 사용 권장)

3. Dockerfile 수정하여 로컬 파일 사용

### 방법 3: Railway 환경 변수 확인

Railway Dashboard → Sudam1 → Variables에서:
- `KATAGO_PATH`: `/app/katago/katago`
- `KATAGO_MODEL_PATH`: `/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz`
- `KATAGO_HOME_PATH`: `/app/server/katago_home`

이 값들이 올바르게 설정되어 있는지 확인

### 방법 4: KataGo 초기화 로그 확인

Railway Dashboard → Sudam1 → Logs에서:
- `[KataGo] Engine found at:` 메시지 확인
- `[KataGo] Model file not found` 오류 확인
- `[KataGo] Engine ready` 메시지 확인

## 계가 문제 해결

### 계가가 진행되지 않는 원인

1. **KataGo 초기화 실패**
   - 모델 파일이 없으면 KataGo가 시작되지 않음
   - `analyzeGame` 함수가 실패하면 계가가 진행되지 않음

2. **게임 상태 문제**
   - `gameStatus`가 `scoring`으로 변경되지 않음
   - `getGameResult` 함수가 호출되지 않음

### 확인 방법

Railway Dashboard → Sudam1 → Logs에서:
- `[getGameResult] Starting KataGo analysis` 메시지 확인
- `[KataGo] Query` 메시지 확인
- `[getGameResult] KataGo analysis completed` 메시지 확인

## 빠른 해결 (임시)

KataGo가 작동하지 않으면 계가가 진행되지 않습니다. 

**임시 해결책**: KataGo HTTP API를 사용하거나, 모델 파일을 수동으로 제공해야 합니다.

## 권장 해결 순서

1. **Railway Logs 확인**: KataGo 초기화 상태 확인
2. **KataGo HTTP API 설정**: 별도 서버에서 KataGo 실행
3. **또는 모델 파일 수동 제공**: 프로젝트에 포함

