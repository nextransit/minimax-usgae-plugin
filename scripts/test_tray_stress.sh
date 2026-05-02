#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MiniMax Monitor"
APP_PATH="/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"
LOG="/tmp/minimax-tray-stress.log"
> "$LOG"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

kill_app() {
  pkill -f "MiniMax Monitor" 2>/dev/null || true
  sleep 2
}

click_tray_via_osascript() {
  osascript -e '
    tell application "System Events"
      try
        set trayIcon to first menu bar item of menu bar 1 whose description contains "MiniMax"
        click trayIcon
      end try
    end tell
  ' 2>/dev/null || true
}

is_alive() {
  local pid=$1
  kill -0 "$pid" 2>/dev/null && ps -o state= -p "$pid" 2>/dev/null | grep -qv Z
}

get_app_pid() {
  pgrep -f "minimax-usage-monitor" 2>/dev/null | head -1 || true
}

log "=== MiniMax Tray Stress Test ==="
log "Binary: $(stat -f '%Sm' "$APP_PATH/Contents/MacOS/minimax-usage-monitor")"

kill_app

log "[1/7] Launching app..."
open "$APP_PATH" >/dev/null 2>&1
sleep 10

PID=$(get_app_pid)
if [[ -z "$PID" ]]; then
  log "  FAIL: App did not start"
  exit 1
fi
log "  PASS: PID=$PID"

if ! is_alive "$PID"; then
  log "  FAIL: App died during init"
  exit 1
fi
log "  PASS: App stable after init"

log "[2/7] Rapid tray icon clicks (30x, 100ms apart)..."
for i in $(seq 1 30); do
  click_tray_via_osascript
  sleep 0.1
  if ! is_alive "$PID"; then
    log "  FAIL at click $i: App died"
    kill_app
    exit 1
  fi
done
log "  PASS: 30 rapid clicks survived"

log "[3/7] Sustained tray clicks (10x, 500ms apart)..."
for i in $(seq 1 10); do
  click_tray_via_osascript
  sleep 0.5
  if ! is_alive "$PID"; then
    log "  FAIL at click $i: App died"
    kill_app
    exit 1
  fi
done
log "  PASS: 10 sustained clicks survived"

log "[4/7] Tray + menu dismiss interaction..."
for i in $(seq 1 5); do
  click_tray_via_osascript
  sleep 0.3
  osascript -e 'tell application "System Events" to click at {100, 100}' 2>/dev/null || true
  sleep 0.3
  if ! is_alive "$PID"; then
    log "  FAIL at interaction $i: App died"
    kill_app
    exit 1
  fi
done
log "  PASS: 5 tray+menu interactions survived"

log "[5/7] App log check..."
APP_LOG="$HOME/Library/Application Support/minimax-usage-monitor/app.log"
if [[ -f "$APP_LOG" ]]; then
  ERRORS=$(grep -iE 'panic|deadlock|frozen|blocked|timeout|panicked' "$APP_LOG" 2>/dev/null | tail -5 || true)
  if [[ -n "$ERRORS" ]]; then
    log "  WARN: $ERRORS"
  else
    log "  PASS: No freeze/panic in logs"
  fi
fi

log "[6/7] Post-stress stability (10s)..."
sleep 10
if is_alive "$PID"; then
  log "  PASS: Still alive"
else
  log "  FAIL: Died after stress"
  kill_app
  exit 1
fi

log "[7/7] Memory usage..."
RSS=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ' || echo "0")
RSS_MB=$((RSS / 1024))
log "  RSS=${RSS_MB}MB"
if (( RSS_MB > 800 )); then
  log "  WARN: Memory high"
else
  log "  PASS: Memory OK"
fi

kill_app
log ""
log "=== All Tray Stress Tests PASSED ==="