# KataGo 설치 및 계가 문제 해결 가이드

## 문제 분석

### 1. KataGo 모델 다운로드 실패
배포 로그에서:
```
[KataGo] Model file not found and download failed
Download error: HTTP 403
```

### 2. 계가 진행 안 됨
- 계가는 `getGameResult` → `analyzeGame` → KataGo 분석 필요
- KataGo가 초기화되지 않으면 계가가 진행되지 않음

## 해결 방법

### 방법 1: KataGo HTTP API 사용 (가장 빠른 해결)

Railway에서 KataGo 모델 다운로드가 실패하므로, 별도의 KataGo HTTP API를 사용:

1. **Railway Dashboard** → **Sudam1** → **Variables**
2. `KATAGO_API_URL` 추가/수정:
   ```
   https://katago-api.yourdomain.com/api/analyze
   ```
   또는 배포된 KataGo API URL

3. 서비스 재시작

**장점**: 모델 다운로드 불필요, 안정적

### 방법 2: Railway Logs에서 KataGo 상태 확인

Railway Dashboard → Sudam1 → Logs에서 확인:

✅ **정상:**
```
[KataGo] Engine found at: /app/katago/katago
[KataGo] Model downloaded successfully
[KataGo] Engine ready. Local process initialized successfully.
```

❌ **문제:**
```
[KataGo] Model file not found and download failed
[KataGo] Failed to start engine during initialization
```

### 방법 3: Dockerfile에서 모델 다운로드 수정

현재 Dockerfile에서 모델 다운로드가 실패하는 경우, 다른 URL이나 방법 시도:

```dockerfile
# Dockerfile.backend 수정
# 모델 다운로드 부분을 수정하거나
# 모델을 프로젝트에 포함
```

### 방법 4: Railway 환경 변수 확인

Railway Dashboard → Sudam1 → Variables에서:
- `KATAGO_PATH`: `/app/katago/katago` ✅
- `KATAGO_MODEL_PATH`: `/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz`
- `KATAGO_HOME_PATH`: `/app/server/katago_home`

## 계가 문제 해결

### 계가가 진행되지 않는 원인

1. **KataGo 초기화 실패**
   - 모델 파일이 없으면 KataGo가 시작되지 않음
   - `analyzeGame` 함수가 실패하면 계가가 진행되지 않음

2. **게임 상태 문제**
   - `gameStatus`가 `scoring`으로 변경되지 않음
   - `getGameResult` 함수가 호출되지 않음

### 확인 방법

Railway Dashboard → Sudam1 → Logs에서 다음 메시지 확인:

**계가 시작:**
```
[getGameResult] Starting KataGo analysis for game ...
```

**KataGo 분석:**
```
[KataGo] Query ... 
[KataGo HTTP] Sending analysis query to ...
```

**계가 완료:**
```
[getGameResult] KataGo analysis completed for game ...
```

## 즉시 해결 (권장)

**KataGo HTTP API 사용:**

1. Railway Dashboard → Sudam1 → Variables
2. `KATAGO_API_URL` 설정 (또는 수정)
3. 값: 배포된 KataGo API URL
4. 서비스 재시작

이렇게 하면 모델 다운로드 문제를 우회할 수 있습니다.

## 임시 해결책

KataGo가 작동하지 않으면 계가가 진행되지 않습니다. 

**옵션:**
1. KataGo HTTP API 사용 (권장)
2. 모델 파일을 프로젝트에 포함 (Git LFS 사용)
3. Railway에서 모델 다운로드 재시도

## 다음 단계

1. Railway Logs에서 KataGo 초기화 상태 확인
2. `KATAGO_API_URL` 설정 또는 모델 파일 제공
3. 서비스 재시작 후 계가 테스트

