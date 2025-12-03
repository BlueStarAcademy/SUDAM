# Git Push 상태 확인 및 푸시 시도
Write-Host "=== Git Push 상태 확인 ===" -ForegroundColor Cyan

Set-Location "c:\project\SUDAMR"

# 1. 원격 저장소 확인
Write-Host "`n[1] 원격 저장소 확인:" -ForegroundColor Yellow
git remote -v

# 2. 현재 브랜치 확인
Write-Host "`n[2] 현재 브랜치:" -ForegroundColor Yellow
git branch --show-current

# 3. 로컬 커밋 확인
Write-Host "`n[3] 로컬 최신 커밋:" -ForegroundColor Yellow
git log --oneline -1

# 4. 원격 커밋 확인
Write-Host "`n[4] 원격 최신 커밋:" -ForegroundColor Yellow
git fetch origin main 2>&1
git log origin/main --oneline -1

# 5. 푸시할 커밋 확인
Write-Host "`n[5] 푸시할 커밋:" -ForegroundColor Yellow
$commits = git log origin/main..main --oneline
if ($commits) {
    Write-Host $commits -ForegroundColor Green
} else {
    Write-Host "푸시할 커밋이 없습니다." -ForegroundColor Red
}

# 6. 변경사항 확인
Write-Host "`n[6] 스테이징되지 않은 변경사항:" -ForegroundColor Yellow
$changes = git status --porcelain
if ($changes) {
    Write-Host $changes -ForegroundColor Yellow
    Write-Host "`n변경사항이 있습니다. 커밋이 필요할 수 있습니다." -ForegroundColor Yellow
} else {
    Write-Host "변경사항 없음" -ForegroundColor Green
}

# 7. 푸시 시도
Write-Host "`n[7] 푸시 시도..." -ForegroundColor Cyan
$pushResult = git push origin main 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 푸시 성공!" -ForegroundColor Green
    Write-Host $pushResult
} else {
    Write-Host "❌ 푸시 실패!" -ForegroundColor Red
    Write-Host $pushResult -ForegroundColor Red
    Write-Host "`n에러 코드: $LASTEXITCODE" -ForegroundColor Red
}

# 8. 최종 상태 확인
Write-Host "`n[8] 최종 상태:" -ForegroundColor Cyan
git status
