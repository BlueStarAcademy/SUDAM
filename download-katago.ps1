# KataGo 다운로드 스크립트 (Windows PowerShell)

Write-Host "KataGo 다운로드를 시작합니다..." -ForegroundColor Green

# katago 폴더 생성
New-Item -ItemType Directory -Force -Path katago | Out-Null

# 버전 설정
$version = "v1.16.4"
Write-Host "다운로드 버전: $version" -ForegroundColor Yellow

# Windows 바이너리 다운로드
Write-Host "`n[1/3] Windows 바이너리 다운로드 중..." -ForegroundColor Cyan
$windowsUrl = "https://github.com/lightvector/KataGo/releases/download/$version/katago-$version-windows-x64.zip"
$windowsZip = "katago-windows-temp.zip"
try {
    Invoke-WebRequest -Uri $windowsUrl -OutFile $windowsZip -UseBasicParsing
    Write-Host "  다운로드 완료: $windowsZip" -ForegroundColor Green
    
    # 압축 해제
    Expand-Archive -Path $windowsZip -DestinationPath "katago-windows-temp" -Force
    $exePath = Get-ChildItem -Path "katago-windows-temp" -Filter "katago.exe" -Recurse | Select-Object -First 1
    if ($exePath) {
        Copy-Item $exePath.FullName -Destination "katago\katago.exe" -Force
        Write-Host "  katago.exe 복사 완료" -ForegroundColor Green
    } else {
        Write-Host "  경고: katago.exe를 찾을 수 없습니다" -ForegroundColor Yellow
    }
    Remove-Item -Recurse -Force "katago-windows-temp", $windowsZip
} catch {
    Write-Host "  오류: Windows 바이너리 다운로드 실패 - $($_.Exception.Message)" -ForegroundColor Red
}

# Linux 바이너리 다운로드 (Railway 배포용)
Write-Host "`n[2/3] Linux 바이너리 다운로드 중..." -ForegroundColor Cyan
$linuxUrl = "https://github.com/lightvector/KataGo/releases/download/$version/katago-$version-eigenavx2-linux-x64.zip"
$linuxZip = "katago-linux-temp.zip"
try {
    Invoke-WebRequest -Uri $linuxUrl -OutFile $linuxZip -UseBasicParsing
    Write-Host "  다운로드 완료: $linuxZip" -ForegroundColor Green
    
    # 압축 해제 (7-Zip 또는 PowerShell의 Expand-Archive 사용)
    # Linux zip 파일은 PowerShell의 Expand-Archive로도 해제 가능
    Expand-Archive -Path $linuxZip -DestinationPath "katago-linux-temp" -Force
    $linuxBin = Get-ChildItem -Path "katago-linux-temp" -Filter "katago" -Recurse -File | Select-Object -First 1
    if ($linuxBin) {
        Copy-Item $linuxBin.FullName -Destination "katago\katago" -Force
        Write-Host "  katago (Linux) 복사 완료" -ForegroundColor Green
    } else {
        Write-Host "  경고: katago (Linux)를 찾을 수 없습니다" -ForegroundColor Yellow
    }
    Remove-Item -Recurse -Force "katago-linux-temp", $linuxZip
} catch {
    Write-Host "  오류: Linux 바이너리 다운로드 실패 - $($_.Exception.Message)" -ForegroundColor Red
}

# 모델 파일 다운로드
Write-Host "`n[3/3] 모델 파일 다운로드 중 (약 500MB, 시간이 걸릴 수 있습니다)..." -ForegroundColor Cyan
$modelUrl = "https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"
$modelFile = "katago\kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"
try {
    $ProgressPreference = 'SilentlyContinue'  # 진행률 표시 비활성화 (더 빠름)
    Invoke-WebRequest -Uri $modelUrl -OutFile $modelFile -UseBasicParsing
    $ProgressPreference = 'Continue'
    
    $fileSize = (Get-Item $modelFile).Length / 1MB
    Write-Host "  모델 파일 다운로드 완료: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
} catch {
    Write-Host "  오류: 모델 파일 다운로드 실패 - $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  수동 다운로드: $modelUrl" -ForegroundColor Yellow
}

Write-Host "`n다운로드 완료!" -ForegroundColor Green
Write-Host "`n다음 파일들이 katago 폴더에 있습니다:" -ForegroundColor Cyan
Get-ChildItem -Path katago -File | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}} | Format-Table

Write-Host "`nGit에 추가하려면:" -ForegroundColor Yellow
Write-Host "  git add katago/katago.exe katago/katago katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz" -ForegroundColor White
Write-Host "  git commit -m 'Update KataGo to v1.16.4'" -ForegroundColor White
Write-Host "  git push" -ForegroundColor White

