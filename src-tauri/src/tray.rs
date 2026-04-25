use crate::state::{AppState, UsageData};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent, TrayIcon},
    AppHandle, Emitter, Manager, State,
};
use std::time::{Duration, Instant};


#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSBaselineOffsetAttributeName, NSFont, NSFontAttributeName, NSFontWeightRegular,
    NSKernAttributeName,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    NSAttributedString, NSAttributedStringKey, NSDictionary, NSNumber, NSObject, NSString,
};

#[cfg(target_os = "macos")]
fn render_m_icon() -> Image<'static> {
    const W: u32 = 18;
    const H: u32 = 18;
    let mut rgba = vec![0u8; (W * H * 4) as usize];

    const BG_R: u8 = 0;
    const BG_G: u8 = 191;
    const BG_B: u8 = 255;
    const FG_R: u8 = 255;
    const FG_G: u8 = 255;
    const FG_B: u8 = 255;

    let draw_px = |rgba: &mut [u8], x: u32, y: u32, r: u8, g: u8, b: u8| {
        if x < W && y < H {
            let idx = ((y * W + x) * 4) as usize;
            rgba[idx] = r;
            rgba[idx + 1] = g;
            rgba[idx + 2] = b;
            rgba[idx + 3] = 255;
        }
    };

    for y in 0..H {
        for x in 0..W {
            draw_px(&mut rgba, x, y, BG_R, BG_G, BG_B);
        }
    }

    for y in 2..16 {
        draw_px(&mut rgba, 3, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 4, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 13, y, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 14, y, FG_R, FG_G, FG_B);
    }
    for i in 0..6 {
        draw_px(&mut rgba, 5 + i, 2 + i, FG_R, FG_G, FG_B);
        draw_px(&mut rgba, 12 - i, 2 + i, FG_R, FG_G, FG_B);
    }

    Image::new_owned(rgba, W, H)
}

#[cfg(target_os = "macos")]
fn set_tray_title_with_color(tray: &TrayIcon, title: Option<&str>) {
    let Some(title) = title else {
        let _ = tray.set_title(Option::<&str>::None);
        return;
    };

    // 先走标准 title，随后用 attributedTitle 覆盖，实现更好的数字稳定与视觉对齐。
    let _ = tray.set_title(Some(title));
    set_macos_attributed_tray_title(tray, title);
}

#[cfg(target_os = "macos")]
fn set_macos_attributed_tray_title(tray: &TrayIcon, title: &str) {
    let title_string = title.to_string();
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(status_item) = inner.ns_status_item() else {
            return;
        };
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(button) = status_item.button(mtm) else {
            return;
        };

        let font = unsafe { NSFont::monospacedDigitSystemFontOfSize_weight(12.0, NSFontWeightRegular) };
        let baseline = NSNumber::new_f64(-0.35);
        let kern = NSNumber::new_f64(0.15);
        let title_ns = NSString::from_str(&title_string);

        let attributed_title = unsafe {
            let keys: [&NSAttributedStringKey; 3] = [
                NSFontAttributeName,
                NSBaselineOffsetAttributeName,
                NSKernAttributeName,
            ];
            let values: [&NSObject; 3] = [font.as_ref(), baseline.as_ref(), kern.as_ref()];
            let attributes = NSDictionary::from_slices(&keys, &values);
            let attributes = attributes.cast_unchecked::<NSAttributedStringKey, AnyObject>();
            NSAttributedString::new_with_attributes(&title_ns, attributes)
        };

        button.setAttributedTitle(&attributed_title);
    });
}

#[cfg(not(target_os = "macos"))]
fn set_tray_title_with_color(_tray: &TrayIcon, title: Option<&str>) {
    let _ = _tray.set_title(title);
}

struct TrayI18n {
    app_name: &'static str,
    set_key_hint: &'static str,
    loading_hint: &'static str,
    quit: &'static str,
    set_key: &'static str,
    clear_key: &'static str,
    refresh: &'static str,
    show_percent_toggle: &'static str,
    model_prefix: &'static str,
    interval_prefix: &'static str,
    remaining_prefix: &'static str,
    weekly_remaining_prefix: &'static str,
    updated_prefix: &'static str,
}

fn tray_i18n(language: &str) -> TrayI18n {
    if is_chinese_language(language) {
        TrayI18n {
            app_name: "MiniMax 监控",
            set_key_hint: "🔑 请设置 API Key",
            loading_hint: "⏳ 正在加载...",
            quit: "退出",
            set_key: "设置 API Key...",
            clear_key: "清除 API Key",
            refresh: "立即刷新",
            show_percent_toggle: "在托盘栏显示使用比例",
            model_prefix: "模型",
            interval_prefix: "周期",
            remaining_prefix: "剩余",
            weekly_remaining_prefix: "本周剩余",
            updated_prefix: "更新时间",
        }
    } else {
        TrayI18n {
            app_name: "MiniMax Monitor",
            set_key_hint: "🔑 Set API Key",
            loading_hint: "⏳ Loading...",
            quit: "Quit",
            set_key: "Set API Key...",
            clear_key: "Clear API Key",
            refresh: "Refresh Now",
            show_percent_toggle: "Show Usage Percent in Tray",
            model_prefix: "Model",
            interval_prefix: "Interval",
            remaining_prefix: "Remaining",
            weekly_remaining_prefix: "Weekly Left",
            updated_prefix: "Updated",
        }
    }
}

fn is_chinese_language(language: &str) -> bool {
    if language.eq_ignore_ascii_case("zh-CN") || language.eq_ignore_ascii_case("zh") {
        return true;
    }
    if !language.eq_ignore_ascii_case("auto") {
        return false;
    }
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .any(|locale| locale.to_ascii_lowercase().contains("zh"))
}

pub fn build_status_text(usage: &UsageData, show_percent: bool) -> String {
    if !show_percent {
        return "MiniMax Monitor".to_string();
    }

    format_tray_usage(usage.used_percent, usage.weekly_used_percent)
        .unwrap_or_else(|| "%--/%--".to_string())
}

fn format_percent(percent: Option<f64>) -> Option<String> {
    percent.map(|p| format!("{:.0}", p))
}

fn format_compact_percent(percent: Option<f64>) -> Option<String> {
    // compact macOS status metric style: %3 / %68
    // keep token count minimal for quick-glance recognition.
    format_percent(percent).map(|p| format!("%{}", p))
}

fn format_tray_usage(current_percent: Option<f64>, weekly_percent: Option<f64>) -> Option<String> {
    match (format_compact_percent(current_percent), format_compact_percent(weekly_percent)) {
        (Some(current), Some(weekly)) => Some(format!("{}/{}", current, weekly)),
        (Some(current), None) => Some(format!("{}/%--", current)),
        (None, Some(weekly)) => Some(format!("%--/{}", weekly)),
        (None, None) => None,
    }
}

#[cfg(target_os = "macos")]
fn resolve_tray_icon(_app: &tauri::App) -> Option<Image<'static>> {
    Some(render_m_icon())
}

#[cfg(not(target_os = "macos"))]
fn resolve_tray_icon(app: &tauri::App) -> Option<Image<'static>> {
    if let Some(icon) = app.default_window_icon() {
        return Some(icon.clone().to_owned());
    }
    Image::from_bytes(include_bytes!("../icons/icon.png")).ok()
}

pub fn update_tray_menu(app: &AppHandle, state: &AppState) {
    let usage = state.usage_data.lock().unwrap();
    let config = state.config.lock().unwrap();
    let api_key = state.api_key.lock().unwrap();
    let i18n = tray_i18n(&config.language);

    let status_text = if let Some(ref data) = *usage {
        build_status_text(data, config.show_percent_in_tray)
    } else if api_key.is_none() {
        if config.show_percent_in_tray {
            i18n.set_key_hint.to_string()
        } else {
            i18n.app_name.to_string()
        }
    } else {
        if config.show_percent_in_tray {
            i18n.loading_hint.to_string()
        } else {
            i18n.app_name.to_string()
        }
    };

    let separator = PredefinedMenuItem::separator(app).unwrap();
    let quit = MenuItem::with_id(app, "quit", i18n.quit, true, None::<&str>).unwrap();
    let set_key = MenuItem::with_id(app, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key = MenuItem::with_id(app, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    let refresh = MenuItem::with_id(app, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    let toggle_show_percent = CheckMenuItem::with_id(
        app,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        config.show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "status", &status_text, false, None::<&str>).unwrap()),
        Box::new(separator),
        Box::new(refresh),
        Box::new(toggle_show_percent),
        Box::new(set_key),
        Box::new(clear_key),
    ];

    if let Some(ref data) = *usage {
        if data.ok {
            if !data.primary_model_name.is_empty() {
                let model_item = MenuItem::with_id(
                    app,
                    "model",
                    &format!("{}: {}", i18n.model_prefix, data.primary_model_name),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(2, Box::new(model_item));
            }

            if !data.interval_label.is_empty() {
                let interval_item = MenuItem::with_id(
                    app,
                    "interval",
                    &format!("{}: {}", i18n.interval_prefix, data.interval_label),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(3, Box::new(interval_item));
            }

            if let Some(remaining) = data.remaining_count {
                let remaining_item = MenuItem::with_id(
                    app,
                    "remaining",
                    &format!("{}: {}", i18n.remaining_prefix, remaining),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(4, Box::new(remaining_item));
            }

            if let Some(ref weekly_remaining) = data.weekly_remaining_count {
                let weekly_item = MenuItem::with_id(
                    app,
                    "weekly_remaining",
                    &format!("{}: {}", i18n.weekly_remaining_prefix, weekly_remaining),
                    false,
                    None::<&str>,
                )
                .unwrap();
                items.insert(5, Box::new(weekly_item));
            }

            if !data.last_updated.is_empty() {
                let sep2 = PredefinedMenuItem::separator(app).unwrap();
                let updated_item = MenuItem::with_id(
                    app,
                    "updated",
                    &format!("{}: {}", i18n.updated_prefix, data.last_updated),
                    false,
                    None::<&str>,
                )
                .unwrap();
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

    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        let tray_title = if config.show_percent_in_tray {
            usage
                .as_ref()
                .and_then(|data| format_tray_usage(data.used_percent, data.weekly_used_percent))
                .unwrap_or_else(|| "MM".to_string())
        } else {
            "MM".to_string()
        };

        set_tray_title_with_color(tray, Some(&tray_title));

        if let Err(e) = tray.set_menu(Some(menu)) {
            log::error!("Failed to update tray menu: {}", e);
        }
    }
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let state: State<AppState> = app_handle.state();
    let (language, show_percent_in_tray) = {
        let cfg = state.config.lock().unwrap();
        (cfg.language.clone(), cfg.show_percent_in_tray)
    };
    let i18n = tray_i18n(&language);

    let menu = Menu::with_items(&app_handle, &[
        &MenuItem::with_id(&app_handle, "status", i18n.loading_hint, false, None::<&str>).unwrap(),
        &PredefinedMenuItem::separator(&app_handle).unwrap(),
        &MenuItem::with_id(&app_handle, "refresh", i18n.refresh, true, None::<&str>).unwrap(),
        &CheckMenuItem::with_id(
            &app_handle,
            "toggle_show_percent",
            i18n.show_percent_toggle,
            true,
            show_percent_in_tray,
            None::<&str>,
        )
        .unwrap(),
        &MenuItem::with_id(&app_handle, "set_key", i18n.set_key, true, None::<&str>).unwrap(),
        &MenuItem::with_id(&app_handle, "clear_key", i18n.clear_key, true, None::<&str>).unwrap(),
        &PredefinedMenuItem::separator(&app_handle).unwrap(),
        &MenuItem::with_id(&app_handle, "quit", i18n.quit, true, None::<&str>).unwrap(),
    ])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MiniMax Usage Monitor")
        .show_menu_on_left_click(false);

    if let Some(icon) = resolve_tray_icon(app) {
        tray_builder = tray_builder.icon(icon);
    }

    #[cfg(target_os = "macos")]
    {
        // 恢复青色底 M 图标：禁用模板渲染，保持原始配色
        tray_builder = tray_builder.icon_as_template(false);
    }

    let tray_ready_at = Instant::now();

    let tray = tray_builder
        .on_menu_event(move |app, event| {
            let app_h = app.clone();
            match event.id.as_ref() {
                "quit" => {
                    app.exit(0);
                }
                "refresh" => {
                    let state: State<AppState> = app.state();
                    let api_key = state.api_key.lock().unwrap().clone();
                    if let Some(key) = api_key {
                        tauri::async_runtime::spawn({
                            let app_h_clone = app_h.clone();
                            async move {
                                match crate::api::fetch_minimax_usage(&key, 15000).await {
                                    Ok(data) => {
                                        let state: State<AppState> = app_h_clone.state();
                                        let mut usage = state.usage_data.lock().unwrap();
                                        *usage = Some(data.clone());
                                        update_tray_menu(&app_h_clone, &state);
                                        let _ = app_h_clone.emit("usage-updated", data);
                                    }
                                    Err(e) => {
                                        log::error!("Refresh failed: {}", e);
                                        let _ = app_h_clone.emit("usage-error", e.to_string());
                                    }
                                }
                            }
                        });
                    }
                }
                "set_key" => {
                    if tray_ready_at.elapsed() < Duration::from_millis(1500) {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "clear_key" => {
                    let state: State<AppState> = app.state();
                    if let Err(e) = crate::api_key_store::clear_api_key() {
                        log::error!("Failed to clear API key from tray action: {}", e);
                    }
                    {
                        let mut api_key = state.api_key.lock().unwrap();
                        *api_key = None;
                    }
                    {
                        let mut usage = state.usage_data.lock().unwrap();
                        *usage = None;
                    }
                    update_tray_menu(app, &state);
                }
                "toggle_show_percent" => {
                    let state: State<AppState> = app.state();
                    {
                        let mut config = state.config.lock().unwrap();
                        config.show_percent_in_tray = !config.show_percent_in_tray;
                        if let Err(e) = crate::config::save_config(&config) {
                            log::error!("Failed to save config for tray percent toggle: {}", e);
                        }
                    }
                    update_tray_menu(app, &state);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let state: State<AppState> = app.state();
                update_tray_menu(app, &state);
            }
        })
        .build(app)?;

    *state.tray.lock().unwrap() = Some(tray);
    update_tray_menu(&app_handle, &state);

    Ok(())
}
