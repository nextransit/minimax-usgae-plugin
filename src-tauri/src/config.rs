use crate::api_key_store;
use crate::state::{ApiKeyEntry, AppConfig};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn get_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("minimax-usage-monitor").join("config.json"))
}

// v1 config structure (before multi-api-key support)
#[derive(Debug, Clone, Deserialize)]
struct AppConfigV1 {
    #[serde(default)]
    pub config_version: u32,
    pub refresh_interval_seconds: u32,
    #[serde(default = "default_true")]
    pub show_weekly_in_status: bool,
    #[serde(default = "default_true")]
    pub show_percent_in_tray: bool,
    pub detail_model_limit: u32,
    pub language: String,
    #[serde(default = "default_true")]
    pub first_run: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default = "default_true")]
    pub enable_notifications: bool,
}

fn default_true() -> bool {
    true
}

pub fn load_config() -> Result<AppConfig, Box<dyn std::error::Error>> {
    let path = get_config_path().ok_or("Cannot determine config path")?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path)?;

    // Try to deserialize as v2 first (has api_keys field)
    let config: Result<AppConfig, _> = serde_json::from_str(&content);

    if let Ok(mut config) = config {
        // Check if migration is needed: config_version == 0 or api_keys is empty
        if config.config_version == 0 || config.api_keys.is_empty() {
            log::info!("Migrating config from v1 to v2");
            migrate_v1_to_v2(&mut config);
        }
        return Ok(config);
    }

    // Fallback: try to deserialize as v1 (no api_keys field)
    let v1_config: AppConfigV1 = serde_json::from_str(&content)?;
    log::info!("Loading v1 config format, will migrate to v2");

    let mut config = AppConfig {
        config_version: v1_config.config_version,
        refresh_interval_seconds: v1_config.refresh_interval_seconds,
        show_weekly_in_status: v1_config.show_weekly_in_status,
        show_percent_in_tray: v1_config.show_percent_in_tray,
        detail_model_limit: v1_config.detail_model_limit,
        language: v1_config.language,
        first_run: v1_config.first_run,
        start_minimized: v1_config.start_minimized,
        enable_notifications: v1_config.enable_notifications,
        api_keys: Vec::new(),
    };

    // Migrate v1 to v2
    migrate_v1_to_v2(&mut config);

    Ok(config)
}

fn migrate_v1_to_v2(config: &mut AppConfig) {
    config.config_version = 2;

    // Try to load the old single API key from keychain (load_api_key tries primary + all legacy services)
    if let Some(api_key) = api_key_store::load_api_key() {
        if !api_key.is_empty() {
            let entry = ApiKeyEntry {
                id: Uuid::new_v4().to_string(),
                name: "Default".to_string(),
                color: "#00d4ff".to_string(), // Cyberpunk cyan
                keychain_service: "com.decard.minimax-monitor".to_string(),
                keychain_account: "api_key".to_string(),
                refresh_interval: config.refresh_interval_seconds,
                created_at: chrono::Utc::now().timestamp(),
                is_active: true,
            };
            config.api_keys.push(entry);
            log::info!("Migrated old API key to new multi-key format");
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_config_path().ok_or("Cannot determine config path")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content)?;
    Ok(())
}