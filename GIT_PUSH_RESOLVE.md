# Git Push 거부 문제 해결

## 오류 메시지
```
! [rejected]          main -> main (fetch first)
error: failed to push some refs to 'https://github.com/BlueStarAcademy/Sudam1.git'
hint: Updates were rejected because the remote contains work that you do not
hint: have locally.
```

## 원인
원격 저장소(GitHub)에 로컬에 없는 변경사항이 있어서 푸시가 거부되었습니다.

## 해결 방법

### 방법 1: Pull 후 Push (권장 - 안전)

```powershell
cd c:\project\SUDAMR

# 1. 원격 변경사항 가져오기 및 병합
git pull origin main

# 2. 충돌이 있으면 해결 후
git add .
git commit -m "Merge remote changes"

# 3. 푸시
git push origin main
```

### 방법 2: Rebase 사용 (히스토리 깔끔하게)

```powershell
cd c:\project\SUDAMR

# 1. 원격 변경사항 가져오기 및 rebase
git pull origin main --rebase

# 2. 충돌이 있으면 해결 후
git add .
git rebase --continue

# 3. 푸시
git push origin main
```

### 방법 3: 원격 변경사항 확인 후 결정

```powershell
cd c:\project\SUDAMR

# 1. 원격 변경사항 확인
git fetch origin
git log origin/main --oneline -10

# 2. 원격 변경사항이 중요하지 않다면 (주의: 위험)
git push origin main --force

# 3. 원격 변경사항이 중요하다면 pull 후 push
git pull origin main
git push origin main
```

## 단계별 실행

### 1단계: 현재 상태 확인
```powershell
cd c:\project\SUDAMR
git status
git log --oneline -5
git log origin/main --oneline -5
```

### 2단계: 원격 변경사항 가져오기
```powershell
git pull origin main
```

### 3단계: 충돌 해결 (있는 경우)
```powershell
# 충돌 파일 확인
git status

# 충돌 해결 후
git add .
git commit -m "Merge remote changes"
```

### 4단계: 푸시
```powershell
git push origin main
```

## 주의사항

⚠️ **`git push --force`는 위험합니다!**
- 원격의 변경사항을 영구적으로 덮어씁니다
- 다른 사람과 협업 중이면 사용하지 마세요
- 혼자 작업하는 저장소에서만 사용하세요

## 확인

푸시 성공 후:
```powershell
git status
# "Your branch is up to date with 'origin/main'" 메시지 확인
```

GitHub에서도 확인:
- https://github.com/BlueStarAcademy/Sudam1
- 최신 커밋이 반영되었는지 확인
