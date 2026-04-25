use crate::state::{AppConfig, AppState, UsageData};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn cmd_debug_state(state: State<AppState>) -> String {
    let api_key = state.api_key.lock().unwrap();
    let has_key = api_key.is_some();
    let key_len = api_key.as_ref().map(|k| k.len()).unwrap_or(0);
    log::debug!("cmd_debug_state called, returning: has_api_key: {}, key_length: {}", has_key, key_len);
    format!("has_api_key: {}, key_length: {}", has_key, key_len)
}

#[tauri::command]
pub fn cmd_get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn cmd_save_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<(), String> {
    {
        let mut current = state.config.lock().unwrap();
        *current = config.clone();
    }
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_get_api_key(state: State<AppState>) -> Option<String> {
    let key = state.api_key.lock().unwrap().clone();
    log::debug!("cmd_get_api_key returning: {:?} (is_some: {})", key, key.is_some());
    key
}

#[tauri::command]
pub fn cmd_set_api_key(app: AppHandle, state: State<AppState>, key: String) -> Result<(), String> {
    crate::api_key_store::save_api_key(&key)?;

    let mut api_key = state.api_key.lock().unwrap();
    *api_key = Some(key);
    drop(api_key);
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn cmd_clear_api_key(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    crate::api_key_store::clear_api_key()?;

    {
        let mut api_key = state.api_key.lock().unwrap();
        *api_key = None;
    }
    {
        let mut usage = state.usage_data.lock().unwrap();
        *usage = None;
    }
    crate::tray::update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub async fn cmd_fetch_usage(api_key: String, timeout_ms: u64) -> Result<UsageData, String> {
    crate::api::fetch_minimax_usage(&api_key, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_update_usage_data(app: AppHandle, state: State<AppState>, data: UsageData) {
    {
        let mut usage = state.usage_data.lock().unwrap();
        *usage = Some(data);
    }
    crate::tray::update_tray_menu(&app, &state);
}

#[tauri::command]
pub async fn cmd_get_autostart(app: AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
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
