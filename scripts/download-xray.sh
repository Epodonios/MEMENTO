#!/usr/bin/env bash
set -e
XRAY_VERSION="v25.1.1"
PLATFORM="windows-64"
DOWNLOAD_URL="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-${PLATFORM}.zip"

RESOURCES_DIR="src-tauri/resources/xray"
mkdir -p "$RESOURCES_DIR"

echo "Downloading xray-core ${XRAY_VERSION}..."
curl -L -o /tmp/xray.zip "$DOWNLOAD_URL"

echo "Extracting to $RESOURCES_DIR..."
unzip -o /tmp/xray.zip -d "$RESOURCES_DIR"

rm -f /tmp/xray.zip

echo "Ready at: $RESOURCES_DIR/"
ls -lh "$RESOURCES_DIR/"
echo "Now run: npx tauri build"
