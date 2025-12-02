# Git Push 문제 해결 가이드

## 현재 상황
- 로컬 main 브랜치: `200f221d64b20e43d045664f6129fe0d325e5d93`
- 원격 origin/main: `4c40a621bf97f22d11769d0b1ff740719c6cbe87`
- 로컬이 원격보다 앞서 있음 (푸시 필요)
- GitHub에 3일 전 업데이트로 표시됨

## 문제 원인
GitHub에 푸시가 안되는 주요 원인:
1. **인증 문제** (가장 가능성 높음)
   - HTTPS를 사용하는 경우 Personal Access Token 필요
   - Windows Credential Manager에 저장된 인증 정보 만료
2. **권한 문제**
   - 저장소에 대한 쓰기 권한 없음
3. **네트워크 문제**
   - 방화벽 또는 프록시 설정

## 해결 방법

### 방법 1: GitHub Personal Access Token 사용 (권장)

1. **GitHub에서 Personal Access Token 생성**
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Generate new token (classic)
   - 권한 선택: `repo` (전체 저장소 접근)
   - 토큰 생성 후 복사 (한 번만 표시됨)

2. **Windows Credential Manager 업데이트**
   ```powershell
   # 기존 인증 정보 제거
   cmdkey /list | Select-String "git:https://github.com"
   cmdkey /delete:git:https://github.com
   
   # 새 토큰으로 푸시 (토큰 입력 요청 시 새 토큰 입력)
   cd c:\project\SUDAMR
   git push origin main
   ```
   
   푸시 시:
   - Username: `BlueStarAcademy` 또는 GitHub 사용자명
   - Password: 생성한 Personal Access Token 입력

### 방법 2: SSH 키 사용

1. **SSH 키 생성 (없는 경우)**
   ```powershell
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **SSH 키를 GitHub에 추가**
   - `C:\Users\YourUsername\.ssh\id_ed25519.pub` 파일 내용 복사
   - GitHub → Settings → SSH and GPG keys → New SSH key
   - 키 추가

3. **원격 저장소 URL을 SSH로 변경**
   ```powershell
   cd c:\project\SUDAMR
   git remote set-url origin git@github.com:BlueStarAcademy/Sudam1.git
   git push origin main
   ```

### 방법 3: GitHub CLI 사용

1. **GitHub CLI 설치 및 로그인**
   ```powershell
   # GitHub CLI 설치 확인
   gh --version
   
   # 로그인
   gh auth login
   
   # 푸시
   cd c:\project\SUDAMR
   git push origin main
   ```

### 방법 4: 수동으로 확인 및 푸시

터미널에서 직접 실행하여 오류 메시지 확인:

```powershell
cd c:\project\SUDAMR

# 상태 확인
git status
git log --oneline -5
git log origin/main..main --oneline

# 푸시 시도 (오류 메시지 확인)
git push origin main
```

**예상 오류 메시지:**
- `remote: Support for password authentication was removed`: Personal Access Token 필요
- `Permission denied`: 권한 문제
- `Authentication failed`: 인증 정보 문제

## 즉시 시도할 수 있는 명령어

```powershell
cd c:\project\SUDAMR

# 1. 원격 저장소 확인
git remote -v

# 2. 변경사항 확인
git status
git log origin/main..main --oneline

# 3. 모든 변경사항 스테이징 및 커밋
git add -A
git commit -m "Update: 최신 변경사항"

# 4. 푸시 시도
git push origin main

# 5. 오류 발생 시 인증 정보 확인
git config --global credential.helper
cmdkey /list | Select-String "git"
```

## Railway 배포와의 관계

Railway는 GitHub 저장소의 `main` 브랜치를 모니터링하여 자동 배포합니다.
- GitHub에 푸시가 안되면 Railway도 업데이트되지 않음
- 푸시 성공 후 Railway Dashboard에서 자동 배포 확인

## 확인 방법

푸시 성공 후:
1. GitHub 웹사이트 확인: https://github.com/BlueStarAcademy/Sudam1
2. 최신 커밋이 반영되었는지 확인
3. Railway Dashboard에서 자동 배포 시작 확인

## 추가 도움

문제가 계속되면:
- GitHub Support: https://support.github.com
- Git 문서: https://git-scm.com/doc
