use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::tray::TrayIcon as TauriTrayIcon;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub refresh_interval_seconds: u32,
    pub show_weekly_in_status: bool,
    pub show_percent_in_tray: bool,  // 新增：托盘栏显示当前周期比例
    pub detail_model_limit: u32,
    pub language: String,
    pub first_run: bool,               // 新增：首次运行标记
    pub start_minimized: bool,         // 新增：启动时最小化
    pub enable_notifications: bool,    // 新增：启用通知
    pub tray_icon_style: String,       // 新增：托盘图标风格
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            refresh_interval_seconds: 20,
            show_weekly_in_status: true,
            show_percent_in_tray: true,   // 默认开启
            detail_model_limit: 8,
            language: "auto".to_string(),
            first_run: true,           // 默认首次运行
            start_minimized: false,
            enable_notifications: true,
            tray_icon_style: "default".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    pub ok: bool,
    pub status_label: String,
    pub primary_model_name: String,
    pub time_window: String,
    pub reset_timestamp: Option<i64>,
    pub reset_in_label: String,
    pub total_count: Option<i64>,
    pub remaining_count: Option<i64>,
    pub used_count: Option<i64>,
    pub used_percent: Option<f64>,
    pub weekly_total_count: Option<i64>,
    pub weekly_used_count: Option<i64>,
    pub weekly_remaining_count: Option<i64>,
    pub weekly_used_percent: Option<f64>,
    pub weekly_reset_timestamp: Option<i64>,
    pub weekly_reset_in_label: String,
    pub interval_label: String,
    pub models: Vec<ModelDetail>,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetail {
    pub name: String,
    pub time_window: String,
    pub total_count: i64,
    pub remaining_count: i64,
    pub used_count: i64,
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub api_key: Mutex<Option<String>>,
    pub usage_data: Mutex<Option<UsageData>>,
    pub tray: Mutex<Option<TauriTrayIcon>>,
}
