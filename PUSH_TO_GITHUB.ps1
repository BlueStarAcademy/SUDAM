# GitHub 푸시 스크립트
# BlueStarAcademy/Sudam1 저장소의 main 브랜치로 푸시

Set-Location "c:\project\SUDAMR"

Write-Host "=== GitHub 푸시 시작 ===" -ForegroundColor Cyan

# 1. 원격 저장소 확인
Write-Host "`n원격 저장소 확인..." -ForegroundColor Yellow
git remote -v

# 2. 현재 상태 확인
Write-Host "`n현재 상태 확인..." -ForegroundColor Yellow
git status

# 3. 모든 변경사항 스테이징
Write-Host "`n변경사항 스테이징..." -ForegroundColor Yellow
git add -A

# 4. 커밋 (변경사항이 있는 경우)
$status = git status --porcelain
if ($status) {
    Write-Host "`n커밋 생성..." -ForegroundColor Yellow
    git commit -m "Update project files - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
} else {
    Write-Host "`n커밋할 변경사항이 없습니다." -ForegroundColor Yellow
}

# 5. 원격 저장소와 동기화
Write-Host "`n원격 저장소와 동기화..." -ForegroundColor Yellow
git fetch origin main

# 6. 로컬과 원격 차이 확인
$localCommit = git rev-parse main
$remoteCommit = git rev-parse origin/main

if ($localCommit -ne $remoteCommit) {
    Write-Host "`n로컬과 원격이 다릅니다. 병합이 필요할 수 있습니다." -ForegroundColor Yellow
    $commitsAhead = git rev-list --count origin/main..main
    $commitsBehind = git rev-list --count main..origin/main
    
    if ($commitsBehind -gt 0) {
        Write-Host "원격에 $commitsBehind 개의 새로운 커밋이 있습니다." -ForegroundColor Yellow
        Write-Host "병합 후 푸시하시겠습니까? (y/n)" -ForegroundColor Yellow
        $response = Read-Host
        if ($response -eq 'y') {
            git pull origin main --no-edit
        }
    }
    
    if ($commitsAhead -gt 0) {
        Write-Host "로컬에 $commitsAhead 개의 커밋이 푸시 대기 중입니다." -ForegroundColor Green
    }
}

# 7. 푸시 시도
Write-Host "`n푸시 시도..." -ForegroundColor Cyan
$pushOutput = git push origin main 2>&1
$pushExitCode = $LASTEXITCODE

if ($pushExitCode -eq 0) {
    Write-Host "✅ 푸시 성공!" -ForegroundColor Green
    Write-Host $pushOutput
} else {
    Write-Host "❌ 푸시 실패!" -ForegroundColor Red
    Write-Host $pushOutput -ForegroundColor Red
    Write-Host "`n에러 코드: $pushExitCode" -ForegroundColor Red
    
    # 일반적인 에러 해결 방법 제시
    if ($pushOutput -match "authentication") {
        Write-Host "`n인증 문제가 있습니다." -ForegroundColor Yellow
        Write-Host "GitHub Personal Access Token을 설정하거나 확인하세요." -ForegroundColor Yellow
    } elseif ($pushOutput -match "rejected") {
        Write-Host "`n푸시가 거부되었습니다. 원격에 새로운 커밋이 있을 수 있습니다." -ForegroundColor Yellow
        Write-Host "git pull origin main 을 먼저 실행하세요." -ForegroundColor Yellow
    }
}

# 8. 최종 상태 확인
Write-Host "`n=== 최종 상태 ===" -ForegroundColor Cyan
git status

Write-Host "`n완료!" -ForegroundColor Green
