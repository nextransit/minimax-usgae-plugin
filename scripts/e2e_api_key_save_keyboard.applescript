#!/usr/bin/env osascript
-- MiniMax E2E: API Key Management Save via keyboard navigation

on Log(msg)
  do shell script "echo '[LOG] " & msg & "' >> /tmp/minimax-e2e-log.txt"
end Log

on run
  set appName to "MiniMax Monitor"
  set appPath to "/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"
  set testResult to "FAIL"

  do shell script "rm -f /tmp/minimax-e2e-log.txt"

  Log("=== MiniMax E2E: API Key Edit + Save ===")

  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  delay 2

  Log("[1/8] Launching app...")
  tell application appPath
    activate
  end tell
  delay 8

  set appPID to do shell script "pgrep -f 'MiniMax Monitor' | head -1"
  if appPID is "" then
    Log("  FAIL: App did not start")
    return
  end if
  Log("  PASS: PID=" & appPID)

  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 1
      if (count of windows) < 1 then
        Log("  FAIL: No window")
        return
      end if
    end tell
  end tell
  Log("[2/8] PASS: Window visible")

  -- Tab to KEY CONFIG
  Log("[3/8] KEY CONFIG: Tabx3 + Enter...")
  tell application "System Events"
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 36
  end tell
  delay 2

  -- Tab to Edit
  Log("[4/8] Edit: Tabx3 + Enter...")
  tell application "System Events"
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 36
  end tell
  delay 1.5

  -- Type new name
  set newName to "Test Key " & (do shell script "date +%H%M%S")
  Log("[5/8] Typing new name: " & newName)
  tell application "System Events"
    keystroke "a" using command down
    delay 0.2
    keystroke newName
  end tell
  delay 0.5

  -- Tab to Save
  Log("[6/8] Save: Tabx2 + Enter...")
  tell application "System Events"
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 48
    delay 0.3
    key code 36
  end tell
  delay 3

  -- App alive?
  set currentPID to do shell script "pgrep -f 'MiniMax Monitor' | head -1"
  if currentPID is not "" then
    Log("[7/8] PASS: App alive PID=" & currentPID)
  else
    Log("[7/8] FAIL: App crashed")
    return
  end if

  -- Error alerts?
  set alertFound to false
  tell application "System Events"
    tell process appName
      repeat with w in (windows)
        set wTitle to title of w as string
        if wTitle contains "Alert" or wTitle contains "警告" then
          set alertFound to true
        end if
      end repeat
    end tell
  end tell

  if not alertFound then
    Log("[8/8] PASS: No error alerts - Save OK")
    set testResult to "PASS"
  else
    Log("[8/8] WARN: Alert was shown")
  end if

  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  Log("")
  Log("=== Result: " & testResult & " ===")

  do shell script "cat /tmp/minimax-e2e-log.txt"
end run