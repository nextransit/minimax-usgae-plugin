use crate::state::{AppState, UsageData};
use std::time::{Duration, Instant};
#[cfg(not(target_os = "macos"))]
use crate::tray_icon;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

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
fn set_tray_title_with_color(app: &AppHandle, tray: &TrayIcon, title: Option<&str>) {
    let Some(title) = title else {
        let _ = tray.set_title(Option::<&str>::None);
        return;
    };

    // 先走标准 title，随后用 attributedTitle 覆盖，实现更好的数字稳定与视觉对齐。
    let _ = tray.set_title(Some(title));
    set_macos_attributed_tray_title_async(app, tray.clone(), title.to_string());
}

// 异步执行 with_inner_tray_icon，避免阻塞主线程导致死锁
#[cfg(target_os = "macos")]
fn set_macos_attributed_tray_title_async(_app: &AppHandle, tray: TrayIcon, title: String) {
    tauri::async_runtime::spawn(async move {
        // 使用 tokio 的超时避免永久阻塞
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            tokio::task::spawn_blocking(move || {
                set_macos_attributed_tray_title_sync(&tray, title);
            }),
        )
        .await;

        if result.is_err() {
            log::warn!("set_macos_attributed_tray_title timed out");
        }
    });
}

#[cfg(target_os = "macos")]
fn set_macos_attributed_tray_title_sync(tray: &TrayIcon, title: String) {
    let title_string = title;
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

        let font =
            unsafe { NSFont::monospacedDigitSystemFontOfSize_weight(12.0, NSFontWeightRegular) };
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

#[cfg(target_os = "windows")]
fn set_tray_title_with_color(_app: &AppHandle, tray: &TrayIcon, title: Option<&str>) {
    let status = title.unwrap_or("MM");
    let tooltip = if status == "MM" {
        "MiniMax Monitor".to_string()
    } else {
        format!("MiniMax Monitor: {}", status)
    };

    let _ = tray.set_title(title);
    let _ = tray.set_tooltip(Some(tooltip));
    if let Err(e) = tray.set_icon(Some(render_windows_status_icon(status))) {
        log::error!("Failed to update Windows tray status icon: {}", e);
    }
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn set_tray_title_with_color(_app: &AppHandle, _tray: &TrayIcon, title: Option<&str>) {
    let _ = _tray.set_title(title);
}

pub(crate) struct TrayI18n {
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
        .unwrap_or_else(|| "--%/--%".to_string())
}

fn format_percent(percent: Option<f64>) -> Option<String> {
    percent.map(|p| format!("{:.0}", p))
}

fn format_compact_percent(percent: Option<f64>) -> Option<String> {
    // compact macOS status metric style: 3% / 68%
    // keep token count minimal for quick-glance recognition.
    format_percent(percent).map(|p| format!("{}%", p))
}

fn format_tray_usage(current_percent: Option<f64>, weekly_percent: Option<f64>) -> Option<String> {
    match (
        format_compact_percent(current_percent),
        format_compact_percent(weekly_percent),
    ) {
        (Some(current), Some(weekly)) => Some(format!("{}/{}", current, weekly)),
        (Some(current), None) => Some(format!("{}/--%", current)),
        (None, Some(weekly)) => Some(format!("--%/{}", weekly)),
        (None, None) => None,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn build_tooltip(usage: &UsageData, i18n: &TrayI18n) -> String {
    if !usage.ok {
        return format!("{} - {}", i18n.app_name, usage.status_label);
    }
    let mut parts = vec![i18n.app_name.to_string()];
    if !usage.primary_model_name.is_empty() {
        parts.push(format!("{}: {}", i18n.model_prefix, usage.primary_model_name));
    }
    if !usage.interval_label.is_empty() {
        parts.push(format!("{}: {}", i18n.interval_prefix, usage.interval_label));
    }
    if let Some(remaining) = usage.remaining_count {
        parts.push(format!("{}: {}", i18n.remaining_prefix, remaining));
    }
    if let Some(pct) = usage.used_percent {
        parts.push(format!("Used: {:.0}%", pct));
    }
    if let Some(wk_remaining) = usage.weekly_remaining_count {
        parts.push(format!("{}: {}", i18n.weekly_remaining_prefix, wk_remaining));
    }
    if let Some(wk_pct) = usage.weekly_used_percent {
        parts.push(format!("Weekly Used: {:.0}%", wk_pct));
    }
    parts.join("\n")
}

#[cfg(target_os = "macos")]
fn resolve_tray_icon(_app: &tauri::App, _state: &AppState) -> Option<Image<'static>> {
    Some(render_m_icon())
}

#[cfg(not(target_os = "macos"))]
fn resolve_tray_icon(app: &tauri::App, state: &AppState) -> Option<Image<'static>> {
    let (style, used_percent, ok) = {
        let cfg = state.config.lock().unwrap();
        let usage = state.usage_data.lock().unwrap();
        let style = cfg.tray_icon_style.clone();
        let (used_percent, ok) = usage
            .as_ref()
            .map(|d| (d.used_percent, d.ok))
            .unwrap_or((None, false));
        (style, used_percent, ok)
    };
    Some(tray_icon::render_tray_icon(&style, used_percent, ok))
}

pub fn update_tray_menu(app: &AppHandle, state: &AppState) {
    let usage = state.usage_data.lock().unwrap();
    let config = state.config.lock().unwrap();
    let api_key = state.api_key.lock().unwrap();
    let i18n = tray_i18n(&config.language);

    let status_text = if let Some(ref data) = *usage {
        build_status_text(data, config.show_percent_in_tray)
    } else if api_key.is_none() && config.api_keys.is_empty() {
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

fn build_tray_menu(
    app: &AppHandle,
    i18n: &TrayI18n,
    status_text: &str,
    show_percent_in_tray: bool,
    usage: Option<&UsageData>,
) -> Menu<tauri::Wry> {
    let separator = PredefinedMenuItem::separator(app).unwrap();
    let quit = MenuItem::with_id(app, "quit", i18n.quit, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = quit.set_icon(tray_icon::render_menu_icon("quit"));
    }
    let set_key = MenuItem::with_id(app, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key = MenuItem::with_id(app, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = set_key.set_icon(tray_icon::render_menu_icon("set_key"));
        let _ = clear_key.set_icon(tray_icon::render_menu_icon("clear_key"));
    }
    let refresh = MenuItem::with_id(app, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = refresh.set_icon(tray_icon::render_menu_icon("refresh"));
    }
    let toggle_show_percent = CheckMenuItem::with_id(
        app,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = toggle_show_percent.set_icon(tray_icon::render_menu_icon("toggle_show_percent"));
    }

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "status", status_text, false, None::<&str>).unwrap()),
        Box::new(separator),
        Box::new(refresh),
        Box::new(toggle_show_percent),
        Box::new(set_key),
        Box::new(clear_key),
    ];

    if let Some(data) = usage {
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
                #[cfg(target_os = "windows")]
                {
                    let _ = model_item.set_icon(tray_icon::render_menu_icon("model"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = interval_item.set_icon(tray_icon::render_menu_icon("interval"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = remaining_item.set_icon(tray_icon::render_menu_icon("remaining"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = weekly_item.set_icon(tray_icon::render_menu_icon("weekly_remaining"));
                }
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
            let error_item = MenuItem::with_id(
                app,
                "error",
                &format!("⚠️ {}", data.status_label),
                false,
                None::<&str>,
            )
            .unwrap();
            items.insert(2, Box::new(error_item));
        }
    }

    items.push(Box::new(PredefinedMenuItem::separator(app).unwrap()));
    items.push(Box::new(quit));

    Menu::with_items(app, &items.iter().map(|i| i.as_ref()).collect::<Vec<_>>()).unwrap()
}

#[cfg(target_os = "macos")]
fn resolve_tray_icon(_app: &tauri::App) -> Option<Image<'static>> {
    Some(render_m_icon())
}

#[cfg(target_os = "windows")]
fn resolve_tray_icon(_app: &tauri::App) -> Option<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/icon.ico"))
        .or_else(|_| Image::from_bytes(include_bytes!("../icons/32x32.png")))
        .ok()
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn resolve_tray_icon(app: &tauri::App) -> Option<Image<'static>> {
    if let Some(icon) = app.default_window_icon() {
        return Some(icon.clone().to_owned());
    }
    Image::from_bytes(include_bytes!("../icons/icon.png")).ok()
}

pub fn update_tray_menu(app: &AppHandle, state: &AppState) {
    let usage_snapshot = {
        let usage = state.usage_data.lock().unwrap();
        usage.values().next().cloned()
    };
    let config_snapshot = {
        let config = state.config.lock().unwrap();
        config.clone()
    };
    let api_key_snapshot = {
        let api_key = state.api_key.lock().unwrap();
        api_key.clone()
    };
    let i18n = tray_i18n(&config_snapshot.language);

    let status_text = if let Some(data) = usage_snapshot.as_ref() {
        build_status_text(data, config_snapshot.show_percent_in_tray)
    } else if api_key_snapshot.is_none() && config_snapshot.api_keys.is_empty() {
        if config_snapshot.show_percent_in_tray {
            i18n.set_key_hint.to_string()
        } else {
            i18n.app_name.to_string()
        }
    } else {
        if config_snapshot.show_percent_in_tray {
            i18n.loading_hint.to_string()
        } else {
            i18n.app_name.to_string()
        }
    };

    let separator = PredefinedMenuItem::separator(app).unwrap();
    let quit = MenuItem::with_id(app, "quit", i18n.quit, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = quit.set_icon(tray_icon::render_menu_icon("quit"));
    }
    let set_key = MenuItem::with_id(app, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key = MenuItem::with_id(app, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = set_key.set_icon(tray_icon::render_menu_icon("set_key"));
        let _ = clear_key.set_icon(tray_icon::render_menu_icon("clear_key"));
    }
    let refresh = MenuItem::with_id(app, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = refresh.set_icon(tray_icon::render_menu_icon("refresh"));
    }
    let toggle_show_percent = CheckMenuItem::with_id(
        app,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        config_snapshot.show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();
    #[cfg(target_os = "windows")]
    {
        let _ = toggle_show_percent.set_icon(tray_icon::render_menu_icon("toggle_show_percent"));
    }

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "status", &status_text, false, None::<&str>).unwrap()),
        Box::new(separator),
        Box::new(refresh),
        Box::new(toggle_show_percent),
        Box::new(set_key),
        Box::new(clear_key),
    ];

    if let Some(ref data) = *usage_snapshot {
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
                #[cfg(target_os = "windows")]
                {
                    let _ = model_item.set_icon(tray_icon::render_menu_icon("model"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = interval_item.set_icon(tray_icon::render_menu_icon("interval"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = remaining_item.set_icon(tray_icon::render_menu_icon("remaining"));
                }
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
                #[cfg(target_os = "windows")]
                {
                    let _ = weekly_item.set_icon(tray_icon::render_menu_icon("weekly_remaining"));
                }
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

    let tray_title = if config_snapshot.show_percent_in_tray {
        usage_snapshot
            .as_ref()
            .and_then(|data| format_tray_usage(data.used_percent, data.weekly_used_percent))
            .unwrap_or_else(|| "MM".to_string())
    } else {
        "MM".to_string()
    };

    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        set_tray_title_with_color(tray, Some(&tray_title));

        // Update tooltip with rich usage details (Windows/Linux)
        #[cfg(not(target_os = "macos"))]
        if let Some(ref data) = *usage_snapshot {
            let i18n2 = tray_i18n(&config_snapshot.language);
            let tooltip_text = build_tooltip(data, &i18n2);
            let _ = tray.set_tooltip(Some(&tooltip_text));
        }

        // Dynamically update tray icon based on latest usage data
        #[cfg(not(target_os = "macos"))]
        {
            let icon_style = config_snapshot.tray_icon_style.clone();
            let (used_percent, ok) = usage_snapshot
                .as_ref()
                .map(|d| (d.used_percent, d.ok))
                .unwrap_or((None, false));
            let _ = tray.set_icon(Some(tray_icon::render_tray_icon(&icon_style, used_percent, ok)));
        }

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

    let refresh_item = MenuItem::with_id(&app_handle, "refresh", i18n.refresh, true, None::<&str>).unwrap();
    let toggle_item = CheckMenuItem::with_id(
        &app_handle,
        "toggle_show_percent",
        i18n.show_percent_toggle,
        true,
        show_percent_in_tray,
        None::<&str>,
    )
    .unwrap();
    let set_key_item = MenuItem::with_id(&app_handle, "set_key", i18n.set_key, true, None::<&str>).unwrap();
    let clear_key_item = MenuItem::with_id(&app_handle, "clear_key", i18n.clear_key, true, None::<&str>).unwrap();
    let quit_item = MenuItem::with_id(&app_handle, "quit", i18n.quit, true, None::<&str>).unwrap();

    #[cfg(target_os = "windows")]
    {
        let _ = refresh_item.set_icon(tray_icon::render_menu_icon("refresh"));
        let _ = toggle_item.set_icon(tray_icon::render_menu_icon("toggle_show_percent"));
        let _ = set_key_item.set_icon(tray_icon::render_menu_icon("set_key"));
        let _ = clear_key_item.set_icon(tray_icon::render_menu_icon("clear_key"));
        let _ = quit_item.set_icon(tray_icon::render_menu_icon("quit"));
    }

    let menu = Menu::with_items(&app_handle, &[
        &MenuItem::with_id(&app_handle, "status", i18n.loading_hint, false, None::<&str>).unwrap(),
        &PredefinedMenuItem::separator(&app_handle).unwrap(),
        &refresh_item,
        &toggle_item,
        &set_key_item,
        &clear_key_item,
        &PredefinedMenuItem::separator(&app_handle).unwrap(),
        &quit_item,
    ])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MiniMax Usage Monitor")
        .show_menu_on_left_click(false);

    if let Some(icon) = resolve_tray_icon(app, &state) {
        tray_builder = tray_builder.icon(icon);
    } else {
        log::error!("Failed to resolve tray icon");
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
                                let refresh_key = "default".to_string();
                                {
                                    let state: State<AppState> = app_h_clone.state();
                                    let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
                                    if !in_flight.insert(refresh_key.clone()) {
                                        log::debug!("Skip manual refresh: default key request already in-flight");
                                        return;
                                    }
                                }

                                let fetch_result = crate::api::fetch_minimax_usage(&key, 15000).await;
                                {
                                    let state: State<AppState> = app_h_clone.state();
                                    let mut in_flight = state.in_flight_refresh_keys.lock().unwrap();
                                    in_flight.remove(&refresh_key);
                                }

                                match fetch_result {
                                    Ok(data) => {
                                        let state: State<AppState> = app_h_clone.state();
                                        let mut usage = state.usage_data.lock().unwrap();
                                        usage.insert("default".to_string(), data.clone());
                                        drop(usage);
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
                    // Dispatch to main thread - window show/focus can block WebView IPC
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::show_main_window(&app_clone);
                    });
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
                        usage.clear();
                    }
                    // Dispatch tray menu update to avoid holding locks while rebuilding menu
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state: State<AppState> = app_clone.state();
                        update_tray_menu(&app_clone, &state);
                    });
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
                    // Dispatch tray menu update to avoid holding locks while rebuilding menu
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state: State<AppState> = app_clone.state();
                        update_tray_menu(&app_clone, &state);
                    });
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                // Dispatch window show/focus to the main thread so the tray event
                // handler never blocks on WebView IPC. Directly calling get_webview_window
                // or window.show() on the tray thread can block if the WebView is busy,
                // causing the entire tray to freeze.
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::show_main_window(&app_clone);
                });
            }
        })
        .build(app)?;
    log::info!("Tray icon created");

    *state.tray.lock().unwrap() = Some(tray);
    update_tray_menu(&app_handle, &state);
    log::info!("Tray menu initialized");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::build_status_text;
    use crate::{ModelDetail, UsageData};

    fn usage_with_percent(current: Option<f64>, weekly: Option<f64>) -> UsageData {
        UsageData {
            ok: true,
            status_label: "Success".to_string(),
            primary_model_name: "MiniMax".to_string(),
            time_window: String::new(),
            reset_timestamp: None,
            reset_in_label: String::new(),
            total_count: None,
            remaining_count: None,
            used_count: None,
            used_percent: current,
            weekly_total_count: None,
            weekly_used_count: None,
            weekly_remaining_count: None,
            weekly_used_percent: weekly,
            weekly_reset_timestamp: None,
            weekly_reset_in_label: String::new(),
            interval_label: String::new(),
            models: Vec::<ModelDetail>::new(),
            last_updated: String::new(),
        }
    }

    #[test]
    fn status_text_places_percent_sign_after_numbers() {
        let usage = usage_with_percent(Some(58.0), Some(36.0));
        assert_eq!(build_status_text(&usage, true), "58%/36%");
    }

    #[test]
    fn status_text_keeps_percent_suffix_for_missing_values() {
        let usage = usage_with_percent(Some(58.0), None);
        assert_eq!(build_status_text(&usage, true), "58%/--%");

        let usage = usage_with_percent(None, Some(36.0));
        assert_eq!(build_status_text(&usage, true), "--%/36%");
    }
}
