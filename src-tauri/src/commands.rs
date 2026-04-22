use crate::state::{AppConfig, AppState, UsageData};
use tauri::{AppHandle, State, Manager};
use keyring;

#[tauri::command]
pub fn cmd_get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn cmd_save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current = state.config.lock().unwrap();
    *current = config.clone();
    crate::config::save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_api_key(state: State<AppState>) -> Option<String> {
    state.api_key.lock().unwrap().clone()
}

#[tauri::command]
pub fn cmd_set_api_key(state: State<AppState>, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("minimax-usage-monitor", "api_key")
        .map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())?;

    let mut api_key = state.api_key.lock().unwrap();
    *api_key = Some(key);
    Ok(())
}

#[tauri::command]
pub fn cmd_clear_api_key(state: State<AppState>) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new("minimax-usage-monitor", "api_key") {
        let _ = entry.delete_credential();
    }

    let mut api_key = state.api_key.lock().unwrap();
    *api_key = None;
    Ok(())
}

#[tauri::command]
pub async fn cmd_fetch_usage(api_key: String, timeout_ms: u64) -> Result<UsageData, String> {
    crate::api::fetch_minimax_usage(&api_key, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_update_usage_data(state: State<AppState>, data: UsageData) {
    let mut usage = state.usage_data.lock().unwrap();
    *usage = Some(data);
}

#[tauri::command]
pub async fn cmd_get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .map_err(|e| e.to_string())?
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch().map_err(|e| e.to_string())?;
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_mark_first_run_complete(state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.first_run = false;
    crate::config::save_config(&config).map_err(|e| e.to_string())
}