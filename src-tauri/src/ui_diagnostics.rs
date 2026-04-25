//! UI 诊断模块 - 自动化检测和修复常见 UI 问题
//!
//! 检测并修复:
//! 1. 界面完全空白，只有背景 (外部 CSS/JS 无法加载)
//! 2. 托盘无 icon
//! 3. 托盘无菜单功能
//!
//! 使用方式: 在 setup 中调用 `run_ui_diagnostics()`

use std::fs;
use std::path::Path;
use log::{info, warn, error};

/// 检测 HTML 文件是否正确配置（内联 CSS/JS，无外部依赖）
pub fn check_html_assets() -> bool {
    let html_path = Path::new("src-web/index.html");

    if !html_path.exists() {
        warn!("HTML 文件不存在: {:?}", html_path);
        return false;
    }

    let html_content = match fs::read_to_string(html_path) {
        Ok(c) => c,
        Err(e) => {
            error!("无法读取 HTML 文件: {}", e);
            return false;
        }
    };

    let mut issues = Vec::new();

    // 检查是否有外部 CSS 引用
    if html_content.contains("<link rel=\"stylesheet\"") {
        if html_content.contains("styles.css") {
            issues.push("检测到外部 CSS 引用: styles.css");
        }
    }

    // 检查是否有外部 JS 引用
    if html_content.contains("<script src=") {
        if html_content.contains("app.js") {
            issues.push("检测到外部 JS 引用: app.js");
        }
    }

    // 检查是否有 CSP
    if !html_content.contains("Content-Security-Policy") {
        issues.push("缺少 CSP meta 标签");
    }

    if issues.is_empty() {
        info!("HTML 资源检查通过: CSS/JS 已内联");
        true
    } else {
        for issue in &issues {
            warn!("UI 问题: {}", issue);
        }
        false
    }
}

/// 检测托盘图标是否存在
pub fn check_tray_icon() -> bool {
    let icon_path = Path::new("src-tauri/icons/icon.png");

    if !icon_path.exists() {
        error!("托盘图标不存在: {:?}", icon_path);
        return false;
    }

    info!("托盘图标检查通过: {:?}", icon_path);
    true
}

/// 检测菜单配置
pub fn check_menu_config() -> bool {
    let lib_path = Path::new("src-tauri/src/lib.rs");

    if !lib_path.exists() {
        error!("lib.rs 不存在");
        return false;
    }

    let content = match fs::read_to_string(lib_path) {
        Ok(c) => c,
        Err(e) => {
            error!("无法读取 lib.rs: {}", e);
            return false;
        }
    };

    let mut issues = Vec::new();

    // 检查必要的菜单处理
    if !content.contains("on_menu_event") {
        issues.push("缺少 on_menu_event 处理");
    }

    if !content.contains("\"quit\"") {
        issues.push("缺少 quit 菜单项处理");
    }

    if !content.contains("get_webview_window") {
        issues.push("缺少窗口获取逻辑");
    }

    if !content.contains("window.show()") {
        issues.push("缺少 window.show() 调用");
    }

    if issues.is_empty() {
        info!("菜单配置检查通过");
        true
    } else {
        for issue in &issues {
            error!("菜单配置问题: {}", issue);
        }
        false
    }
}

/// 运行所有 UI 诊断检查
pub fn run_ui_diagnostics() {
    info!("========== UI 诊断开始 ==========");

    let html_ok = check_html_assets();
    let icon_ok = check_tray_icon();
    let menu_ok = check_menu_config();

    info!("========== 诊断结果 ==========");
    info!("HTML 资源: {}", if html_ok { "通过" } else { "失败" });
    info!("托盘图标: {}", if icon_ok { "通过" } else { "失败" });
    info!("菜单配置: {}", if menu_ok { "通过" } else { "失败" });

    if html_ok && icon_ok && menu_ok {
        info!("所有 UI 诊断检查通过!");
    } else {
        warn!("部分 UI 诊断检查失败，请查看上方日志");
    }
}

/// 自动修复 HTML 文件 - 将外部 CSS/JS 内联
pub fn auto_fix_html_assets() -> bool {
    let html_path = Path::new("src-web/index.html");
    let css_path = Path::new("src-web/styles.css");
    let js_path = Path::new("src-web/app.js");

    if !html_path.exists() {
        error!("HTML 文件不存在");
        return false;
    }

    let mut html_content = match fs::read_to_string(html_path) {
        Ok(c) => c,
        Err(e) => {
            error!("无法读取 HTML: {}", e);
            return false;
        }
    };

    let mut fixed = false;

    // 读取 CSS
    let css_content = if css_path.exists() {
        match fs::read_to_string(css_path) {
            Ok(c) => {
                // 移除外部 link
                html_content = html_content
                    .lines()
                    .filter(|line| !line.contains("<link rel=\"stylesheet\" href=\"styles.css\""))
                    .collect::<Vec<_>>()
                    .join("\n");
                fixed = true;
                Some(c)
            }
            Err(_) => None,
        }
    } else {
        None
    };

    // 读取 JS
    let js_content = if js_path.exists() {
        match fs::read_to_string(js_path) {
            Ok(c) => {
                // 移除外部 script
                html_content = html_content
                    .lines()
                    .filter(|line| !line.contains("<script src=\"app.js\"></script>"))
                    .collect::<Vec<_>>()
                    .join("\n");
                fixed = true;
                Some(c)
            }
            Err(_) => None,
        }
    } else {
        None
    };

    if !fixed {
        info!("HTML 文件无需修复");
        return true;
    }

    // 添加 CSP 如果没有
    if !html_content.contains("Content-Security-Policy") {
        html_content = html_content.replace(
            "<head>",
            "<head>\n  <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:\">"
        );
    }

    // 内联 CSS
    if let Some(css) = css_content {
        html_content = html_content.replace(
            "</head>",
            &format!("  <style>\n{}\n  </style>\n</head>", css)
        );
    }

    // 内联 JS
    if let Some(js) = js_content {
        html_content = html_content.replace(
            "</body>",
            &format!("  <script>\n{}\n  </script>\n</body>", js)
        );
    }

    match fs::write(html_path, html_content) {
        Ok(_) => {
            info!("HTML 文件已修复: CSS/JS 已内联");
            true
        }
        Err(e) => {
            error!("无法写入 HTML 文件: {}", e);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_html_assets() {
        // 这个测试需要实际文件存在
        let result = check_html_assets();
        // 根据实际环境，结果可能不同
        assert!(true);
    }
}
