#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MiniMax Monitor"
APP_PATH="/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"
LOG="/tmp/minimax-tray-test.log"
> "$LOG"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

kill_app() {
  pkill -f "MiniMax Monitor" 2>/dev/null || true
  sleep 2
}

# Click tray icon using osascript
click_tray_icon() {
  osascript -e '
    tell application "System Events"
      try
        set trayMenuBarItem to first menu bar item of menu bar 1 whose description contains "MiniMax"
        click trayMenuBarItem
      end try
    end tell
  ' 2>/dev/null || true
}

# Check if app is responsive
check_app() {
  local pid=$1
  if kill -0 "$pid" 2>/dev/null; then
    # Check if the process is actually responsive (not zombie)
    if ps -o state= -p "$pid" 2>/dev/null | grep -qv Z; then
      return 0
    fi
  fi
  return 1
}

log "=== Tray Click Stress Test ==="

kill_app

log "[1/5] Launching app..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
open "$APP_PATH" >/dev/null 2>&1
sleep 8

PID=$(pgrep -f "minimax-usage-monitor" | head -1)
if [[ -z "$PID" ]]; then
  log "  FAIL: App did not start"
  exit 1
fi
log "  PASS: PID=$PID"

log "[2/5] Waiting for app to stabilize (3 refresh cycles)..."
sleep 65  # Wait for ~3 refresh cycles at 20s interval

if ! check_app "$PID"; then
  log "  FAIL: App became unresponsive during stabilization"
  exit 1
fi
log "  PASS: App still responsive"

log "[3/5] Tray click stress test (10 rapid clicks)..."
PASS_COUNT=0
for i in $(seq 1 10); do
  click_tray_icon
  sleep 0.5
  if check_app "$PID"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "    click $i: OK"
  else
    log "    click $i: FAIL - app dead"
    kill_app
    exit 1
  fi
done
log "  PASS: $PASS_COUNT/10 clicks survived"

log "[4/5] Post-click stability (5 seconds)..."
sleep 5
if check_app "$PID"; then
  log "  PASS: Still alive"
else
  log "  FAIL: Died after clicks"
  exit 1
fi

log "[5/5] App log check (no errors)..."
APP_LOG="$HOME/Library/Application Support/minimax-usage-monitor/app.log"
if [[ -f "$APP_LOG" ]]; then
  ERRORS=$(grep -i 'error\|panic\|deadlock\|fatal' "$APP_LOG" 2>/dev/null | tail -5 || true)
  if [[ -n "$ERRORS" ]]; then
    log "  WARN: Found errors in log: $ERRORS"
  else
    log "  PASS: No errors in app.log"
  fi
else
  log "  INFO: No app.log found"
fi

kill_app

log ""
log "=== Tray Click Test PASSED ==="
log "Log: $LOG"