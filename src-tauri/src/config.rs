use crate::AppConfig;
use std::fs;
use std::path::PathBuf;

fn get_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("minimax-usage-monitor").join("config.json"))
}

pub fn load_config() -> Result<AppConfig, Box<dyn std::error::Error>> {
    let path = get_config_path().ok_or("Cannot determine config path")?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path)?;
    let config: AppConfig = serde_json::from_str(&content)?;
    Ok(config)
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