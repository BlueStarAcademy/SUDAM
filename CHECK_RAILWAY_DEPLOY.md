# Railway 자동 배포 확인 및 해결 방법

## 현재 상태

✅ **Railway CLI 연결 확인됨**
- 프로젝트: `capable-harmony`
- 환경: `production`
- 서비스: `Sudam1`
- 로그인: `bsbaduk@naver.com`

## 자동 배포가 안 되는 주요 원인

### 1. GitHub 연동 문제 (가장 가능성 높음)

Railway 프로젝트가 GitHub 저장소와 연결되어 있지 않으면 자동 배포가 되지 않습니다.

**확인 방법:**
1. Railway Dashboard 접속: https://railway.app
2. 프로젝트 `capable-harmony` 선택
3. **Settings** 탭 클릭
4. **Source** 섹션 확인
   - GitHub 저장소가 연결되어 있는지 확인
   - 연결되어 있지 않으면 "Not connected" 표시

**해결 방법:**
1. **Settings** → **Source** 클릭
2. **Connect GitHub** 또는 **Connect Repository** 클릭
3. GitHub 인증 및 저장소 선택
4. 브랜치 선택: `main`
5. **Save** 클릭

### 2. Auto Deploy 비활성화

**확인 방법:**
1. Railway Dashboard → 프로젝트 선택
2. **Sudam1** 서비스 선택
3. **Settings** → **Deployments** 확인
4. **Auto Deploy** 옵션 확인

**해결 방법:**
- **Auto Deploy** 옵션 활성화
- **Branch** 설정: `main`

### 3. 서비스 일시 중지

**확인 방법:**
1. Railway Dashboard → 프로젝트 선택
2. **Sudam1** 서비스 확인
3. 서비스 상태 확인 (Active/Inactive)

**해결 방법:**
- 서비스가 Inactive면 활성화

## 수동 배포 방법

### 방법 1: Railway CLI 사용 (권장)

```bash
# 현재 디렉토리에서 배포
railway up
```

또는:

```bash
# 특정 서비스에 배포
railway up --service Sudam1
```

### 방법 2: Railway Dashboard 사용

1. Railway Dashboard 접속
2. 프로젝트 `capable-harmony` 선택
3. **Sudam1** 서비스 선택
4. **Deployments** 탭 클릭
5. **Deploy** 버튼 클릭
6. 최신 커밋 선택 후 배포

## 즉시 배포 실행

Railway CLI로 수동 배포를 실행할 수 있습니다:

```bash
railway up
```

이 명령은 현재 디렉토리의 코드를 Railway에 배포합니다.

## 배포 확인

배포 후 다음을 확인하세요:

1. **Railway Dashboard → Deployments**
   - 배포 상태 확인
   - 빌드 로그 확인

2. **Railway Dashboard → Logs**
   - 서버 로그 확인
   - 오류 메시지 확인

3. **서비스 URL 확인**
   - `https://sudam.up.railway.app` 접속
   - 기능 테스트

## 문제 해결 순서

1. ✅ Railway CLI 연결 확인 (완료)
2. ⏳ Railway Dashboard에서 GitHub 연동 확인
3. ⏳ Auto Deploy 설정 확인
4. ⏳ 필요시 수동 배포 실행

## 다음 단계

1. Railway Dashboard에서 GitHub 연동 확인
2. 연동이 안 되어 있으면 연결
3. 그래도 안 되면 `railway up` 명령으로 수동 배포

