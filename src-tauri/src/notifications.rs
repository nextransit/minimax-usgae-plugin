use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Send a low-quota notification after the caller has checked the risk threshold.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `key_id` - The API key ID (for deduplication/filtering in future)
/// * `key_name` - Display name of the API key
/// * `window` - Quota window that crossed the remaining-ratio threshold
/// * `remaining_count` - Remaining request count for the quota window
/// * `total_count` - Total request count for the quota window
/// * `remaining_ratio` - Remaining count divided by total count
pub fn check_and_notify(
    app: &AppHandle,
    key_id: &str,
    key_name: &str,
    window: &str,
    remaining_count: i64,
    total_count: i64,
    remaining_ratio: f64,
) {
    let state = app.state::<crate::state::AppState>();
    let config = state.config.lock().unwrap();

    if !config.enable_notifications {
        return;
    }

    let window_label = if window == "weekly" {
        "本周"
    } else {
        "当前周期"
    };

    let _ = app
        .notification()
        .builder()
        .title(format!("⚠️ {} - 额度告警", key_name))
        .body(format!(
            "[{}] {}剩余请求次数仅 {} / {}（{:.2}%），即将耗尽！建议降低请求频率或切换模型。",
            key_id,
            window_label,
            remaining_count,
            total_count,
            remaining_ratio * 100.0
        ))
        .show();
}
