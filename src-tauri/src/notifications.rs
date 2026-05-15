use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Check remaining count and send notification if threshold is reached.
/// 
/// # Arguments
/// * `app` - Tauri app handle
/// * `key_id` - The API key ID (for deduplication/filtering in future)
/// * `key_name` - Display name of the API key
/// * `min_remaining_count` - Minimum remaining request count across all models
pub fn check_and_notify(
    app: &AppHandle,
    key_id: &str,
    key_name: &str,
    min_remaining_count: i64,
) {
    let state = app.state::<crate::state::AppState>();
    let config = state.config.lock().unwrap();

    if !config.enable_notifications {
        return;
    }

    if min_remaining_count <= 5 {
        let _ = app
            .notification()
            .builder()
            .title(&format!("⚠️ {} - 额度告警", key_name))
            .body(&format!(
                "[{}] 最小剩余请求次数即将耗尽！仅剩 {} 次",
                key_id, min_remaining_count
            ))
            .show();
    } else if min_remaining_count <= 20 {
        let _ = app
            .notification()
            .builder()
            .title(&format!("⚡ {} - 额度提醒", key_name))
            .body(&format!(
                "[{}] 最小剩余请求次数仅 {} 次，请注意配额消耗",
                key_id, min_remaining_count
            ))
            .show();
    }
}
