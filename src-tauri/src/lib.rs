mod api;
mod api_key_store;
mod commands;
mod config;
mod notifications;
mod state;
mod tray;
mod tray_icon;

use tauri::{Emitter, Manager};

pub use state::{AppConfig, AppState, UsageData, ModelDetail};
pub use commands::*;

// Include frontend resources directly using include_str!
// This ensures the frontend is bundled with the binary
const FRONTEND_HTML: &str = include_str!("../../src-web/index.html");
const FRONTEND_CSS: &str = include_str!("../../src-web/styles.css");
const FRONTEND_JS: &str = include_str!("../../src-web/app.js");

// Use frontend resources to prevent unused warnings
fn _use_frontend_resources() {
    println!("Frontend HTML length: {}", FRONTEND_HTML.len());
    println!("Frontend CSS length: {}", FRONTEND_CSS.len());
    println!("Frontend JS length: {}", FRONTEND_JS.len());
}

pub fn run() {
    // Log frontend resource sizes to verify they are embedded
    log::info!("Frontend resources: HTML {} bytes, CSS {} bytes, JS {} bytes",
        FRONTEND_HTML.len(), FRONTEND_CSS.len(), FRONTEND_JS.len());

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting MiniMax Usage Monitor");

    let saved_config = config::load_config().unwrap_or_default();

    let saved_api_key = api_key_store::load_api_key();

    // Copy config values for use in closure (since we move saved_config into app_state)
    let first_run = saved_config.first_run;
    let start_minimized = saved_config.start_minimized;
    let api_key_for_fetch = saved_api_key.clone();

    let app_state = AppState {
        config: std::sync::Mutex::new(saved_config.clone()),
        api_key: std::sync::Mutex::new(saved_api_key),
        usage_data: std::sync::Mutex::new(None),
        tray: std::sync::Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .setup(move |app| {
            // Setup tray icon
            tray::setup_tray(app)?;

            // Handle window close event - hide instead of quit
            let app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        window_clone.hide().unwrap();
                        api.prevent_close();
                    }
                });
            }

            // Window visibility based on first_run and start_minimized
            if first_run {
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
            } else if start_minimized {
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
            if let Some(key) = api_key_for_fetch {
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
            cmd_debug_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
