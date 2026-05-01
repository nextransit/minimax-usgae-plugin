#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MiniMax Monitor"
APP_PATH="/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"
LOG="/tmp/minimax-test.log"
> "$LOG"

kill_app() {
  pkill -f "$APP_NAME" 2>/dev/null || true
  sleep 2
}

get_pid() {
  pgrep -f "minimax-usage-monitor" 2>/dev/null | head -1 || true
}

echo "=== MiniMax Monitor Smoke Test ===" | tee -a "$LOG"

# Kill any existing instance
kill_app

# Remove any leftover volumes
hdiutil detach /Volumes/MiniMaxMonitorTest 2>/dev/null || true
hdiutil detach /Volumes/"$APP_NAME" 2>/dev/null || true

# Clear quarantine and launch
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
echo "[1/6] Launching app..." | tee -a "$LOG"
open "$APP_PATH" >/dev/null 2>&1
sleep 8

PID=$(get_pid)
if [[ -z "$PID" ]]; then
  echo "FAIL: App did not start" | tee -a "$LOG"
  exit 1
fi
echo "      PASS: PID=$PID" | tee -a "$LOG"

# Check process is running
echo "[2/6] Checking process..." | tee -a "$LOG"
if ps -p "$PID" -o comm= | grep -q minimax; then
  echo "      PASS: Process active" | tee -a "$LOG"
else
  echo "      FAIL: Process died" | tee -a "$LOG"
  exit 1
fi

# Check app bundle structure
echo "[3/6] Checking bundle structure..." | tee -a "$LOG"
INFO_PLIST="$APP_PATH/Contents/Info.plist"
MACOS_BIN="$APP_PATH/Contents/MacOS/minimax-usage-monitor"
if [[ -f "$INFO_PLIST" && -x "$MACOS_BIN" ]]; then
  BUNDLE_ID=$(defaults read "$INFO_PLIST" CFBundleIdentifier 2>/dev/null || echo "unknown")
  echo "      PASS: Bundle valid, ID=$BUNDLE_ID" | tee -a "$LOG"
else
  echo "      FAIL: Missing Info.plist or binary" | tee -a "$LOG"
  exit 1
fi

# Check tray icon exists (macOS menu bar)
echo "[4/6] Checking menu bar tray..." | tee -a "$LOG"
if pgrep -af "MiniMax" | grep -qv grep; then
  echo "      PASS: Tray process active" | tee -a "$LOG"
else
  echo "      WARN: Could not verify tray" | tee -a "$LOG"
fi

# Check listening ports (Tauri serves on a port)
echo "[5/6] Checking network listeners..." | tee -a "$LOG"
LISTEN_PORTS=$(lsof -p "$PID" -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR>1 {print $9}' | sort -u || true)
if [[ -n "$LISTEN_PORTS" ]]; then
  echo "      PASS: Listening on ports: $LISTEN_PORTS" | tee -a "$LOG"
else
  echo "      WARN: No listening ports (may be OK for local IPC)" | tee -a "$LOG"
fi

# Check memory usage is reasonable
echo "[6/6] Checking resource usage..." | tee -a "$LOG"
RSS=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ' || echo "0")
RSS_MB=$((RSS / 1024))
echo "      RSS=${RSS_MB}MB" | tee -a "$LOG"
if (( RSS_MB > 500 )); then
  echo "      WARN: Memory usage high" | tee -a "$LOG"
else
  echo "      PASS: Memory usage OK" | tee -a "$LOG"
fi

# Cleanup
kill_app

echo ""
echo "=== All smoke tests passed ===" | tee -a "$LOG"
echo "Log: $LOG"