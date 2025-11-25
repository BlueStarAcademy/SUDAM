# KataGo 계가 타임아웃 문제 해결

## 문제 증상

계가가 10분 넘게 진행되지 않거나 타임아웃이 발생합니다.

## 원인 분석

### 1. KataGo API URL 설정 문제

현재 `KATAGO_API_URL`이 `http://localhost:4000/api/katago/analyze`로 설정되어 있습니다:
- 이것은 자기 자신을 호출하는 무한 루프를 만들 수 있습니다
- Railway 배포 환경에서는 로컬 프로세스를 직접 사용하는 것이 더 안정적입니다

### 2. 타임아웃 설정

- 로컬 프로세스: 60초 타임아웃
- HTTP API: 120초 타임아웃
- 계가 분석은 복잡한 보드 상태에서 더 많은 시간이 필요할 수 있습니다

## 해결 방법

### 방법 1: 로컬 프로세스 사용 (권장)

Railway에서 KataGo를 로컬 프로세스로 실행:

1. **KATAGO_API_URL 제거**:
   ```powershell
   railway variables --unset KATAGO_API_URL
   ```

2. **KataGo 경로 확인**:
   - `KATAGO_PATH`: `/app/katago/katago`
   - `KATAGO_MODEL_PATH`: `/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz`
   - `KATAGO_HOME_PATH`: `/app/server/katago_home`

3. **Dockerfile 확인**:
   - KataGo 바이너리와 모델이 올바르게 복사되었는지 확인
   - `Dockerfile.backend`에서 KataGo 다운로드 및 복사 확인

### 방법 2: HTTP API 사용 (별도 서버)

별도의 KataGo 서버를 운영하는 경우:

1. **KATAGO_API_URL 설정**:
   ```powershell
   railway variables --set "KATAGO_API_URL=https://katago-api.yourdomain.com/api/analyze"
   ```
   > **중요**: `localhost`가 아닌 공개 URL을 사용해야 합니다

2. **타임아웃 증가**:
   - HTTP API 타임아웃은 현재 120초로 설정되어 있습니다
   - 더 복잡한 분석이 필요한 경우 코드에서 타임아웃을 증가시킬 수 있습니다

### 방법 3: 타임아웃 증가

계가 분석에 더 많은 시간이 필요한 경우:

1. **로컬 프로세스 타임아웃 증가**:
   `server/kataGoService.ts`의 `query` 메서드에서:
   ```typescript
   const timeout = setTimeout(() => {
       // ...
   }, 120000); // 60초 → 120초로 증가
   ```

2. **HTTP API 타임아웃 증가**:
   `server/kataGoService.ts`의 `queryKataGoViaHttp` 함수에서:
   ```typescript
   timeout: 300000 // 120초 → 300초(5분)로 증가
   ```

## 확인 방법

### Railway 로그 확인

Railway Dashboard → Sudam1 → Logs에서 다음 메시지 확인:

1. **KataGo 초기화**:
   ```
   [KataGo] Initialization check: IS_LOCAL=false, USE_HTTP_API=false, KATAGO_API_URL=not set
   [KataGo] Attempting to initialize local KataGo process...
   [KataGo] Engine ready. Local process initialized successfully.
   ```

2. **계가 시작**:
   ```
   [getGameResult] Starting KataGo analysis for game ...
   [KataGo] Starting analysis query for game ...
   ```

3. **계가 완료**:
   ```
   [KataGo] Analysis query completed for game ...
   [getGameResult] KataGo analysis completed for game ...
   ```

4. **타임아웃 에러**:
   ```
   [KataGo] Query ... timed out after 60 seconds.
   [KataGo HTTP] Request timeout for queryId=...
   ```

### KataGo 파일 확인

Railway 컨테이너에서 KataGo 파일 확인:
```bash
railway run ls -la /app/katago/
```

다음 파일들이 있어야 합니다:
- `katago` (실행 파일)
- `kata1-b28c512nbt-s9853922560-d5031756885.bin.gz` (모델 파일)

## 현재 설정 확인

```powershell
# Railway 환경 변수 확인
railway variables | findstr KATAGO
```

## 권장 해결 순서

1. **KATAGO_API_URL 제거** (로컬 프로세스 사용)
2. **Railway 로그 확인** (KataGo 초기화 성공 여부)
3. **타임아웃 증가** (필요한 경우)
4. **KataGo 파일 확인** (바이너리 및 모델 존재 여부)

## 추가 참고

- KataGo 모델 파일은 약 500MB 이상의 큰 파일입니다
- Railway 빌드 시 모델 다운로드가 실패할 수 있으므로 Dockerfile에서 확인 필요
- 로컬 프로세스 사용 시 메모리 사용량이 증가할 수 있습니다

