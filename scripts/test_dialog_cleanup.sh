#!/usr/bin/env bash
set -euo pipefail

APP_NAME="MiniMax Monitor"
APP_PATH="/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"
LOG="/tmp/minimax-dialog-test.log"
> "$LOG"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

kill_app() {
  pkill -f "MiniMax Monitor" 2>/dev/null || true
  sleep 2
}

get_win_count() {
  osascript -e '
    tell application "System Events"
      tell process "MiniMax Monitor"
        count of windows
      end tell
    end tell
  ' 2>/dev/null || echo "0"
}

log "=== Dialog Cleanup Test ==="
kill_app

# Step 1: Fresh launch
log "[1/6] Fresh launch..."
open "$APP_PATH" >/dev/null 2>&1
sleep 10
WIN_COUNT=$(get_win_count)
log "  Window count: $WIN_COUNT"
if [[ "$WIN_COUNT" == "1" ]]; then
  log "  PASS: Dashboard only"
else
  log "  FAIL: Extra dialogs on fresh launch"
fi

# Step 2: Open KEY CONFIG modal
log "[2/6] Opening KEY CONFIG..."
osascript -e '
  tell application "System Events"
    tell process "MiniMax Monitor"
      set frontmost to true
      delay 1
      try
        repeat with btn in (buttons of window 1)
          set btnTitle to title of btn as string
          if btnTitle contains "配置密钥" or btnTitle contains "KEY CONFIG" then
            click btn
            exit repeat
          end if
        end repeat
      end try
    end tell
  end tell
' 2>/dev/null || true
sleep 2

# Step 3: Click "+ Add New Key"
log "[3/6] Clicking Add New Key..."
osascript -e '
  tell application "System Events"
    tell process "MiniMax Monitor"
      set frontmost to true
      delay 1
      try
        repeat with btn in (buttons of window 1)
          if title of btn contains "Add New Key" then
            click btn
            exit repeat
          end if
        end repeat
      end try
    end tell
  end tell
' 2>/dev/null || true
sleep 2
WIN_COUNT=$(get_win_count)
log "  Window count after Add: $WIN_COUNT"

# Step 4: Close window (Cmd+W = hide to tray)
log "[4/6] Closing window (Cmd+W)..."
osascript -e 'tell application "System Events" to keystroke "w" using command down' 2>/dev/null || true
sleep 3
WIN_COUNT=$(get_win_count)
log "  Window count after close: $WIN_COUNT (0=hidden)"

# Step 5: Re-launch app
log "[5/6] Re-launching app..."
open "$APP_PATH" >/dev/null 2>&1
sleep 10
WIN_COUNT=$(get_win_count)
if [[ "$WIN_COUNT" == "1" ]]; then
  log "  PASS: No dialogs on re-launch"
else
  log "  FAIL: Previous dialogs persisted! Windows: $WIN_COUNT"
fi

# Step 6: Health check
PID=$(pgrep -f "minimax-usage-monitor" | head -1)
if [[ -n "$PID" ]]; then
  RSS=$(ps -o rss= -p "$PID" | tr -d ' ')
  RSS_MB=$((RSS / 1024))
  log "[6/6] App alive RSS=${RSS_MB}MB - PASS"
else
  log "[6/6] App dead - FAIL"
fi

kill_app
log ""
log "=== Test Complete ==="
