# 서비스 로그 확인 가이드

## 빌드 상태
✅ 빌드는 성공했습니다 (24.91초)
- KataGo 바이너리: cached (이미 다운로드됨)
- KataGo 모델: cached (이미 다운로드됨 또는 다운로드 실패했을 수 있음)

## 확인해야 할 사항

### 1. 서비스 시작 로그 확인

Railway Dashboard → Sudam1 → **Logs**에서 다음을 확인:

**DATABASE_URL 확인:**
```
[Server Startup] DATABASE_URL check: Set (length: ...) or NOT SET
```

**KataGo 초기화:**
```
[KataGo] Initialization check: ...
[KataGo] Engine found at: ...
[KataGo] Model downloaded successfully
또는
[KataGo] Model file not found and download failed
```

**데이터베이스 연결:**
```
[DB] Database initialized successfully
또는
Error validating datasource `db`: You must provide a nonempty URL
```

### 2. KataGo 모델 확인

빌드 로그에서 모델 다운로드가 "cached"로 표시되었는데, 실제로는 다운로드가 실패했을 수 있습니다.

서비스 로그에서 확인:
- `[KataGo] Model downloaded successfully` ✅
- `[KataGo] Model file not found` ❌

### 3. 문제 해결 순서

1. **DATABASE_URL 문제 해결** (우선)
   - 로그에서 `[Server Startup] DATABASE_URL check` 확인
   - `NOT SET`이면 Railway Variables 확인

2. **KataGo 모델 문제 해결** (다음)
   - 모델이 없으면 HTTP API 사용 또는 모델 수동 제공

## 다음 단계

Railway Dashboard → Sudam1 → Logs에서:
1. `[Server Startup] DATABASE_URL check` 메시지 확인
2. `[KataGo]` 관련 메시지 확인
3. 오류 메시지 확인

로그 내용을 알려주시면 더 구체적으로 도와드리겠습니다.

