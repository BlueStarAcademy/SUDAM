# 로컬 KataGo 설정 가이드

## 현재 상태

✅ **데이터베이스 연결 성공**
- Railway Postgres 연결 완료
- `[DB] Database initialized successfully`

⚠️ **KataGo 설정 수정됨**
- `KATAGO_API_URL`을 주석 처리하여 로컬 KataGo 프로세스 사용하도록 변경

## KataGo 설정 설명

### 로컬 개발 환경
로컬에서 개발할 때는 로컬에 설치된 KataGo 바이너리를 직접 사용합니다.

**.env 파일 설정:**
```env
# KATAGO_API_URL=  # 로컬에서는 비워두면 로컬 KataGo 프로세스 사용
```

또는:
```env
KATAGO_API_URL=
```

### 배포 환경 (Railway)
Railway에서는 HTTP API를 통해 KataGo를 사용할 수 있습니다.

**Railway 환경 변수:**
```env
KATAGO_API_URL=  # 빈 문자열로 설정하면 로컬 KataGo 프로세스 사용
```

또는:
```env
KATAGO_API_URL=https://your-deployed-site.com/api/katago/analyze
```

## 로컬 KataGo 파일 확인

로컬에서 KataGo가 작동하려면 다음 파일들이 필요합니다:

1. **KataGo 바이너리:**
   - Windows: `katago/katago.exe`
   - Linux/Mac: `katago/katago`

2. **KataGo 모델 파일:**
   - `katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz`

## KataGo 경로 확인

서버 시작 시 KataGo 경로가 로그에 표시됩니다:
- `KATAGO_PATH`: KataGo 바이너리 경로
- `MODEL_PATH`: 모델 파일 경로

## 문제 해결

### KataGo를 찾을 수 없는 경우
1. `katago/` 디렉토리에 KataGo 바이너리가 있는지 확인
2. `.env` 파일에 `KATAGO_PATH` 설정:
   ```env
   KATAGO_PATH=C:/path/to/katago/katago.exe
   ```

### 모델 파일을 찾을 수 없는 경우
1. `katago/` 디렉토리에 모델 파일이 있는지 확인
2. `.env` 파일에 `KATAGO_MODEL_PATH` 설정:
   ```env
   KATAGO_MODEL_PATH=C:/path/to/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
   ```

## 다음 단계

1. 서버 재시작:
   ```bash
   npm start
   ```

2. KataGo 초기화 확인:
   - 서버 로그에서 KataGo 초기화 메시지 확인
   - `[KataGo] Initialization check` 메시지 확인

3. 게임에서 KataGo 분석 테스트:
   - 바둑 게임 시작
   - AI 수 분석이 정상 작동하는지 확인

