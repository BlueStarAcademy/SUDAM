# KataGo 다운로드 정보 요약

## 다운로드 사이트

### 1. KataGo 바이너리 (실행 파일)

**GitHub Releases:**
- **메인 페이지:** https://github.com/lightvector/KataGo/releases
- **최신 버전 확인:** Releases 페이지에서 최신 버전 확인

**직접 다운로드 링크 (v1.16.4):**

**Windows용:**
```
https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip
```

**Linux용 (eigenavx2 - CPU 최적화, Railway 배포용):**
```
https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip
```

**다른 Linux 빌드 옵션:**
- `eigen` (기본 CPU 빌드)
- `eigenavx2` (AVX2 최적화, 더 빠름) ← **권장**
- `opencl` (GPU 지원)
- `cuda` (NVIDIA GPU 지원)

### 2. 신경망 모델 파일

**KataGo Training Models:**
- **메인 페이지:** https://media.katagotraining.org/uploaded/models/
- **또는:** https://katagotraining.org/models/

**현재 프로젝트에서 사용 중인 모델:**
```
https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
```

**다른 모델 옵션:**
- `kata1-b28c512nbt-s9853922560-d5031756885.bin.gz` (28-block, 512-channel) ← **현재 사용 중, 권장**
- `kata1-b18c384nbt.bin.gz` (18-block, 384-channel, 더 작음)
- `kata1-b15c192nbt.bin.gz` (15-block, 192-channel, 가장 작음)

## 추천 버전

### 바이너리 버전
**v1.16.4** (현재 프로젝트에서 사용 중)
- 최신 안정 버전
- 버그 수정 및 성능 개선 포함
- **다운로드:** https://github.com/lightvector/KataGo/releases/tag/v1.16.4

**대안 버전:**
- v1.16.3 (이전 안정 버전)
- v1.16.2
- v1.16.1
- v1.16.0

### 모델 버전
**kata1-b28c512nbt-s9853922560-d5031756885.bin.gz** (권장)
- 28-block, 512-channel 모델
- 높은 정확도와 성능
- 파일 크기: 약 500MB
- **다운로드:** https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz

**대안 모델 (더 작은 크기):**
- `kata1-b18c384nbt.bin.gz` (약 200MB, 리소스 제한 환경용)
- `kata1-b15c192nbt.bin.gz` (약 100MB, 최소 리소스 환경용)

## 수동 다운로드 방법

### Windows (브라우저)

1. **Windows 바이너리:**
   - https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip
   - 다운로드 후 압축 해제
   - `katago.exe`를 `katago/katago.exe`로 복사

2. **모델 파일:**
   - https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
   - 다운로드 후 `katago/` 폴더에 저장

### PowerShell 명령어

```powershell
# Windows 바이너리
Invoke-WebRequest -Uri "https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-windows-x64.zip" -OutFile "katago-windows.zip"
Expand-Archive -Path "katago-windows.zip" -DestinationPath "katago-temp"
Copy-Item "katago-temp\katago.exe" -Destination "katago\katago.exe"
Remove-Item -Recurse -Force "katago-temp", "katago-windows.zip"

# 모델 파일
Invoke-WebRequest -Uri "https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz" -OutFile "katago\kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"
```

### Linux/Mac (터미널)

```bash
# Linux 바이너리
wget https://github.com/lightvector/KataGo/releases/download/v1.16.4/katago-v1.16.4-eigenavx2-linux-x64.zip
unzip katago-v1.16.4-eigenavx2-linux-x64.zip
cp katago katago/katago
chmod +x katago/katago
rm -rf katago-v1.16.4-eigenavx2-linux-x64.zip

# 모델 파일
wget https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz -O katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz
```

## Git에 추가하기

### 1. .gitignore 확인

모델 파일이 크므로 Git LFS 사용을 권장합니다:

```bash
# Git LFS 설치 확인
git lfs version

# Git LFS 초기화 (처음 한 번만)
git lfs install

# 모델 파일을 LFS로 추적
git lfs track "katago/*.bin.gz"

# .gitattributes 커밋
git add .gitattributes
git commit -m "Add Git LFS tracking for KataGo model files"
```

### 2. 파일 추가 및 커밋

```bash
# 파일 추가
git add katago/katago.exe      # Windows용
git add katago/katago           # Linux용
git add katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz  # 모델

# 커밋
git commit -m "Update KataGo to v1.16.4 with model file"

# 푸시
git push
```

## 현재 상태

다운로드 스크립트 실행 결과:
- ✅ Linux 바이너리 (`katago`): 다운로드 완료
- ❌ Windows 바이너리 (`katago.exe`): 404 에러 (v1.16.4가 없을 수 있음)
- ❌ 모델 파일: 403 에러 (권한 문제 또는 서버 문제)

**해결 방법:**
1. Windows 바이너리는 브라우저에서 직접 다운로드
2. 모델 파일은 브라우저에서 직접 다운로드하거나 다른 방법 시도
3. 또는 이미 있는 파일을 사용 (현재 `katago` 폴더에 파일들이 있음)

## 참고 링크

- **KataGo GitHub:** https://github.com/lightvector/KataGo
- **KataGo Releases:** https://github.com/lightvector/KataGo/releases
- **모델 다운로드:** https://media.katagotraining.org/uploaded/models/
- **KataGo 문서:** https://github.com/lightvector/KataGo/blob/master/README.md

