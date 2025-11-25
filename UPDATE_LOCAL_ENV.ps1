# 로컬 .env 파일에 Railway DATABASE_URL 설정 스크립트

# Railway Postgres 공개 연결 URL
$railwayDbUrl = "postgresql://postgres:XfhEACpePdhsJdEGavgULnpMDDhmpKlR@turntable.proxy.rlwy.net:17109/railway?sslmode=require"

# .env 파일 경로
$envFile = ".env"

# .env 파일이 존재하는지 확인
if (Test-Path $envFile) {
    Write-Host "[정보] .env 파일을 찾았습니다."
    
    # 기존 DATABASE_URL 라인 찾기
    $content = Get-Content $envFile
    $hasDatabaseUrl = $content | Where-Object { $_ -match "^DATABASE_URL" }
    
    if ($hasDatabaseUrl) {
        Write-Host "[정보] 기존 DATABASE_URL을 Railway URL로 교체합니다."
        # 기존 DATABASE_URL 라인을 교체
        $newContent = $content | ForEach-Object {
            if ($_ -match "^DATABASE_URL") {
                "DATABASE_URL=`"$railwayDbUrl`""
            } else {
                $_
            }
        }
        $newContent | Set-Content $envFile -Encoding UTF8
        Write-Host "[완료] DATABASE_URL이 Railway Postgres로 업데이트되었습니다."
    } else {
        Write-Host "[정보] DATABASE_URL이 없습니다. 새로 추가합니다."
        # 파일 끝에 추가
        Add-Content $envFile -Value "`nDATABASE_URL=`"$railwayDbUrl`"" -Encoding UTF8
        Write-Host "[완료] DATABASE_URL이 추가되었습니다."
    }
} else {
    Write-Host "[정보] .env 파일이 없습니다. 새로 생성합니다."
    # 새 .env 파일 생성
    @"
DATABASE_URL="$railwayDbUrl"
"@ | Set-Content $envFile -Encoding UTF8
    Write-Host "[완료] .env 파일이 생성되었습니다."
}

Write-Host ""
Write-Host "[다음 단계]"
Write-Host "1. npm start로 서버를 시작하세요"
Write-Host "2. 데이터베이스 연결이 성공하면 DB initialized 메시지가 표시됩니다."

