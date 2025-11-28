#!/bin/bash
# Railway 환경에서 KataGo Linux CPU-only binary를 다운로드하는 스크립트

set -e

KATAGO_DIR="/app/katago"
KATAGO_BINARY="$KATAGO_DIR/katago"
KATAGO_VERSION="v1.16.4"
# eigen 버전은 CPU-only 버전입니다 (GPU 없이도 작동)
KATAGO_URL="https://github.com/lightvector/katago/releases/download/${KATAGO_VERSION}/katago-${KATAGO_VERSION}-eigen-linux-x64.zip"

# KataGo 디렉토리 생성
mkdir -p "$KATAGO_DIR"

# 이미 KataGo binary가 있으면 스킵
if [ -f "$KATAGO_BINARY" ]; then
    echo "[KataGo] Binary already exists at $KATAGO_BINARY, skipping download"
    chmod +x "$KATAGO_BINARY"
    exit 0
fi

echo "[KataGo] Downloading KataGo Linux CPU-only binary from $KATAGO_URL..."

# 임시 디렉토리 생성
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

# 다운로드 및 압축 해제
curl -L -o katago.zip "$KATAGO_URL" || {
    echo "[KataGo] Failed to download from GitHub, trying alternative method..."
    # 대체 방법: 직접 빌드된 binary 다운로드 시도
    exit 1
}

unzip -q katago.zip || {
    echo "[KataGo] Failed to unzip downloaded file"
    exit 1
}

# KataGo binary 찾기 및 복사
KATAGO_EXTRACTED=$(find . -name "katago" -type f | head -n 1)
if [ -z "$KATAGO_EXTRACTED" ]; then
    echo "[KataGo] KataGo binary not found in extracted files"
    exit 1
fi

cp "$KATAGO_EXTRACTED" "$KATAGO_BINARY"
chmod +x "$KATAGO_BINARY"

# 정리
cd /
rm -rf "$TMP_DIR"

echo "[KataGo] Successfully downloaded and installed KataGo to $KATAGO_BINARY"
echo "[KataGo] KataGo version: $($KATAGO_BINARY version 2>&1 || echo 'version check failed')"

