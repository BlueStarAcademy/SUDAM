# Railway 자동 배포 문제 즉시 해결 가이드

## 현재 문제
- Git 푸시 후 자동 배포가 트리거되지 않음
- Railway Dashboard에서 배포가 시작되지 않음

## 즉시 확인할 사항

### 1. Railway Dashboard에서 확인
1. **Railway Dashboard 접속**: https://railway.app
2. 프로젝트 선택
3. **Sudam1** 서비스 선택
4. **Settings** 탭 확인

### 2. GitHub 연동 확인
**Settings → Source** 섹션에서:
- ✅ GitHub 저장소가 연결되어 있는지 확인
- ✅ 연결된 브랜치가 `main`인지 확인
- ❌ 연결이 안 되어 있으면 "Connect GitHub" 클릭

### 3. Auto Deploy 설정 확인
**Settings → Deployments** 섹션에서:
- ✅ **Auto Deploy** 옵션이 활성화되어 있는지 확인
- ✅ **Branch** 설정이 `main`인지 확인
- ❌ 비활성화되어 있으면 활성화

### 4. 서비스 상태 확인
- ✅ 서비스가 **Active** 상태인지 확인
- ❌ **Inactive**면 활성화 필요

## 즉시 해결 방법

### 방법 1: Railway Dashboard에서 수동 배포 (가장 빠름)

1. Railway Dashboard 접속
2. 프로젝트 → **Sudam1** 서비스 선택
3. **Deployments** 탭 클릭
4. 최신 커밋 확인:
   - "Fix login 502 crash: Add timeouts to all database operations and heavy tasks"
   - 또는 "Fix 502 login error: Add global error handler, improve error handling, and fix TypeScript errors"
5. 최신 커밋 옆 **"Deploy"** 버튼 클릭
6. 배포 시작 확인

### 방법 2: GitHub Webhook 재설정

1. Railway Dashboard → 프로젝트 → **Settings** → **Source**
2. GitHub 연결 확인
3. 연결이 안 되어 있으면:
   - **"Connect GitHub"** 클릭
   - GitHub 인증
   - 저장소 선택
   - 브랜치: `main` 선택
   - **Save**

### 방법 3: Railway CLI로 수동 배포

```bash
# Railway CLI 설치 확인
railway --version

# Railway 로그인
railway login

# 프로젝트 연결
railway link

# 수동 배포
railway up
```

### 방법 4: Source 재연결

1. Railway Dashboard → 프로젝트 → **Settings** → **Source**
2. **"Disconnect"** 클릭 (연결이 되어 있는 경우)
3. **"Connect GitHub"** 클릭
4. 저장소 재선택
5. 브랜치: `main` 선택
6. **Save**

## 체크리스트

배포 전 확인:
- [ ] Railway 프로젝트가 GitHub 저장소와 연결되어 있는가?
- [ ] 서비스가 Active 상태인가?
- [ ] Auto Deploy 옵션이 활성화되어 있는가?
- [ ] 올바른 브랜치(`main`)가 설정되어 있는가?
- [ ] Railway Dashboard에서 최신 커밋이 표시되는가?

## 문제가 계속되면

1. **Railway Dashboard → Deployments** 탭에서:
   - 최신 커밋이 표시되는지 확인
   - 배포 로그 확인
   - 에러 메시지 확인

2. **Railway Support** 문의:
   - Railway Dashboard → **Help** → **Contact Support**
   - 문제 설명 및 스크린샷 첨부

3. **GitHub Actions 확인** (사용 중인 경우):
   - GitHub 저장소 → **Actions** 탭
   - 워크플로우 실행 상태 확인

## 예상 원인

1. **GitHub Webhook 문제**: Railway가 GitHub 푸시 이벤트를 받지 못함
2. **Auto Deploy 비활성화**: 설정에서 자동 배포가 꺼져 있음
3. **서비스 일시 중지**: Railway의 일시적인 제한 (Hobby 플랜)
4. **브랜치 불일치**: 설정된 브랜치와 푸시한 브랜치가 다름

## 빠른 해결 (권장)

**가장 빠른 방법은 Railway Dashboard에서 수동 배포입니다:**

1. Railway Dashboard 접속
2. 프로젝트 → Sudam1 서비스
3. Deployments 탭
4. 최신 커밋의 "Deploy" 버튼 클릭

이렇게 하면 즉시 배포가 시작됩니다!
