#!/bin/bash
# Tauri Build Environment Checker
# 在构建机器上运行此脚本以验证环境

set -e

echo "=== Tauri Build Environment Check ==="
echo

# 检查命令函数
check_command() {
    if command -v "$1" &> /dev/null; then
        version=$($1 --version 2>&1 | head -1)
        echo "✓ $1: $version"
        return 0
    else
        echo "✗ $1: NOT FOUND"
        return 1
    fi
}

# 检查 Node.js
echo "--- Node.js ---"
check_command node
node_version=$(node -v | sed 's/v//')
node_major=$(echo $node_version | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
    echo "⚠ Node.js 版本过低，建议 >= 18"
fi

# 检查 npm
echo
echo "--- npm ---"
check_command npm
npm_version=$(npm -v)
echo "  npm: $npm_version"

# 检查 Rust
echo
echo "--- Rust ---"
check_command rustc
check_command cargo

# 检查 Tauri CLI
echo
echo "--- Tauri CLI ---"
if command -v tauri &> /dev/null; then
    tauri_version=$(tauri --version)
    echo "✓ tauri: $tauri_version"
else
    echo "✗ tauri: NOT FOUND (运行: npm install -g @tauri-apps/cli)"
fi

# 检查系统依赖 (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo
    echo "--- Linux 系统依赖 ---"
    
    deps=(
        "libdbus-1-dev"
        "libayatana-appindicator3-dev" 
        "librsvg2-dev"
        "libgtk-3-dev"
        "libwebkit2gtk-4.1-dev"
        "patchelf"
        "pkg-config"
        "build-essential"
    )
    
    for dep in "${deps[@]}"; do
        if dpkg -l | grep -q "^ii  $dep "; then
            echo "✓ $dep"
        else
            echo "✗ $dep"
        fi
    done
    
    echo
    echo "安装缺失依赖:"
    echo "  sudo apt-get install ${deps[*]}"
fi

# 检查 Windows 依赖 (模拟检查)
if [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    echo
    echo "--- Windows 依赖 ---"
    
    # 检查 Visual Studio
    if command -v cl.exe &> /dev/null; then
        echo "✓ Visual Studio Build Tools"
    else
        echo "⚠ Visual Studio Build Tools 未检测到"
    fi
    
    # 检查 WebView2
    if reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" &> /dev/null; then
        echo "✓ WebView2 Runtime"
    else
        echo "⚠ WebView2 Runtime 未检测到"
    fi
fi

echo
echo "=== 检查完成 ==="
echo
echo "开始构建: npm run tauri:build:ci"
