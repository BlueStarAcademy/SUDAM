#!/bin/bash
# Railway 환경에서 KataGo 모델 파일을 다운로드하는 스크립트

set -e

KATAGO_DIR="/app/katago"
MODEL_FILE="$KATAGO_DIR/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"
MODEL_URL="https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz"

# KataGo 디렉토리 생성
mkdir -p "$KATAGO_DIR"

# 이미 모델 파일이 있으면 스킵
if [ -f "$MODEL_FILE" ]; then
    echo "[KataGo] Model file already exists at $MODEL_FILE, skipping download"
    exit 0
fi

echo "[KataGo] Downloading KataGo model file from $MODEL_URL..."
echo "[KataGo] This may take several minutes (file size: ~500MB)..."

# 모델 파일 다운로드
curl -L -o "$MODEL_FILE" "$MODEL_URL" || {
    echo "[KataGo] Failed to download model file"
    exit 1
}

# 파일 크기 확인
if [ ! -f "$MODEL_FILE" ] || [ ! -s "$MODEL_FILE" ]; then
    echo "[KataGo] Downloaded model file is empty or missing"
    exit 1
fi

echo "[KataGo] Successfully downloaded model file to $MODEL_FILE"
echo "[KataGo] Model file size: $(du -h "$MODEL_FILE" | cut -f1)"

