#!/usr/bin/env bash
# MEMENTO — wintun.dll fetch + verify (Phase B0, sandbox/CI variant).
#
# Fetches the OFFICIAL wintun zip from wintun.net, verifies BOTH digests
# against electron/wintunPin.ts values, and places the amd64 dll into
# resources/wintun/bin/amd64/wintun.dll. Refuses EVERY mismatch (the
# reference's build-time-fail lesson: a version bump that misses a
# constant fails HERE, not on a user's machine at connect time).
#
# Windows users: use fetch-wintun.ps1 (also verifies Authenticode).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
DEST_DIR="$APP/resources/wintun/bin/amd64"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

WINTUN_ZIP_URL="https://www.wintun.net/builds/wintun-0.14.1.zip"
WINTUN_ZIP_SHA256="07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"
WINTUN_DLL_SHA256="e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"
# Keep in lockstep with electron/wintunPin.ts (the ONE place).

echo "[fetch-wintun] downloading $WINTUN_ZIP_URL"
curl -sSL --max-time 300 -o "$WORK/wintun.zip" "$WINTUN_ZIP_URL"

ACTUAL_ZIP="$(sha256sum "$WORK/wintun.zip" | cut -d' ' -f1)"
if [ "$ACTUAL_ZIP" != "$WINTUN_ZIP_SHA256" ]; then
  echo "[fetch-wintun] REFUSED: zip sha256 mismatch (expected $WINTUN_ZIP_SHA256, got $ACTUAL_ZIP)" >&2
  exit 1
fi
echo "[fetch-wintun] zip sha256 OK: $ACTUAL_ZIP"

unzip -o -q "$WORK/wintun.zip" -d "$WORK/expanded"
SRC_DLL="$WORK/expanded/wintun/bin/amd64/wintun.dll"
[ -f "$SRC_DLL" ] || { echo "[fetch-wintun] REFUSED: bin/amd64/wintun.dll not in the official zip" >&2; exit 1; }

ACTUAL_DLL="$(sha256sum "$SRC_DLL" | cut -d' ' -f1)"
if [ "$ACTUAL_DLL" != "$WINTUN_DLL_SHA256" ]; then
  echo "[fetch-wintun] REFUSED: dll sha256 mismatch (expected $WINTUN_DLL_SHA256, got $ACTUAL_DLL)" >&2
  exit 1
fi
echo "[fetch-wintun] dll sha256 OK: $ACTUAL_DLL"

mkdir -p "$DEST_DIR"
cp "$SRC_DLL" "$DEST_DIR/wintun.dll"
cp "$WORK/expanded/wintun/LICENSE.txt" "$APP/resources/wintun/wintun-LICENSE.txt"
echo "[fetch-wintun] placed verified wintun.dll -> resources/wintun/bin/amd64/wintun.dll"
echo "[fetch-wintun] refreshed wintun-LICENSE.txt from the verified zip"
echo "[fetch-wintun] DONE (hash-gated; Authenticode publisher check = real-Windows item, see fetch-wintun.ps1)"
