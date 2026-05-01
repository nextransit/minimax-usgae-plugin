#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax"
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
APP_NAME="MiniMax Monitor.app"
MOUNT_POINT="/Volumes/MiniMaxMonitorTest"
TMP_APP_DIR="/tmp/MiniMax Monitor.app"
LOG_FILE="/tmp/minimax-smoke.log"

DMG_PATH="$(ls -t "$DMG_DIR"/*.dmg | head -n 1)"
if [[ -z "${DMG_PATH:-}" ]]; then
  echo "No dmg found in $DMG_DIR" >&2
  exit 1
fi

echo "Using DMG: $DMG_PATH"

if mount | grep -q "$MOUNT_POINT"; then
  hdiutil detach "$MOUNT_POINT" -quiet || true
fi
rm -rf "$TMP_APP_DIR"
rm -f "$LOG_FILE"

hdiutil attach "$DMG_PATH" -nobrowse -mountpoint "$MOUNT_POINT" >/tmp/minimax-dmg-attach.log
cp -R "$MOUNT_POINT/$APP_NAME" "$TMP_APP_DIR"
hdiutil detach "$MOUNT_POINT" -quiet

xattr -dr com.apple.quarantine "$TMP_APP_DIR" || true

echo "Launching app..."
open "$TMP_APP_DIR" >/dev/null 2>&1

sleep 8
APP_PID="$(pgrep -f "$TMP_APP_DIR/Contents/MacOS/minimax-usage-monitor" | head -n 1 || true)"
if [[ -z "$APP_PID" ]]; then
  echo "App did not start" >&2
  exit 1
fi

echo "App started with PID: $APP_PID"

if ! pgrep -f "minimax-usage-monitor" >/dev/null; then
  echo "Smoke test failed: process not found" >&2
  exit 1
fi

echo "Smoke test passed"
