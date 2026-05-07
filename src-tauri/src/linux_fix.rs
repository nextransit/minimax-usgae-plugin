//! Linux 专用的主窗口修复
//!
//! 解决 Tauri 2.x 在部分 Linux 发行版（尤其是 Wayland / 某些 WebKitGTK
//! 版本）上启动后 UI 无法响应点击的问题

use tauri::{Manager, PhysicalSize, WebviewWindow};

/// 延迟时间，等待 GTK realize
const REALIZE_WAIT_MS: u64 = 200;
/// 伪 resize 操作的间隔
const RESIZE_GAP_MS: u64 = 50;

/// 修复 Linux 窗口 focus 问题
///
/// 通过以下步骤修复窗口无法获得焦点的问题：
/// 1. 第一次 set_focus（通常无效，但成本低）
/// 2. 等待 GTK realize 后第二次 set_focus
/// 3. 伪 resize 触发 size_allocate 事件
pub fn nudge_main_window(window: WebviewWindow) {
    let _ = window.set_focus();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(REALIZE_WAIT_MS)).await;
        let _ = window.set_focus();

        // 伪 resize 触发 size_allocate
        match window.inner_size() {
            Ok(original) => {
                let bumped = PhysicalSize::new(original.width.saturating_add(1), original.height);
                let _ = window.set_size(tauri::Size::Physical(bumped));
                tokio::time::sleep(std::time::Duration::from_millis(RESIZE_GAP_MS)).await;
                let _ = window.set_size(tauri::Size::Physical(original));
            }
            Err(e) => {
                log::warn!("Failed to get window inner size: {}", e);
            }
        }
    });
}

/// 检查是否需要注册深链接处理器
/// Linux 上需要检查 .desktop 文件是否存在
pub fn should_register_deep_link(app: &tauri::App) -> bool {
    #[cfg(target_os = "linux")]
    {
        if let Ok(data_dir) = app.path().data_dir() {
            let desktop_file = data_dir.join("applications/minimax-usage-monitor-handler.desktop");
            return !desktop_file.exists();
        }
    }
    false
}

/// 注册 Linux 深链接处理器
#[cfg(target_os = "linux")]
pub fn register_deep_link_handler(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    let data_dir = app.path().data_dir()?;
    let applications_dir = data_dir.join("applications");
    fs::create_dir_all(&applications_dir)?;

    let desktop_file = applications_dir.join("minimax-usage-monitor-handler.desktop");

    if desktop_file.exists() {
        return Ok(());
    }

    let exe_path = std::env::current_exe()?;
    let exe_path_str = exe_path.to_string_lossy();

    let desktop_content = format!(
        r#"[Desktop Entry]
Name=MiniMax Monitor
Comment=MiniMax API Usage Monitor
Exec={} --deep-link "%u"
Icon=minimax-usage-monitor
Terminal=false
Type=Application
Categories=Utility;
MimeType=x-scheme-handler/minimax-usage-monitor;
"#,
        exe_path_str
    );

    fs::write(&desktop_file, desktop_content)?;
    log::info!("Registered deep link handler at {:?}", desktop_file);

    Ok(())
}
