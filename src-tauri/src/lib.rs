use tauri::{Emitter, Manager, State};

mod api;
mod commands;
mod config;
mod state;
mod tray;
mod ui_diagnostics;

pub use commands::*;
pub use state::{AppConfig, AppState, UsageData, ModelDetail};
pub use tray::{setup_tray, update_tray_menu, build_status_text};

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

            // Setup tray icon
            setup_tray(app)?;

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
            cmd_update_usage_data,
            cmd_get_autostart,
            cmd_set_autostart,
            cmd_mark_first_run_complete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}