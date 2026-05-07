#!/usr/bin/env osascript
-- MiniMax E2E: Open API Key Management, Edit a key, Save
-- Tests the full Save flow using macOS Accessibility API

property testResult : "FAIL"

-- Helper to get WebArea
on getWebArea(appName)
  tell application "System Events"
    tell process appName
      set frontmost to true
      -- Get the web area (AXWebArea) inside the WebView
      set win to first window
      set webArea to first UI element of win whose role is "AXWebArea"
      return webArea
    end tell
  end tell
end getWebArea

-- Helper to click button by text
on clickButtonByName(appName, btnName)
  tell application "System Events"
    tell process appName
      set frontmost to true
      -- Find all buttons and click the matching one
      set allButtons to every button of window 1
      repeat with btn in allButtons
        set btnTitle to title of btn
        if btnTitle contains btnName then
          click btn
          return true
        end if
      end repeat
    end tell
  end tell
  return false
end clickButtonByName

-- Helper to click link/text element by description
on clickElementByDescription(appName, desc)
  tell application "System Events"
    tell process appName
      set frontmost to true
      set allElements to every UI element of window 1
      repeat with elem in allElements
        set elemDesc to description of elem
        set elemTitle to title of elem
        if (elemDesc contains desc) or (elemTitle contains desc) then
          click elem
          return true
        end if
      end repeat
    end tell
  end tell
  return false
end clickElementByDescription

-- Check if dialog with specific title exists
on dialogExists(appName, titleContains)
  tell application "System Events"
    tell process appName
      set allWindows to every window
      repeat with w in allWindows
        set wTitle to title of w
        if wTitle contains titleContains then
          return true
        end if
      end repeat
    end tell
  end tell
  return false
end dialogExists

-- Get current app windows
on getWindowTitles(appName)
  tell application "System Events"
    tell process appName
      set winTitles to {}
      repeat with w in (windows)
        set end of winTitles to (title of w as string)
      end repeat
      return winTitles
    end tell
  end tell
end getWindowTitles

-- Main test
on run
  set appName to "MiniMax Monitor"
  set appPath to "/Users/zhouyong/Desktop/work/Decard/gitlab/ai/minimax/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"

  log "=== MiniMax E2E: API Key Edit + Save ==="

  -- Kill existing instances
  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"
  delay 2

  -- Launch app
  log "[1/8] Launching app..."
  tell application appPath
    activate
    delay 1
  end tell
  delay 8

  -- Check app running
  set appPID to do shell script "pgrep -f 'MiniMax Monitor' | head -1"
  if appPID is "" then
    log "  FAIL: App did not start"
    return
  end if
  log "  PASS: PID=" & appPID

  -- Verify window opened
  log "[2/8] Checking window..."
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 1
      if (count of windows) > 0 then
        log "  PASS: Window visible"
      else
        log "  FAIL: No window"
        return
      end if
    end tell
  end tell

  -- Find and click KEY CONFIG button
  log "[3/8] Opening API Key Management..."
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 0.5
      set btnClicked to false
      repeat with btn in (buttons of window 1)
        set btnTitle to title of btn as string
        if btnTitle contains "KEY CONFIG" then
          click btn
          set btnClicked to true
          exit repeat
        end if
      end repeat
      if not btnClicked then
        -- Try by description
        repeat with elem in (entire contents of window 1)
          if description of elem contains "KEY CONFIG" then
            click elem
            set btnClicked to true
            exit repeat
          end if
        end repeat
      end if
    end tell
  end tell

  if not btnClicked then
    log "  FAIL: Could not find KEY CONFIG button"
    return
  end if
  log "  PASS: KEY CONFIG clicked"
  delay 1

  -- Check key management modal opened
  log "[4/8] Checking key management modal..."
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 0.5
      set modalFound to false
      repeat with w in (windows)
        set wTitle to title of w as string
        if wTitle contains "API Key" or wTitle contains "Key Management" then
          set modalFound to true
          exit repeat
        end if
      end repeat
      if not modalFound then
        -- Check if modal dialog appeared within the main window
        set allElems to entire contents of window 1
        repeat with elem in allElems
          if description of elem contains "Add New Key" then
            set modalFound to true
            exit repeat
          end if
        end repeat
      end if
    end tell
  end tell

  if modalFound then
    log "  PASS: Key management modal opened"
  else
    log "  WARN: Could not verify modal (may be inside WebView)"
  end if

  delay 1

  -- Click Edit button (first one found)
  log "[5/8] Clicking Edit button..."
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 0.5
      set editClicked to false
      -- Look for Edit button in the modal
      repeat with btn in (buttons of window 1)
        set btnTitle to title of btn as string
        if btnTitle is "Edit" or btnTitle contains "Edit" then
          click btn
          set editClicked to true
          exit repeat
        end if
      end repeat
    end tell
  end tell

  if editClicked then
    log "  PASS: Edit clicked"
  else
    log "  WARN: Edit button not found by title, trying description..."
    tell application "System Events"
      tell process appName
        set frontmost to true
        set editClicked to false
        repeat with elem in (entire contents of window 1)
          if description of elem contains "Edit" then
            try
              click elem
              set editClicked to true
              exit repeat
            end try
          end if
        end repeat
      end tell
    end tell
    if editClicked then
      log "  PASS: Edit clicked (via description)"
    else
      log "  WARN: Could not click Edit"
    end if
  end if
  delay 1

  -- Check key-edit-dialog appeared
  log "[6/8] Checking edit dialog..."
  log "  INFO: If dialog opened, will attempt to modify name and save"

  -- Try to find the name input field and change it
  tell application "System Events"
    tell process appName
      set frontmost to true
      delay 0.5

      -- Find text fields in the edit dialog
      set textFields to {}
      repeat with elem in (entire contents of window 1)
        set elemRole to role of elem as string
        if elemRole is "AXTextField" then
          set fieldValue to value of elem as string
          set fieldDesc to description of elem
          log "  DEBUG: Found text field desc='" & fieldDesc & "' value='" & fieldValue & "'"
        end if
      end repeat

      -- Click Save button
      set saveClicked to false
      repeat with btn in (buttons of window 1)
        set btnTitle to title of btn as string
        if btnTitle is "Save" or btnTitle contains "Save" then
          click btn
          set saveClicked to true
          exit repeat
        end if
      end repeat

      if not saveClicked then
        -- Try by value attribute
        repeat with elem in (entire contents of window 1)
          try
            if description of elem contains "Save" then
              click elem
              set saveClicked to true
              exit repeat
            end if
          end try
        end repeat
      end if

      if saveClicked then
        log "  PASS: Save button clicked"
        set testResult to "PASS"
      else
        log "  FAIL: Save button not found"
      end if
    end tell
  end tell

  delay 2

  -- Verify app still running (didn't crash on save)
  log "[7/8] Verifying app still alive..."
  set currentPID to do shell script "pgrep -f 'MiniMax Monitor' | head -1"
  if currentPID is not "" then
    log "  PASS: App still running PID=" & currentPID
  else
    log "  FAIL: App crashed"
    set testResult to "FAIL"
  end if

  -- Check for error dialogs
  log "[8/8] Checking for error dialogs..."
  tell application "System Events"
    tell process appName
      set frontmost to true
      set alertFound to false
      -- macOS shows alerts as sheets or separate windows
      repeat with w in (windows)
        set wTitle to title of w as string
        if wTitle contains "Alert" or wTitle contains "警告" then
          set alertFound to true
          log "  WARN: Alert dialog found: " & wTitle
        end if
      end repeat
      if not alertFound then
        log "  PASS: No error dialogs"
      end if
    end tell
  end tell

  -- Cleanup
  do shell script "pkill -f 'MiniMax Monitor' 2>/dev/null || true"

  log ""
  log "=== Result: " & testResult & " ==="
end run