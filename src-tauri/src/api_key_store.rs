use crate::state::ApiKeyEntry;
use keyring::Error as KeyringError;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

const API_KEY_ACCOUNT: &str = "api_key";
const PRIMARY_SERVICE_DEFAULT: &str = "com.decard.minimax-monitor";
const LEGACY_SERVICES_DEFAULT: [&str; 2] = ["minimax_usage_monitor", "minimax-usage-monitor"];
const CONFIG_DIR_ENV: &str = "MINIMAX_MONITOR_CONFIG_DIR";
const PRIMARY_SERVICE_ENV: &str = "MINIMAX_MONITOR_KEYCHAIN_SERVICE";
const LEGACY_SERVICES_ENV: &str = "MINIMAX_MONITOR_KEYCHAIN_LEGACY_SERVICES";
const DISABLE_KEYCHAIN_ENV: &str = "MINIMAX_MONITOR_DISABLE_KEYCHAIN";

fn keychain_disabled() -> bool {
    // For multi-key support, default to file-based storage to avoid macOS Keychain popup issues
    // Users can enable keychain by setting MINIMAX_MONITOR_DISABLE_KEYCHAIN=0
    if let Some(value) = std::env::var(DISABLE_KEYCHAIN_ENV).ok() {
        let normalized = value.trim().to_ascii_lowercase();
        return !(normalized == "0" || normalized == "false");
    }
    true // Default to disabled (file-based storage) to avoid Keychain popups
}

fn primary_service() -> String {
    std::env::var(PRIMARY_SERVICE_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| PRIMARY_SERVICE_DEFAULT.to_string())
}

fn legacy_services() -> Vec<String> {
    if let Some(value) = std::env::var(LEGACY_SERVICES_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        value
            .split(',')
            .map(|part| part.trim().to_string())
            .filter(|part| !part.is_empty())
            .collect()
    } else {
        LEGACY_SERVICES_DEFAULT
            .iter()
            .map(|service| (*service).to_string())
            .collect()
    }
}

fn config_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = std::env::var(CONFIG_DIR_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(override_dir));
    }

    dirs::config_dir()
        .map(|p| p.join("minimax-usage-monitor"))
        .or_else(|| {
            dirs::home_dir().map(|home| {
                #[cfg(target_os = "macos")]
                {
                    return home
                        .join("Library")
                        .join("Application Support")
                        .join("minimax-usage-monitor");
                }
                #[cfg(not(target_os = "macos"))]
                {
                    home.join(".config").join("minimax-usage-monitor")
                }
            })
        })
        .ok_or_else(|| "Cannot determine config dir".to_string())
}

fn fallback_key_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("api_key.fallback"))
}

fn read_from_keychain(service: &str) -> Result<Option<String>, String> {
    if keychain_disabled() {
        return Ok(None);
    }

    let entry = keyring::Entry::new(service, API_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_to_keychain(service: &str, key: &str) -> Result<(), String> {
    if keychain_disabled() {
        return Ok(());
    }

    let entry = keyring::Entry::new(service, API_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

fn read_fallback_key() -> Result<Option<String>, String> {
    let path = fallback_key_path()?;
    match fs::read_to_string(path) {
        Ok(content) => {
            let key = content.trim().to_string();
            if key.is_empty() {
                Ok(None)
            } else {
                Ok(Some(key))
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_fallback_key(key: &str) -> Result<(), String> {
    let path = fallback_key_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        let _ = hide_file_on_windows(&path);
    }
    Ok(())
}

#[cfg(windows)]
fn hide_file_on_windows(path: &std::path::Path) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    if !path_str.is_empty() {
        std::process::Command::new("attrib")
            .args(["+H", &path_str])
            .output()
            .map_err(|e| format!("attrib failed: {}", e))?;
    }
    Ok(())
}

fn remove_fallback_key() -> Result<(), String> {
    let path = fallback_key_path()?;
    match fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_from_keychain(service: &str) -> Result<(), String> {
    if keychain_disabled() {
        return Ok(());
    }

    let entry = keyring::Entry::new(service, API_KEY_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn load_api_key() -> Option<String> {
    let primary = primary_service();
    let legacy = legacy_services();

    if let Ok(Some(key)) = read_fallback_key() {
        log::debug!("API key loaded from fallback file");
        return Some(key);
    }

    if let Ok(Some(key)) = read_from_keychain(&primary) {
        log::debug!("API key loaded from primary keychain");
        let _ = write_fallback_key(&key);
        return Some(key);
    }

    for service in &legacy {
        if service == &primary {
            continue;
        }
        if let Ok(Some(key)) = read_from_keychain(service) {
            log::debug!("API key loaded from legacy keychain service: {}", service);
            let _ = write_fallback_key(&key);
            return Some(key);
        }
    }

    log::debug!("No API key found in fallback or keychain");
    None
}

pub fn save_api_key(key: &str) -> Result<(), String> {
    let primary = primary_service();

    let mut errors = Vec::new();

    if let Err(e) = write_to_keychain(&primary, key) {
        errors.push(format!("primary keychain: {}", e));
    }

    if let Err(e) = write_fallback_key(key) {
        errors.push(format!("fallback file: {}", e));
    }

    if errors.len() >= 2 {
        Err(errors.join("; "))
    } else {
        Ok(())
    }
}

pub fn clear_api_key() -> Result<(), String> {
    let primary = primary_service();
    let legacy = legacy_services();

    let mut errors = Vec::new();

    if let Err(e) = delete_from_keychain(&primary) {
        errors.push(format!("primary keychain: {}", e));
    }

    for service in legacy {
        if service == primary {
            continue;
        }
        if let Err(e) = delete_from_keychain(&service) {
            errors.push(format!("legacy keychain [{}]: {}", service, e));
        }
    }

    if let Err(e) = remove_fallback_key() {
        errors.push(format!("fallback file: {}", e));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Save an API key for a specific key entry
pub fn save_key_for_entry(entry: &ApiKeyEntry, key: &str) -> Result<(), String> {
    if keychain_disabled() {
        // Fallback: save to file with key-specific path
        let path = config_dir()?.join(format!("key_{}.fallback", entry.id));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, key).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        let entry = keyring::Entry::new(&entry.keychain_service, &entry.keychain_account)
            .map_err(|e| e.to_string())?;
        entry.set_password(key).map_err(|e| e.to_string())
    }
}

/// Load an API key for a specific key entry
pub fn load_key_for_entry(entry: &ApiKeyEntry) -> Option<String> {
    if keychain_disabled() {
        let path = config_dir()
            .ok()?
            .join(format!("key_{}.fallback", entry.id));
        let key = fs::read_to_string(path).ok()?.trim().to_string();
        if key.is_empty() {
            None
        } else {
            Some(key)
        }
    } else {
        let entry = keyring::Entry::new(&entry.keychain_service, &entry.keychain_account).ok()?;
        entry.get_password().ok()
    }
}

/// Delete an API key for a specific key entry
pub fn delete_key_for_entry(entry: &ApiKeyEntry) -> Result<(), String> {
    if keychain_disabled() {
        let path = config_dir()?.join(format!("key_{}.fallback", entry.id));
        match fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        let entry = keyring::Entry::new(&entry.keychain_service, &entry.keychain_account)
            .map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn unique_tag() -> String {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{}-{}", std::process::id(), ts)
    }

    fn with_isolated_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = test_lock().lock().unwrap();

        let old_config = std::env::var(CONFIG_DIR_ENV).ok();
        let old_primary = std::env::var(PRIMARY_SERVICE_ENV).ok();
        let old_legacy = std::env::var(LEGACY_SERVICES_ENV).ok();
        let old_disable = std::env::var(DISABLE_KEYCHAIN_ENV).ok();

        let tag = unique_tag();
        let dir = std::env::temp_dir().join(format!("minimax-key-store-test-{}", tag));
        std::env::set_var(CONFIG_DIR_ENV, dir.to_string_lossy().to_string());
        std::env::set_var(
            PRIMARY_SERVICE_ENV,
            format!("com.decard.minimax-monitor.test.{}", tag),
        );
        std::env::set_var(
            LEGACY_SERVICES_ENV,
            format!(
                "com.decard.minimax-monitor.test.{}.legacy1,com.decard.minimax-monitor.test.{}.legacy2",
                tag, tag
            ),
        );
        std::env::set_var(DISABLE_KEYCHAIN_ENV, "1");

        let result = f();

        let _ = fs::remove_dir_all(&dir);

        match old_config {
            Some(v) => std::env::set_var(CONFIG_DIR_ENV, v),
            None => std::env::remove_var(CONFIG_DIR_ENV),
        }
        match old_primary {
            Some(v) => std::env::set_var(PRIMARY_SERVICE_ENV, v),
            None => std::env::remove_var(PRIMARY_SERVICE_ENV),
        }
        match old_legacy {
            Some(v) => std::env::set_var(LEGACY_SERVICES_ENV, v),
            None => std::env::remove_var(LEGACY_SERVICES_ENV),
        }
        match old_disable {
            Some(v) => std::env::set_var(DISABLE_KEYCHAIN_ENV, v),
            None => std::env::remove_var(DISABLE_KEYCHAIN_ENV),
        }

        result
    }

    #[test]
    fn save_and_load_roundtrip_via_fallback() {
        with_isolated_env(|| {
            let _ = clear_api_key();

            let key = format!("test-key-{}", unique_tag());
            save_api_key(&key).expect("save should succeed");
            let loaded = load_api_key();

            assert_eq!(loaded, Some(key));

            clear_api_key().expect("clear should succeed");
            assert_eq!(load_api_key(), None);
        });
    }

    #[test]
    fn fallback_overrides_stale_keychain_value() {
        with_isolated_env(|| {
            let _ = clear_api_key();

            write_fallback_key("new-key").expect("fallback write should succeed");
            let loaded = load_api_key();

            assert_eq!(loaded, Some("new-key".to_string()));
        });
    }

    #[test]
    fn clear_removes_fallback_file() {
        with_isolated_env(|| {
            let _ = clear_api_key();

            save_api_key("abc").expect("save should succeed");
            clear_api_key().expect("clear should succeed");

            assert_eq!(load_api_key(), None);
            assert!(matches!(read_fallback_key(), Ok(None)));
        });
    }
}
