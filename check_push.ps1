# Git Push 상태 확인 스크립트
Write-Host "=== Git 상태 확인 ===" -ForegroundColor Cyan

# 현재 디렉토리로 이동
Set-Location "c:\project\SUDAMR"

# 원격 저장소 확인
Write-Host "`n원격 저장소:" -ForegroundColor Yellow
git remote -v

# 로컬과 원격 커밋 비교
Write-Host "`n로컬 main 브랜치:" -ForegroundColor Yellow
git rev-parse HEAD
git log --oneline -1

Write-Host "`n원격 origin/main 브랜치:" -ForegroundColor Yellow
git rev-parse origin/main
git log origin/main --oneline -1

# 푸시할 커밋 확인
Write-Host "`n푸시할 커밋:" -ForegroundColor Yellow
$commits = git log origin/main..main --oneline
if ($commits) {
    Write-Host $commits
    Write-Host "`n총 커밋 수: $($commits.Count)" -ForegroundColor Green
} else {
    Write-Host "푸시할 커밋이 없습니다." -ForegroundColor Red
}

# 변경사항 확인
Write-Host "`n스테이징되지 않은 변경사항:" -ForegroundColor Yellow
git status --porcelain

# 푸시 시도
Write-Host "`n=== 푸시 시도 ===" -ForegroundColor Cyan
$pushResult = git push origin main 2>&1
Write-Host $pushResult

# 결과 확인
Write-Host "`n=== 푸시 후 상태 ===" -ForegroundColor Cyan
git fetch origin
git status
