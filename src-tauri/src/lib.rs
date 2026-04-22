mod api;
mod commands;
mod config;
mod notifications;
mod state;
mod tray;

pub use state::{AppConfig, AppState, UsageData, ModelDetail};
pub use commands::*;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting MiniMax Usage Monitor");

    let saved_config = config::load_config().unwrap_or_default();

    let saved_api_key = keyring::Entry::new("minimax-usage-monitor", "api_key")
        .ok()
        .and_then(|e| e.get_password().ok());

    let app_state = AppState {
        config: std::sync::Mutex::new(saved_config.clone()),
        api_key: std::sync::Mutex::new(saved_api_key),
        usage_data: std::sync::Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .setup(|app| {
            // Setup tray icon
            tray::setup_tray(app)?;

            // Handle window close event - hide instead of quit
            let app_handle = app.handle().clone();
            app.on_window_event(move |window, event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            });

            // Window visibility based on first_run and start_minimized
            if saved_config.first_run {
                // First run: show window
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                // Mark first run complete
                let state: tauri::State<AppState> = app.state();
                let mut config = state.config.lock().unwrap();
                config.first_run = false;
                let _ = config::save_config(&config);
            } else if saved_config.start_minimized {
                // Not first run and start_minimized: keep hidden
                log::info!("Starting minimized to tray");
            } else {
                // Not first run and not start_minimized: show window
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // Initial data fetch if API key exists
            let api_key = saved_api_key.clone();
            if let Some(key) = api_key {
                let app_h = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    match api::fetch_minimax_usage(&key, 15000).await {
                        Ok(data) => {
                            let state: tauri::State<AppState> = app_h.state();

                            // Update usage data
                            {
                                let mut usage = state.usage_data.lock().unwrap();
                                *usage = Some(data.clone());
                            } // Lock released here

                            tray::update_tray_menu(&app_h, &state);
                            let _ = app_h.emit("usage-updated", data.clone());

                            // Check notification using data directly (already owned)
                            if let Some(percent) = data.used_percent {
                                notifications::check_and_notify(&app_h, percent, 100.0 - percent);
                            }
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
            cmd_mark_first_run_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
