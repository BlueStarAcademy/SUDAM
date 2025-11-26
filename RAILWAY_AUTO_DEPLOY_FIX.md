# Railway 자동 배포 문제 해결 가이드

## 자동 배포가 되지 않는 주요 원인

### 1. GitHub 연동 문제
Railway 프로젝트가 GitHub 저장소와 연결되어 있지 않을 수 있습니다.

**확인 방법:**
1. Railway Dashboard 접속
2. 프로젝트 선택
3. **Settings** → **Source** 확인
4. GitHub 저장소가 연결되어 있는지 확인

**해결 방법:**
1. **Settings** → **Source** 클릭
2. **Connect GitHub** 클릭
3. 저장소 선택 및 연결
4. 브랜치 선택 (보통 `main`)

### 2. 서비스 비활성화
Railway 서비스가 일시 중지되었을 수 있습니다.

**확인 방법:**
1. Railway Dashboard → 프로젝트 선택
2. **Sudam1** 서비스 확인
3. 서비스 상태 확인 (Active/Inactive)

**해결 방법:**
- 서비스가 Inactive면 **Settings** → **Service** → **Activate** 클릭

### 3. 배포 트리거 설정
자동 배포가 비활성화되어 있을 수 있습니다.

**확인 방법:**
1. Railway Dashboard → 프로젝트 선택
2. **Settings** → **Deployments** 확인
3. **Auto Deploy** 옵션이 활성화되어 있는지 확인

**해결 방법:**
- **Auto Deploy** 옵션 활성화
- **Branch** 설정 확인 (보통 `main`)

### 4. Railway CLI로 수동 배포
자동 배포가 작동하지 않으면 수동으로 배포할 수 있습니다.

```bash
# Railway에 로그인
railway login

# 프로젝트 연결
railway link

# 수동 배포
railway up
```

### 5. Railway Dashboard에서 수동 배포
1. Railway Dashboard 접속
2. 프로젝트 선택
3. **Sudam1** 서비스 선택
4. **Deployments** 탭 클릭
5. **Deploy** 버튼 클릭
6. 최신 커밋 선택 후 배포

## 확인 체크리스트

- [ ] Railway 프로젝트가 GitHub 저장소와 연결되어 있는가?
- [ ] 서비스가 Active 상태인가?
- [ ] Auto Deploy 옵션이 활성화되어 있는가?
- [ ] 올바른 브랜치(`main`)가 설정되어 있는가?
- [ ] Railway Dashboard에서 최신 커밋이 표시되는가?

## 문제 해결 순서

1. **Railway Dashboard 확인**
   - 프로젝트 → Settings → Source 확인
   - GitHub 연결 상태 확인

2. **서비스 상태 확인**
   - 서비스가 Active인지 확인
   - 필요시 활성화

3. **배포 설정 확인**
   - Auto Deploy 활성화 확인
   - 브랜치 설정 확인

4. **수동 배포 시도**
   - Railway CLI 사용: `railway up`
   - 또는 Dashboard에서 수동 배포

5. **로그 확인**
   - Railway Dashboard → Logs 탭
   - 배포 오류 메시지 확인

## Railway CLI로 배포 확인

```bash
# 현재 연결된 프로젝트 확인
railway status

# 최근 배포 내역 확인
railway logs

# 수동 배포
railway up
```

## 추가 참고사항

- Railway는 기본적으로 `main` 브랜치에 푸시하면 자동 배포됩니다
- `railway.json` 파일이 있으면 해당 설정을 사용합니다
- Dockerfile을 사용하는 경우 빌드 시간이 더 걸릴 수 있습니다

