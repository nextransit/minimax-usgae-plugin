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
            })
        ).await;

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

#[cfg(target_os = "windows")]
fn render_windows_status_icon(status: &str) -> Image<'static> {
    const W: u32 = 32;
    const H: u32 = 32;
    let percent = parse_current_percent(status);
    let mut rgba = vec![0u8; (W * H * 4) as usize];
    let bg = percent
        .map(status_color)
        .unwrap_or((0, 191, 255));

    for y in 0..H {
        for x in 0..W {
            let dx = x as i32 - 16;
            let dy = y as i32 - 16;
            if dx * dx + dy * dy <= 15 * 15 {
                draw_px(&mut rgba, W, x, y, bg.0, bg.1, bg.2, 255);
            } else if dx * dx + dy * dy <= 16 * 16 {
                draw_px(&mut rgba, W, x, y, 5, 10, 18, 220);
            }
        }
    }

    let label = percent
        .map(|p| p.to_string())
        .unwrap_or_else(|| "M".to_string());
    draw_centered_label(&mut rgba, W, H, &label);

    Image::new_owned(rgba, W, H)
}

#[cfg(target_os = "windows")]
fn parse_current_percent(status: &str) -> Option<u8> {
    let number = status
        .split('%')
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if number.is_empty() {
        return None;
    }
    number.parse::<u8>().ok().map(|value| value.min(100))
}

#[cfg(target_os = "windows")]
fn status_color(percent: u8) -> (u8, u8, u8) {
    match percent {
        90..=100 => (255, 46, 99),
        70..=89 => (245, 158, 11),
        _ => (0, 191, 255),
    }
}

#[cfg(target_os = "windows")]
fn draw_centered_label(rgba: &mut [u8], width: u32, height: u32, label: &str) {
    let chars = label.chars().collect::<Vec<_>>();
    let scale = match chars.len() {
        0 | 1 => 5,
        2 => 4,
        _ => 3,
    };
    let glyph_w = 3 * scale;
    let glyph_h = 5 * scale;
    let gap = scale;
    let text_w = chars.len() as u32 * glyph_w + chars.len().saturating_sub(1) as u32 * gap;
    let start_x = width.saturating_sub(text_w) / 2;
    let start_y = height.saturating_sub(glyph_h) / 2;

    for (idx, ch) in chars.iter().enumerate() {
        let x = start_x + idx as u32 * (glyph_w + gap);
        draw_glyph(rgba, width, x, start_y, *ch, scale);
    }
}

#[cfg(target_os = "windows")]
fn draw_glyph(rgba: &mut [u8], width: u32, x: u32, y: u32, ch: char, scale: u32) {
    let Some(rows) = glyph_rows(ch) else {
        return;
    };

    for (row_idx, row) in rows.iter().enumerate() {
        for (col_idx, px) in row.as_bytes().iter().enumerate() {
            if *px != b'1' {
                continue;
            }
            for sy in 0..scale {
                for sx in 0..scale {
                    draw_px(
                        rgba,
                        width,
                        x + col_idx as u32 * scale + sx,
                        y + row_idx as u32 * scale + sy,
                        255,
                        255,
                        255,
                        255,
                    );
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn glyph_rows(ch: char) -> Option<[&'static str; 5]> {
    match ch {
        '0' => Some(["111", "101", "101", "101", "111"]),
        '1' => Some(["010", "110", "010", "010", "111"]),
        '2' => Some(["111", "001", "111", "100", "111"]),
        '3' => Some(["111", "001", "111", "001", "111"]),
        '4' => Some(["101", "101", "111", "001", "001"]),
        '5' => Some(["111", "100", "111", "001", "111"]),
        '6' => Some(["111", "100", "111", "101", "111"]),
        '7' => Some(["111", "001", "010", "010", "010"]),
        '8' => Some(["111", "101", "111", "101", "111"]),
        '9' => Some(["111", "101", "111", "001", "111"]),
        'M' | 'm' => Some(["101", "111", "111", "101", "101"]),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn draw_px(rgba: &mut [u8], width: u32, x: u32, y: u32, r: u8, g: u8, b: u8, a: u8) {
    let idx = ((y * width + x) * 4) as usize;
    if idx + 3 >= rgba.len() {
        return;
    }
    rgba[idx] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = a;
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
    match (format_compact_percent(current_percent), format_compact_percent(weekly_percent)) {
        (Some(current), Some(weekly)) => Some(format!("{}/{}", current, weekly)),
        (Some(current), None) => Some(format!("{}/--%", current)),
        (None, Some(weekly)) => Some(format!("--%/{}", weekly)),
        (None, None) => None,
    }
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
    let usage = state.usage_data.lock().unwrap();
    let config = state.config.lock().unwrap();
    let api_key = state.api_key.lock().unwrap();
    let i18n = tray_i18n(&config.language);

    let status_text = if let Some(data) = usage.values().next() {
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

    if let Some(data) = usage.values().next() {
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

    // 使用 try_lock 避免死锁，如果锁被占用则跳过托盘更新
    let tray_title = if config.show_percent_in_tray {
        usage
            .values()
            .next()
            .and_then(|data| format_tray_usage(data.used_percent, data.weekly_used_percent))
            .unwrap_or_else(|| "MM".to_string())
    } else {
        "MM".to_string()
    };

    if let Ok(tray_guard) = state.tray.try_lock() {
        if let Some(tray) = tray_guard.as_ref() {
            set_tray_title_with_color(app, tray, Some(&tray_title));

            if let Err(e) = tray.set_menu(Some(menu)) {
                log::error!("Failed to update tray menu: {}", e);
            }
        }
    } else {
        log::warn!("update_tray_menu: tray lock busy, skipping");
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
                                match crate::api::fetch_minimax_usage(&key, 15000).await {
                                    Ok(data) => {
                                        let state: State<AppState> = app_h_clone.state();
                                        let mut usage = state.usage_data.lock().unwrap();
                                        usage.insert("default".to_string(), data.clone());
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
                        if let Some(window) = app_clone.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                    if let Some(window) = app_clone.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
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
