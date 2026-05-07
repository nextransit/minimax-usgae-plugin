#!/usr/bin/env osascript
-- Test: Close app, reopen, verify NO dialog appears on startup

on run
  set appName to "MiniMax Monitor"
  set appPath to "/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"

  -- Step 1: Kill any existing app
  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  delay 2

  -- Step 2: Launch app
  log "Launching app..."
  tell application appPath
    activate
  end tell
  delay 10

  -- Step 3: Check window content
  set result to "UNKNOWN"
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 2

      -- Check if key management modal is showing
      set keyMgmtOpen to false
      set addKeyDialogOpen to false
      set mainDashboardVisible to false

      set allGroups to entire contents of window 1
      repeat with elem in allGroups
        try
          set elemClass to class of elem as string
          if elemClass contains "sheet" or elemClass contains "dialog" then
            set elemTitle to title of elem as string
            if elemTitle contains "Key" or elemTitle contains "Add" then
              set addKeyDialogOpen to true
            end if
          end if
        end try
      end repeat

      -- Check if dashboard is visible (has usage stats)
      repeat with elem in allGroups
        try
          set elemText to description of elem as string
          if elemText contains "当前周期" or elemText contains "本周累计" or elemText contains "已使用" then
            set mainDashboardVisible to true
          end if
        end try
      end repeat

      -- Check for "Add New Key" text (key management modal)
      repeat with elem in allGroups
        try
          set elemText to value of elem as string
          if elemText contains "Add New Key" then
            set keyMgmtOpen to true
          end if
        end try
      end repeat

    end tell
  end tell

  if addKeyDialogOpen then
    log "FAIL: Add API Key dialog is showing on startup!"
    set result to "FAIL"
  else if keyMgmtOpen then
    log "FAIL: Key Management modal showing on startup!"
    set result to "FAIL"
  else if mainDashboardVisible then
    log "PASS: Dashboard visible, no unwanted dialogs"
    set result to "PASS"
  else
    log "WARN: Could not determine window state"
    set result to "WARN"
  end if

  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  log "Result: " & result
end run