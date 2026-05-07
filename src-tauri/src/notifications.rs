use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn check_and_notify(app: &AppHandle, used_percent: f64, remaining_percent: f64) {
    let state = app.state::<crate::state::AppState>();
    let config = state.config.lock().unwrap();

    if !config.enable_notifications {
        return;
    }

    if used_percent >= 90.0 {
        let _ = app
            .notification()
            .builder()
            .title("⚠️ MiniMax 额度告警")
            .body(&format!(
                "当前窗口额度即将耗尽！仅剩 {:.0}%",
                remaining_percent
            ))
            .show();
    } else if used_percent >= 80.0 {
        let _ = app
            .notification()
            .builder()
            .title("⚡ MiniMax 额度提醒")
            .body(&format!(
                "当前窗口已使用 {:.0}%，请注意配额消耗",
                used_percent
            ))
            .show();
    }
}
