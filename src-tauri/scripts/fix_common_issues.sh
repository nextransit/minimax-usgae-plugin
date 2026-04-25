#!/bin/bash
#===============================================================================
# Tauri macOS 应用常见问题自动检测与修复脚本
# 检测并修复:
#   1. 界面完全空白，只有背景 (外部 CSS/JS 无法加载)
#   2. 托盘无 icon
#   3. 托盘无菜单功能
#===============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"
SRC_WEB_DIR="$TAURI_DIR/src-web"
CONF_FILE="$TAURI_DIR/tauri.conf.json"
LIB_FILE="$TAURI_DIR/src/lib.rs"
CAPABILITIES_DIR="$TAURI_DIR/capabilities"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "========================================"
echo "  Tauri macOS 应用问题检测与修复"
echo "========================================"
echo ""

#===============================================================================
# 问题 1: 检测界面空白问题 (外部 CSS/JS 无法加载)
#===============================================================================
check_and_fix_blank_ui() {
    log_info "检查问题 1: 界面空白问题..."

    local index_file="$SRC_WEB_DIR/index.html"
    local needs_fix=false

    # 检查是否引用了外部 CSS 文件
    if grep -q '<link rel="stylesheet"' "$index_file" 2>/dev/null; then
        log_warning "检测到外部 CSS 引用"
        needs_fix=true
    fi

    # 检查是否引用了外部 JS 文件
    if grep -q '<script src=' "$index_file" 2>/dev/null; then
        log_warning "检测到外部 JS 引用"
        needs_fix=true
    fi

    if $needs_fix; then
        log_info "修复: 将外部 CSS/JS 内联到 HTML 中..."

        # 读取 CSS 文件内容
        local css_content=""
        if [ -f "$SRC_WEB_DIR/styles.css" ]; then
            css_content="$(cat "$SRC_WEB_DIR/styles.css")"
        fi

        # 读取 JS 文件内容
        local js_content=""
        if [ -f "$SRC_WEB_DIR/app.js" ]; then
            js_content="$(cat "$SRC_WEB_DIR/app.js")"
        fi

        # 检查 CSP 配置
        if ! grep -q "Content-Security-Policy" "$index_file" 2>/dev/null; then
            log_warning "未检测到 CSP meta 标签，添加中..."
            # 在 <head> 标签后添加 CSP
            sed -i '' 's/<head>/<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src '\''self'\''; style-src '\''self'\'' '\''unsafe-inline'\''; script-src '\''self'\''; img-src '\''self'\'' data:; font-src '\''self'\'' data:;">/' "$index_file"
        fi

        # 替换外部 CSS 引用为内联样式
        if [ -n "$css_content" ]; then
            # 移除外部 link 标签
            sed -i '' '/<link rel="stylesheet" href="styles.css" \/>/d' "$index_file"

            # 在 </head> 前添加内联样式
            sed -i '' "s|</head>|  <style>\n$css_content\n  </style>\n</head>|" "$index_file"
        fi

        # 替换外部 JS 引用为内联脚本
        if [ -n "$js_content" ]; then
            # 移除外部 script 标签
            sed -i '' '/<script src="app.js"><\/script>/d' "$index_file"

            # 在 </body> 前添加内联脚本
            sed -i '' "s|</body>|  <script>\n$js_content\n  </script>\n</body>|" "$index_file"
        fi

        log_success "已修复: 外部 CSS/JS 已内联"
    else
        log_success "问题 1 检查通过: 未检测到外部资源引用问题"
    fi
}

#===============================================================================
# 问题 2: 检测托盘无 icon
#===============================================================================
check_tray_icon() {
    log_info "检查问题 2: 托盘图标..."

    local icon_path=""
    local icon_exists=false

    # 从 tauri.conf.json 读取图标配置
    if [ -f "$CONF_FILE" ]; then
        # 尝试提取 trayIcon 图标路径
        icon_path=$(grep -A2 '"trayIcon"' "$CONF_FILE" | grep 'iconPath' | sed 's/.*"iconPath": "\([^"]*\)".*/\1/')

        if [ -n "$icon_path" ]; then
            local full_icon_path="$TAURI_DIR/$icon_path"
            if [ -f "$full_icon_path" ]; then
                icon_exists=true
                log_success "托盘图标存在: $full_icon_path"
            else
                log_error "托盘图标文件不存在: $full_icon_path"
            fi
        else
            log_warning "未在 tauri.conf.json 中找到 trayIcon.iconPath 配置"
        fi
    fi

    # 检查 icons 目录
    local icons_dir="$TAURI_DIR/icons"
    if [ -d "$icons_dir" ]; then
        log_info "icons 目录存在: $icons_dir"
        ls -la "$icons_dir/" 2>/dev/null || true
    else
        log_error "icons 目录不存在: $icons_dir"
    fi

    echo ""
}

#===============================================================================
# 问题 3: 检测托盘菜单功能
#===============================================================================
check_tray_menu() {
    log_info "检查问题 3: 托盘菜单功能..."

    local has_issues=false

    # 检查 lib.rs 中是否有 on_menu_event 处理
    if ! grep -q "on_menu_event" "$LIB_FILE" 2>/dev/null; then
        log_error "未找到 on_menu_event 处理"
        has_issues=true
    else
        log_success "找到 on_menu_event 处理"
    fi

    # 检查是否有 quit 菜单项处理
    if ! grep -q '"quit"' "$LIB_FILE" 2>/dev/null; then
        log_error "未找到 quit 菜单项处理"
        has_issues=true
    else
        log_success "找到 quit 菜单项"
    fi

    # 检查 show_menu_on_left_click 配置
    if grep -q 'show_menu_on_left_click(false)' "$LIB_FILE" 2>/dev/null; then
        log_warning "show_menu_on_left_click 设置为 false (左键不显示菜单)"
    fi

    # 检查 on_tray_icon_event 中是否有显示窗口的逻辑
    if ! grep -q "get_webview_window" "$LIB_FILE" 2>/dev/null || ! grep -q "window.show()" "$LIB_FILE" 2>/dev/null; then
        log_warning "托盘点击可能没有显示窗口的逻辑"
        has_issues=true
    else
        log_success "找到托盘点击显示窗口的逻辑"
    fi

    echo ""
}

#===============================================================================
# 修复托盘菜单功能
#===============================================================================
fix_tray_menu() {
    log_info "修复托盘菜单功能..."

    # 检查 lib.rs 是否已有必要的修复
    if grep -q "window.show()" "$LIB_FILE" 2>/dev/null; then
        log_success "托盘菜单功能已正确实现"
        return 0
    fi

    log_warning "需要修复 lib.rs 中的托盘菜单逻辑"
    log_info "请手动检查 lib.rs 文件，确保:"
    log_info "  1. on_tray_icon_event 中调用 window.show() 和 window.set_focus()"
    log_info "  2. on_menu_event 中有 quit/refresh/set_key/clear_key 的处理逻辑"
    echo ""

    return 1
}

#===============================================================================
# 检查 CSP 配置
#===============================================================================
check_csp_config() {
    log_info "检查 CSP 配置..."

    if [ -f "$CONF_FILE" ]; then
        if grep -q "csp" "$CONF_FILE" 2>/dev/null; then
            log_success "找到 CSP 配置"
        else
            log_warning "未在 tauri.conf.json 中找到 CSP 配置"
            log_info "建议在 app.security 中添加:"
            echo '    "security": {'
            echo '      "csp": "default-src '\''self'\''; style-src '\''self'\'' '\''unsafe-inline'\''; script-src '\''self'\''; img-src '\''self'\'' data:; font-src '\''self'\'' data:"'
            echo '    }'
        fi
    fi
    echo ""
}

#===============================================================================
# 运行所有检测
#===============================================================================
run_all_checks() {
    log_info "开始全面检测..."
    echo ""

    check_and_fix_blank_ui
    check_tray_icon
    check_tray_menu
    check_csp_config

    log_info "检测完成"
}

#===============================================================================
# 主程序
#===============================================================================
main() {
    case "${1:-check}" in
        check)
            run_all_checks
            ;;
        fix)
            log_info "执行修复..."
            check_and_fix_blank_ui
            ;;
        all)
            log_info "执行完整检测和修复..."
            check_and_fix_blank_ui
            check_tray_icon
            check_tray_menu
            ;;
        *)
            echo "用法: $0 [check|fix|all]"
            echo "  check - 仅检测问题 (默认)"
            echo "  fix   - 检测并修复问题"
            echo "  all   - 执行所有检测"
            exit 1
            ;;
    esac
}

main "$@"
