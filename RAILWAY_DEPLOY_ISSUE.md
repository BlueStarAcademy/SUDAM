# Railway 자동 배포 문제 해결

## 문제 확인

Railway Dashboard에서 확인된 문제:

### 1. ⚠️ Limited Access 모드
**배너 메시지:**
> "Pausing Hobby deploys while build backlog processes"

**의미:**
- Railway가 Hobby 플랜의 배포를 일시 중지하고 있음
- 빌드 백로그 처리 중이므로 자동 배포가 비활성화됨
- 이는 Railway의 일시적인 제한 사항

### 2. 파일 크기 초과
**오류 메시지:**
> "File too large (236213640 bytes)" (약 236MB)

**원인:**
- Railway CLI로 업로드 시 전체 프로젝트를 압축하여 전송
- `node_modules`, `dist`, `katago` 등 대용량 디렉토리 포함
- Railway는 GitHub 연동을 통한 배포를 권장 (파일 크기 제한 없음)

## 해결 방법

### 방법 1: Railway Dashboard에서 수동 배포 (권장)

Railway는 GitHub와 연동되어 있으므로, Dashboard에서 수동으로 배포를 트리거할 수 있습니다:

1. **Railway Dashboard 접속**
   - https://railway.app/project/733d99ea-bda9-4a43-9ee0-4fa183304a5e

2. **Sudam1 서비스 선택**
   - 왼쪽 Architecture에서 "Sudam1" 클릭

3. **Deployments 탭 확인**
   - 최신 커밋이 표시되는지 확인
   - "배포 환경 성능 최적화" 커밋이 보이는지 확인

4. **수동 배포 트리거**
   - 최신 커밋 옆에 "Deploy" 버튼이 있으면 클릭
   - 또는 Settings → Source에서 "Redeploy" 클릭

### 방법 2: GitHub Webhook 재설정

1. Railway Dashboard → 프로젝트 → Settings → Source
2. GitHub 연결 확인
3. 필요시 연결 해제 후 재연결
4. 브랜치 설정 확인 (`main`)

### 방법 3: Limited Access 해제 대기

Railway의 빌드 백로그가 처리되면 자동으로 해제됩니다:
- 보통 몇 시간 내에 해제됨
- 해제되면 자동 배포가 재개됨

### 방법 4: Railway Pro 플랜 업그레이드 (선택사항)

Pro 플랜으로 업그레이드하면:
- Limited Access 제한 없음
- 더 빠른 빌드 및 배포
- 우선순위 처리

## 현재 상태

✅ **GitHub 연동 확인됨**
- "4 hours ago via GitHub" 메시지로 확인
- 최신 커밋이 GitHub에 푸시됨

⏳ **배포 대기 중**
- Limited Access로 인해 자동 배포 일시 중지
- Dashboard에서 수동 배포 가능

## 즉시 조치 사항

1. **Railway Dashboard에서 수동 배포 시도**
   - Deployments 탭에서 최신 커밋 확인
   - 수동 배포 버튼 클릭

2. **Limited Access 해제 대기**
   - 몇 시간 내에 자동 해제 예상
   - 해제 후 자동 배포 재개

3. **배포 확인**
   - Dashboard → Logs 탭에서 배포 진행 상황 확인
   - 배포 완료 후 서비스 테스트

## 참고사항

- Railway CLI의 `railway up`은 파일 크기 제한이 있어 실패할 수 있음
- GitHub 연동을 통한 배포는 파일 크기 제한이 없음
- Limited Access는 Railway의 일시적인 제한이며, 곧 해제될 예정

