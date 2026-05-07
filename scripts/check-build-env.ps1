# Tauri Build Environment Checker for Windows
# Keep this file ASCII-compatible so Windows PowerShell 5 can read it without a BOM.

Write-Host "=== Tauri Build Environment Check ===" -ForegroundColor Cyan
Write-Host ""

function Test-Command($cmd) {
    try {
        $null = Get-Command $cmd -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Get-Version($cmd) {
    try {
        $version = & $cmd --version 2>&1 | Select-Object -First 1
        return $version
    } catch {
        return "N/A"
    }
}

# Check Node.js
Write-Host "--- Node.js ---" -ForegroundColor Yellow
if (Test-Command "node") {
    $nodeVersion = node -v
    Write-Host "[OK] Node.js: $nodeVersion" -ForegroundColor Green
    
    $nodeMajor = [int]($nodeVersion -replace 'v','' -split '\.' | Select-Object -First 1)
    if ($nodeMajor -lt 18) {
        Write-Host "[WARN] Node.js is too old; recommended >= 18" -ForegroundColor Yellow
    }
} else {
    Write-Host "[ERR] Node.js: NOT FOUND" -ForegroundColor Red
}

# Check npm
Write-Host ""
Write-Host "--- npm ---" -ForegroundColor Yellow
if (Test-Command "npm") {
    $npmVersion = npm -v
    Write-Host "[OK] npm: $npmVersion" -ForegroundColor Green
}

# Check Rust
Write-Host ""
Write-Host "--- Rust ---" -ForegroundColor Yellow
if (Test-Command "rustc") {
    $rustVersion = rustc --version
    Write-Host "[OK] rustc: $rustVersion" -ForegroundColor Green
} else {
    Write-Host "[ERR] rustc: NOT FOUND" -ForegroundColor Red
}

if (Test-Command "cargo") {
    $cargoVersion = cargo --version
    Write-Host "[OK] cargo: $cargoVersion" -ForegroundColor Green
}

# Check Tauri CLI
Write-Host ""
Write-Host "--- Tauri CLI ---" -ForegroundColor Yellow
if (Test-Command "tauri") {
    $tauriVersion = tauri --version
    Write-Host "[OK] tauri: $tauriVersion" -ForegroundColor Green
} else {
    Write-Host "[ERR] tauri: NOT FOUND" -ForegroundColor Red
    Write-Host "  Run: npm install -g @tauri-apps/cli" -ForegroundColor Gray
}

# Check Visual Studio Build Tools
Write-Host ""
Write-Host "--- Visual Studio ---" -ForegroundColor Yellow
if (Test-Command "cl") {
    Write-Host "[OK] Visual Studio Build Tools" -ForegroundColor Green
} else {
    Write-Host "[WARN] Visual Studio Build Tools not found in PATH" -ForegroundColor Yellow
    Write-Host "  Download: https://visualstudio.microsoft.com/downloads/" -ForegroundColor Gray
    Write-Host "  Select: Desktop development with C++" -ForegroundColor Gray
}

# Check WebView2
Write-Host ""
Write-Host "--- WebView2 ---" -ForegroundColor Yellow
$webview2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if ($webview2) {
    Write-Host "[OK] WebView2 Runtime: $($webview2.pv)" -ForegroundColor Green
} else {
    $webview2v2 = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
    if ($webview2v2) {
        Write-Host "[OK] WebView2 Runtime: $($webview2v2.pv)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] WebView2 Runtime not found" -ForegroundColor Yellow
        Write-Host "  Download: https://developer.microsoft.com/en-us/microsoft-edge/webview2/" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== Check complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Build command: npm run tauri:build:ci" -ForegroundColor Green
