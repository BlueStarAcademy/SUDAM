# 강제 푸시 스크립트
Set-Location "c:\project\SUDAMR"

Write-Host "=== 강제 푸시 시작 ===" -ForegroundColor Cyan

# 1. 현재 상태 확인
Write-Host "`n[1] 현재 상태:" -ForegroundColor Yellow
git status

# 2. 모든 변경사항 스테이징
Write-Host "`n[2] 변경사항 스테이징..." -ForegroundColor Yellow
git add -A

# 3. 커밋 (변경사항이 있는 경우)
$status = git status --porcelain
if ($status) {
    Write-Host "`n[3] 커밋 생성..." -ForegroundColor Yellow
    git commit -m "Force push: Overwrite remote - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
} else {
    Write-Host "`n[3] 커밋할 변경사항 없음" -ForegroundColor Yellow
}

# 4. 원격 저장소 정보 가져오기
Write-Host "`n[4] 원격 저장소 정보 가져오기..." -ForegroundColor Yellow
git fetch origin

# 5. 로컬과 원격 커밋 비교
Write-Host "`n[5] 로컬 최신 커밋:" -ForegroundColor Yellow
git log --oneline -1

Write-Host "`n원격 최신 커밋:" -ForegroundColor Yellow
git log origin/main --oneline -1

# 6. 강제 푸시 실행
Write-Host "`n[6] 강제 푸시 실행..." -ForegroundColor Cyan
Write-Host "원격 저장소를 로컬 상태로 덮어씁니다!" -ForegroundColor Red
$pushOutput = git push origin main --force 2>&1
$pushExitCode = $LASTEXITCODE

Write-Host "`n푸시 결과:" -ForegroundColor Cyan
Write-Host $pushOutput

if ($pushExitCode -eq 0) {
    Write-Host "`n✅ 강제 푸시 성공!" -ForegroundColor Green
} else {
    Write-Host "`n❌ 강제 푸시 실패!" -ForegroundColor Red
    Write-Host "에러 코드: $pushExitCode" -ForegroundColor Red
    
    if ($pushOutput -match "authentication" -or $pushOutput -match "permission") {
        Write-Host "`n인증 문제가 있습니다." -ForegroundColor Yellow
        Write-Host "GitHub Personal Access Token이 필요합니다." -ForegroundColor Yellow
    }
}

# 7. 최종 상태 확인
Write-Host "`n[7] 최종 상태:" -ForegroundColor Cyan
git status

Write-Host "`n완료!" -ForegroundColor Green
