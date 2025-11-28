# Railway KataGo 설정 요약

## 🎯 목표
Railway 배포 환경에서 KataGo CPU-only 버전을 사용하여 계가 기능을 정상 작동시키기

## ✅ 구현 완료 사항

### 1. 코드 수정
- ✅ `server/kataGoService.ts`: Railway Linux 환경 감지 및 경로 우선순위 조정
- ✅ Linux 경로 (`katago`) 우선 사용, Windows 경로 (`katago.exe`)는 Windows 환경에서만 사용
- ✅ Railway 표준 경로 `/app/katago/katago` 추가

### 2. 다운로드 스크립트
- ✅ `scripts/download-katago-linux.sh`: KataGo Linux CPU-only binary 다운로드
- ✅ `scripts/download-katago-model.sh`: KataGo 모델 파일 다운로드

### 3. Railway 설정
- ✅ `package.json`: `railway:setup-katago` 및 `railway:start` 스크립트 추가
- ✅ `railway.json`: `startCommand`를 `npm run railway:start`로 변경

### 4. 문서
- ✅ `RAILWAY_KATAGO_SETUP.md`: 상세 설정 가이드
- ✅ `RAILWAY_KATAGO_CHECKLIST.md`: 체크리스트

## 📋 사용자가 해야 할 일

### 필수 작업: 없음 ✅
모든 설정이 자동화되어 있습니다. Railway에 배포하면 자동으로:
1. KataGo Linux CPU-only binary 다운로드
2. 모델 파일 다운로드
3. 서버 시작

### 선택 작업: 환경 변수 설정 (선택사항)
Railway Dashboard → Variables에서 다음을 설정할 수 있습니다 (설정하지 않아도 자동으로 경로를 찾습니다):

```
KATAGO_PATH=/app/katago/katago
KATAGO_MODEL_PATH=/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
KATAGO_HOME_PATH=/app/server/katago_home
```

## 🚀 배포 후 확인

1. **Railway 로그 확인**
   ```
   [KataGo] Downloading KataGo Linux CPU-only binary...
   [KataGo] Successfully downloaded and installed KataGo...
   [KataGo] Downloading KataGo model file...
   [KataGo] Successfully downloaded model file...
   ```

2. **KataGo 작동 테스트**
   - 싱글플레이어 게임에서 계가 기능 테스트
   - 게임 종료 시 정상적으로 점수가 계산되는지 확인

## ⚠️ 주의사항

1. **첫 배포 시 다운로드 시간**: 모델 파일(약 500MB) 다운로드로 1-2분 소요될 수 있습니다.

2. **에러 처리**: KataGo 다운로드가 실패해도 서버는 계속 실행됩니다. 다만 계가 기능은 사용할 수 없고, 자체 계가 프로그램(`scoringService.ts`)이 fallback으로 작동합니다.

3. **파일 시스템**: Railway의 파일 시스템은 ephemeral이지만, 같은 컨테이너 내에서는 다운로드한 파일이 유지됩니다.

## 🔧 문제 해결

### KataGo를 찾을 수 없는 경우
- Railway 로그에서 다운로드 스크립트 실행 여부 확인
- `KATAGO_PATH` 환경 변수로 명시적 경로 설정

### 모델 파일을 찾을 수 없는 경우
- 모델 파일 다운로드 로그 확인
- `KATAGO_MODEL_PATH` 환경 변수로 명시적 경로 설정

### 실행 권한 문제
- 스크립트에서 자동으로 `chmod +x` 실행
- 문제가 지속되면 Railway 로그 확인

## 📝 참고

- KataGo 릴리즈: https://github.com/lightvector/katago/releases
- 모델 파일: https://media.katagotraining.org/uploaded/models/
- 자체 계가 프로그램: `server/scoringService.ts` (KataGo 실패 시 fallback)

