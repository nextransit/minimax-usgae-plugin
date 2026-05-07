#!/usr/bin/env osascript
-- Check what UI element is visible on app startup

on run
  set appName to "MiniMax Monitor"
  set appPath to "/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"

  -- Kill existing
  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  delay 2

  -- Launch
  tell application appPath
    activate
  end tell
  delay 10

  -- Get all windows and their content
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 2

      -- Get window titles
      set winTitles to {}
      repeat with w in (windows)
        set end of winTitles to (title of w as string)
      end repeat

      -- Check what buttons/texts are visible in the main window
      set visibleTexts to {}
      set visibleButtons to {}

      try
        set allElems to entire contents of window 1
        repeat with elem in allElems
          set elemRole to role of elem as string
          set elemTitle to title of elem as string
          set elemValue to value of elem as string
          set elemDesc to description of elem as string

          if elemRole is "AXStaticText" and elemTitle is not "" then
            set end of visibleTexts to (elemTitle as string)
          end if
          if elemRole is "AXButton" and elemTitle is not "" then
            set end of visibleButtons to (elemTitle as string)
          end if
        end repeat
      on error errMsg
        log "Error getting elements: " & errMsg
      end try

      -- Check if dialog exists
      set hasDialog to false
      repeat with w in (windows)
        set wTitle to title of w as string
        if wTitle contains "Key" or wTitle contains "API" or wTitle contains "输入" or wTitle contains "API Key" then
          set hasDialog to true
        end if
      end repeat

    end tell
  end tell

  set AppleScript's text item delimiters to ", "
  log "Window titles: " & winTitles as string
  log "Visible texts: " & visibleTexts as string
  log "Visible buttons: " & visibleButtons as string
  log "Has API Key dialog: " & hasDialog

  if hasDialog then
    log "ISSUE: API Key dialog is showing on startup!"
  else if (visibleTexts as string) contains "INITIALIZE" then
    log "ISSUE: Empty state (INITIALIZE ACCESS) is showing on startup"
  else if (visibleTexts as string) contains "Dashboard" or (visibleTexts as string) contains "USAGE" then
    log "OK: Dashboard is showing"
  else
    log "UNKNOWN: Need manual check"
  end if

  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
end run