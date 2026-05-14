use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn check_and_notify(app: &AppHandle, min_remaining_count: i64) {
    let state = app.state::<crate::state::AppState>();
    let config = state.config.lock().unwrap();

    if !config.enable_notifications {
        return;
    }

    if min_remaining_count <= 5 {
        let _ = app
            .notification()
            .builder()
            .title("⚠️ MiniMax 额度告警")
            .body(&format!(
                "最小剩余请求次数即将耗尽！仅剩 {} 次",
                min_remaining_count
            ))
            .show();
    } else if min_remaining_count <= 20 {
        let _ = app
            .notification()
            .builder()
            .title("⚡ MiniMax 额度提醒")
            .body(&format!(
                "最小剩余请求次数仅 {} 次，请注意配额消耗",
                min_remaining_count
            ))
            .show();
    }
}
