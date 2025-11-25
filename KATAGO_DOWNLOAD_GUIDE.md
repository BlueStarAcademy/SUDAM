# KataGo 다운로드 가이드

## 다운로드 사이트

### 1. KataGo 바이너리 (실행 파일)

**GitHub Releases 페이지:**
- URL: https://github.com/lightvector/KataGo/releases
- 최신 버전 확인 및 다운로드 가능

**현재 프로젝트에서 사용 중인 버전:**
- v1.16.4 (최우선)
- v1.16.3 (대체)
- v1.16.2 (대체)
- v1.16.1 (대체)
- v1.16.0 (대체)

### 2. 신경망 모델 파일

**KataGo Training Models:**
- URL: https://media.katagotraining.org/uploaded/models/
- 또는: https://katagotraining.org/models/

**현재 프로젝트에서 사용 중인 모델:**
- `kata1-b28c512nbt-s9853922560-d5031756885.bin.gz`
- 모델 크기: 약 500MB

## 추천 버전

### 바이너리 버전
**v1.16.4** (현재 프로젝트에서 사용 중)
- 최신 안정 버전
- 버그 수정 및 성능 개선 포함

### 모델 버전
**kata1-b28c512nbt-s9853922560-d5031756885.bin.gz**
- 28-block, 512-channel 모델
- 높은 정확도와 성능
- 현재 프로젝트에서 사용 중

**대안 모델 (더 작은 크기):**
- `kata1-b18c384nbt.bin.gz` (18-block, 384-channel)
- 더 작은 파일 크기, 약간 낮은 정확도
- 리소스가 제한된 환경에 적합

## 다운로드 방법

### Windows용 (로컬 개발)

1. **바이너리 다운로드:**
   ```
   https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip
   ```

2. **압축 해제 후:**
   - `katago.exe` 파일을 `katago/katago.exe`로 저장

### Linux용 (Railway 배포)

1. **바이너리 다운로드 (eigenavx2 빌드 - CPU 최적화):**
   ```
   https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip
   ```

2. **압축 해제 후:**
   - `katago` 파일을 `katago/katago`로 저장
   - 실행 권한 부여: `chmod +x katago/katago`

### 모델 파일 다운로드

**직접 다운로드:**
```
https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
```

**또는 wget 사용 (Linux/Mac):**
```bash
wget https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
```

**PowerShell 사용 (Windows):**
```powershell
Invoke-WebRequest -Uri "https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz" -OutFile "katago\kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"
```

## 프로젝트 구조

다운로드 후 다음 구조로 배치:

```
SUDAMR/
├── katago/
│   ├── katago.exe          # Windows용 (로컬 개발)
│   ├── katago              # Linux용 (Railway 배포)
│   └── kata1-b28c512nbt-s9853922560-d5031756885.bin.gz  # 모델 파일
```

## Git에 추가하기

### 1. .gitignore 확인

`.gitignore`에 다음이 포함되어 있는지 확인:
```
# KataGo 모델 파일은 크기가 크므로 Git LFS 사용 권장
katago/*.bin.gz
```

또는 Git LFS를 사용하지 않으려면:
```
# KataGo 모델 파일 제외 (너무 큼)
katago/*.bin.gz
```

### 2. Git LFS 사용 (권장)

모델 파일이 크므로 Git LFS 사용을 권장합니다:

```bash
# Git LFS 설치 확인
git lfs version

# Git LFS 초기화
git lfs install

# 모델 파일을 LFS로 추적
git lfs track "katago/*.bin.gz"

# .gitattributes 파일 커밋
git add .gitattributes
```

### 3. 파일 추가 및 커밋

```bash
# 파일 추가
git add katago/katago.exe
git add katago/katago
git add katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz

# 커밋
git commit -m "Add KataGo v1.16.4 binaries and model file"

# 푸시
git push
```

## 주의사항

1. **파일 크기:**
   - 모델 파일: 약 500MB
   - 바이너리: 약 50-100MB
   - Git LFS 사용을 강력히 권장

2. **플랫폼별 파일:**
   - Windows: `katago.exe`
   - Linux: `katago` (확장자 없음)
   - 둘 다 필요하면 둘 다 포함

3. **Railway 배포:**
   - Linux 바이너리(`katago`)가 필요
   - 모델 파일도 함께 포함되어야 함

4. **로컬 개발:**
   - Windows 바이너리(`katago.exe`) 사용
   - 모델 파일은 공유 가능

## 빠른 다운로드 스크립트

### Windows (PowerShell)

```powershell
# katago 폴더 생성
New-Item -ItemType Directory -Force -Path katago

# Windows 바이너리 다운로드
Invoke-WebRequest -Uri "https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip" -OutFile "katago-temp.zip"
Expand-Archive -Path "katago-temp.zip" -DestinationPath "katago-temp" -Force
Copy-Item "katago-temp\katago.exe" -Destination "katago\katago.exe"
Remove-Item -Recurse -Force "katago-temp", "katago-temp.zip"

# Linux 바이너리 다운로드
Invoke-WebRequest -Uri "https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip" -OutFile "katago-linux-temp.zip"
Expand-Archive -Path "katago-linux-temp.zip" -DestinationPath "katago-linux-temp" -Force
Copy-Item "katago-linux-temp\katago" -Destination "katago\katago"
Remove-Item -Recurse -Force "katago-linux-temp", "katago-linux-temp.zip"

# 모델 다운로드
Invoke-WebRequest -Uri "https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz" -OutFile "katago\kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"

Write-Host "KataGo 다운로드 완료!"
```

### Linux/Mac (Bash)

```bash
#!/bin/bash

# katago 폴더 생성
mkdir -p katago

# Windows 바이너리 다운로드
wget -q https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip -O katago-temp.zip
unzip -q katago-temp.zip -d katago-temp
cp katago-temp/katago.exe katago/katago.exe
rm -rf katago-temp katago-temp.zip

# Linux 바이너리 다운로드
wget -q https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip -O katago-linux-temp.zip
unzip -q katago-linux-temp.zip -d katago-linux-temp
cp katago-linux-temp/katago katago/katago
chmod +x katago/katago
rm -rf katago-linux-temp katago-linux-temp.zip

# 모델 다운로드
wget -q https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz -O katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz

echo "KataGo 다운로드 완료!"
```

## 참고 링크

- **KataGo GitHub:** https://github.com/lightvector/KataGo
- **KataGo Releases:** https://github.com/lightvector/KataGo/releases
- **모델 다운로드:** https://media.katagotraining.org/uploaded/models/
- **KataGo 문서:** https://github.com/lightvector/KataGo/blob/master/README.md

