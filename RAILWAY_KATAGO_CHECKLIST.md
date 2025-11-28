# Railway KataGo 설정 체크리스트

## ✅ 준비해야 할 사항

### 1️⃣ KataGo Linux CPU-only Binary

**옵션 A: 수동 다운로드 후 프로젝트에 포함 (권장하지 않음 - 파일 크기 문제)**
- [ ] KataGo 릴리즈 페이지에서 Linux CPU-only 버전 다운로드
  - URL: https://github.com/lightvector/katago/releases
  - 예: `katago-v1.16.4-eigen-linux-x64.zip` (eigen = CPU-only 버전)
- [ ] 압축 해제 후 `katago` 실행 파일을 `katago/` 폴더에 복사
- [ ] Git에 커밋 (단, 파일 크기가 100MB 이하여야 함)

**옵션 B: Railway 시작 시 자동 다운로드 (권장) ✅ 구현 완료**
- [x] `scripts/download-katago-linux.sh` 스크립트 작성 완료
- [x] `package.json`에 `railway:setup-katago` 스크립트 추가 완료
- [x] `railway.json`의 `startCommand` 수정 완료

### 2️⃣ 모델 파일 자동 다운로드 ✅ 구현 완료

- [x] 모델 파일 다운로드 로직이 `server/kataGoService.ts`에 이미 구현되어 있음
- [x] `scripts/download-katago-model.sh` 스크립트 추가 완료
- [x] Railway 시작 시 자동 다운로드되도록 설정 완료

### 3️⃣ 코드 수정 ✅ 완료

- [x] `server/kataGoService.ts`에서 Railway Linux 환경 감지 로직 추가
- [x] Linux 경로 우선순위 조정 (`katago` vs `katago.exe`)
- [x] Railway 표준 경로 `/app/katago/katago` 추가

### 4️⃣ Railway 환경 변수 설정 (선택사항)

다음 환경 변수는 **선택사항**입니다. 코드에서 자동으로 경로를 찾으므로 설정하지 않아도 됩니다.

설정하려면 Railway Dashboard → Variables에서:
```
KATAGO_PATH=/app/katago/katago
KATAGO_MODEL_PATH=/app/katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
KATAGO_HOME_PATH=/app/server/katago_home
```

### 5️⃣ Railway Start Command ✅ 완료

- [x] `railway.json`의 `startCommand`가 `npm run railway:start`로 설정됨
- [x] `railway:start` 스크립트가 KataGo 다운로드 후 서버 시작

## 🚀 배포 후 확인 사항

1. **Railway 로그 확인**
   - KataGo binary 다운로드 성공 여부
   - 모델 파일 다운로드 성공 여부
   - KataGo 프로세스 시작 성공 여부

2. **KataGo 작동 테스트**
   - 싱글플레이어 게임에서 계가 기능 테스트
   - KataGo 분석 요청이 정상적으로 처리되는지 확인

3. **에러 발생 시 확인**
   - Railway 로그에서 KataGo 관련 에러 확인
   - 다운로드 실패 시 네트워크 문제 확인
   - 실행 권한 문제 확인 (`chmod +x`)

## 📝 참고사항

1. **파일 크기 제한**: GitHub에 큰 파일을 커밋하면 문제가 될 수 있으므로, 시작 시 다운로드하는 방식을 권장합니다.

2. **다운로드 시간**: 모델 파일은 약 500MB이므로 다운로드에 시간이 걸릴 수 있습니다. 첫 시작 시 약 1-2분 정도 소요될 수 있습니다.

3. **에러 처리**: KataGo 다운로드가 실패해도 서버는 계속 실행됩니다. 다만 계가 기능은 사용할 수 없습니다.

4. **캐싱**: Railway의 파일 시스템은 ephemeral이지만, 같은 컨테이너 내에서는 다운로드한 파일이 유지됩니다.

## 🔧 문제 해결

### KataGo binary를 찾을 수 없는 경우
- Railway 로그에서 다운로드 스크립트 실행 여부 확인
- `KATAGO_PATH` 환경 변수로 명시적 경로 설정

### 모델 파일을 찾을 수 없는 경우
- 모델 파일 다운로드 로그 확인
- 네트워크 연결 문제 확인
- `KATAGO_MODEL_PATH` 환경 변수로 명시적 경로 설정

### 실행 권한 문제
- `chmod +x` 명령이 제대로 실행되었는지 확인
- 스크립트에서 실행 권한 부여 로직 확인

