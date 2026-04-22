use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

mod api;
mod config;
mod state;
mod ui_diagnostics;

pub use state::{AppConfig, AppState, UsageData, ModelDetail};

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
fn cmd_get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn cmd_save_config(state: State<AppState>, config: AppConfig) -> Result<(), String> {
    let mut current = state.config.lock().unwrap();
    *current = config.clone();
    config::save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_api_key(state: State<AppState>) -> Option<String> {
    state.api_key.lock().unwrap().clone()
}

#[tauri::command]
fn cmd_set_api_key(state: State<AppState>, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("minimax-usage-monitor", "api_key")
        .map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())?;
    
    let mut api_key = state.api_key.lock().unwrap();
    *api_key = Some(key);
    Ok(())
}

#[tauri::command]
fn cmd_clear_api_key(state: State<AppState>) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new("minimax-usage-monitor", "api_key") {
        let _ = entry.delete_credential();
    }
    
    let mut api_key = state.api_key.lock().unwrap();
    *api_key = None;
    Ok(())
}

#[tauri::command]
async fn cmd_fetch_usage(api_key: String, timeout_ms: u64) -> Result<UsageData, String> {
    api::fetch_minimax_usage(&api_key, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_update_usage_data(state: State<AppState>, data: UsageData) {
    let mut usage = state.usage_data.lock().unwrap();
    *usage = Some(data);
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

fn build_status_text(usage: &UsageData, show_weekly: bool) -> String {
    let current = format_percent(usage.used_percent);
    if show_weekly {
        let weekly = format_percent(usage.weekly_used_percent);
        format!("{} / {}", current, weekly)
    } else {
        current
    }
}

fn format_percent(percent: Option<f64>) -> String {
    match percent {
        Some(p) => format!("{:.0}%", p),
        None => "--".to_string(),
    }
}

fn update_tray_menu(app: &AppHandle, state: &AppState) {
    let usage = state.usage_data.lock().unwrap();
    let config = state.config.lock().unwrap();
    let api_key = state.api_key.lock().unwrap();
    
    let status_text = if let Some(ref data) = *usage {
        build_status_text(data, config.show_weekly_in_status)
    } else if api_key.is_none() {
        "🔑 Set API Key".to_string()
    } else {
        "⏳ Loading...".to_string()
    };
    
    let separator = PredefinedMenuItem::separator(app).unwrap();
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
    let set_key = MenuItem::with_id(app, "set_key", "Set API Key...", true, None::<&str>).unwrap();
    let clear_key = MenuItem::with_id(app, "clear_key", "Clear API Key", true, None::<&str>).unwrap();
    let refresh = MenuItem::with_id(app, "refresh", "Refresh Now", true, None::<&str>).unwrap();
    
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "status", &status_text, false, None::<&str>).unwrap()),
        Box::new(separator),
        Box::new(refresh),
        Box::new(set_key),
        Box::new(clear_key),
    ];
    
    if let Some(ref data) = *usage {
        if data.ok {
            if !data.primary_model_name.is_empty() {
                let model_item = MenuItem::with_id(app, "model", &format!("Model: {}", data.primary_model_name), false, None::<&str>).unwrap();
                items.insert(2, Box::new(model_item));
            }
            
            if !data.interval_label.is_empty() {
                let interval_item = MenuItem::with_id(app, "interval", &format!("Interval: {}", data.interval_label), false, None::<&str>).unwrap();
                items.insert(3, Box::new(interval_item));
            }
            
            if let Some(remaining) = data.remaining_count {
                let remaining_item = MenuItem::with_id(app, "remaining", &format!("Remaining: {}", remaining), false, None::<&str>).unwrap();
                items.insert(4, Box::new(remaining_item));
            }
            
            if let Some(ref weekly_remaining) = data.weekly_remaining_count {
                let weekly_item = MenuItem::with_id(app, "weekly_remaining", &format!("Weekly Left: {}", weekly_remaining), false, None::<&str>).unwrap();
                items.insert(5, Box::new(weekly_item));
            }
            
            if !data.last_updated.is_empty() {
                let sep2 = PredefinedMenuItem::separator(app).unwrap();
                let updated_item = MenuItem::with_id(app, "updated", &format!("Updated: {}", data.last_updated), false, None::<&str>).unwrap();
                items.push(Box::new(sep2));
                items.push(Box::new(updated_item));
            }
        } else {
            let error_item = MenuItem::with_id(app, "error", &format!("⚠️ {}", data.status_label), false, None::<&str>).unwrap();
            items.insert(2, Box::new(error_item));
        }
    }
    
    items.push(Box::new(PredefinedMenuItem::separator(app).unwrap()));
    items.push(Box::new(quit));
    
    let menu = Menu::with_items(app, &items.iter().map(|i| i.as_ref()).collect::<Vec<_>>())
        .unwrap();
    
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_menu(Some(menu));
    }
}

// ============================================================================
// Main Entry Point
// ============================================================================

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting MiniMax Usage Monitor");

    let saved_config = config::load_config().unwrap_or_default();
    
    let saved_api_key = keyring::Entry::new("minimax-usage-monitor", "api_key")
        .ok()
        .and_then(|e| e.get_password().ok());

    let app_state = AppState {
        config: Mutex::new(saved_config),
        api_key: Mutex::new(saved_api_key),
        usage_data: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            // 运行 UI 诊断检查
            ui_diagnostics::run_ui_diagnostics();

            let menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "status", "Loading...", false, None::<&str>).unwrap(),
                &PredefinedMenuItem::separator(app).unwrap(),
                &MenuItem::with_id(app, "refresh", "Refresh Now", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "set_key", "Set API Key...", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "clear_key", "Clear API Key", true, None::<&str>).unwrap(),
                &PredefinedMenuItem::separator(app).unwrap(),
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap(),
            ])?;
            
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    let app_handle = app.clone();
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "refresh" => {
                            let state: State<AppState> = app.state();
                            let api_key = state.api_key.lock().unwrap().clone();
                            if let Some(key) = api_key {
                                tauri::async_runtime::spawn({
                                    let app_h = app_handle.clone();
                                    async move {
                                        match api::fetch_minimax_usage(&key, 15000).await {
                                            Ok(data) => {
                                                let state: State<AppState> = app_h.state();
                                                let mut usage = state.usage_data.lock().unwrap();
                                                *usage = Some(data.clone());
                                                update_tray_menu(&app_h, &state);
                                                let _ = app_h.emit("usage-updated", data);
                                            }
                                            Err(e) => {
                                                log::error!("Refresh failed: {}", e);
                                            }
                                        }
                                    }
                                });
                            }
                        }
                        "set_key" => {
                            let _ = app.emit("show-set-key-dialog", ());
                        }
                        "clear_key" => {
                            let state: State<AppState> = app.state();
                            let mut api_key = state.api_key.lock().unwrap();
                            *api_key = None;
                            drop(api_key);
                            if let Ok(entry) = keyring::Entry::new("minimax-usage-monitor", "api_key") {
                                let _ = entry.delete_credential();
                            }
                            update_tray_menu(app, &state);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        // Show and focus the main window
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let state: State<AppState> = app.state();
                        update_tray_menu(app, &state);
                    }
                })
                .build(app)?;

            // Show the main window on startup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            let app_handle = app.handle().clone();
            let saved_api_key = app_handle.state::<AppState>().api_key.lock().unwrap().clone();
            
            if let Some(key) = saved_api_key {
                let app_h = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    match api::fetch_minimax_usage(&key, 15000).await {
                        Ok(data) => {
                            let state: State<AppState> = app_h.state();
                            let mut usage = state.usage_data.lock().unwrap();
                            *usage = Some(data.clone());
                            update_tray_menu(&app_h, &state);
                            let _ = app_h.emit("usage-updated", data);
                        }
                        Err(e) => {
                            log::error!("Initial fetch failed: {}", e);
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_config,
            cmd_save_config,
            cmd_get_api_key,
            cmd_set_api_key,
            cmd_clear_api_key,
            cmd_fetch_usage,
            cmd_update_usage_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}