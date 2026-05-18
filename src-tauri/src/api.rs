use crate::state::{ModelDetail, UsageData};
use chrono::{DateTime, Local, Utc};
use serde::Deserialize;
use std::error::Error;
#[cfg(target_os = "macos")]
use std::io::Write;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::time::Duration;

const CONNECT_TIMEOUT_MS: u64 = 6_000;
#[cfg(target_os = "macos")]
const CURL_FALLBACK_MAX_TIME_MS: u64 = 8_000;

#[derive(Debug, Deserialize)]
struct MiniMaxResponse {
    #[serde(rename = "base_resp")]
    base_resp: Option<BaseResp>,
    #[serde(rename = "status_code")]
    status_code: Option<i32>,
    #[serde(rename = "status_msg")]
    status_msg: Option<String>,
    #[serde(rename = "model_remains")]
    model_remains: Option<Vec<ModelRemain>>,
}

#[derive(Debug, Deserialize)]
struct BaseResp {
    #[serde(rename = "status_code")]
    status_code: Option<i32>,
    #[serde(rename = "status_msg")]
    status_msg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelRemain {
    #[serde(rename = "start_time")]
    start_time: Option<i64>,
    #[serde(rename = "end_time")]
    end_time: Option<i64>,
    #[serde(rename = "remains_time")]
    remains_time: Option<i64>,
    #[serde(rename = "current_interval_total_count")]
    current_interval_total_count: Option<i64>,
    #[serde(rename = "current_interval_usage_count")]
    current_interval_usage_count: Option<i64>,
    #[serde(rename = "model_name")]
    model_name: Option<String>,
    #[serde(rename = "current_weekly_total_count")]
    current_weekly_total_count: Option<i64>,
    #[serde(rename = "current_weekly_usage_count")]
    current_weekly_usage_count: Option<i64>,
    #[serde(rename = "weekly_remains_time")]
    weekly_remains_time: Option<i64>,
}

fn resolve_endpoint(endpoint: &str) -> String {
    let base = match endpoint {
        "overseas" => "https://platform.minimax.io",
        _ => "https://www.minimaxi.com",
    };
    format!("{}/v1/api/openplatform/coding_plan/remains", base)
}

pub async fn fetch_minimax_usage(
    api_key: &str,
    timeout_ms: u64,
    endpoint: &str,
) -> Result<UsageData, Box<dyn std::error::Error + Send + Sync>> {
    let api_key = api_key.to_string();
    let url = resolve_endpoint(endpoint);
    let payload =
        tokio::task::spawn_blocking(move || fetch_minimax_payload_blocking(&api_key, timeout_ms, &url))
            .await
            .map_err(|e| format!("MiniMax request task failed: {}", e))??;

    let business_status_code = payload
        .status_code
        .or(payload.base_resp.as_ref().and_then(|b| b.status_code))
        .unwrap_or(0);

    if business_status_code != 0 {
        let msg = payload
            .status_msg
            .or(payload.base_resp.and_then(|b| b.status_msg))
            .unwrap_or_else(|| "Unknown error".to_string());
        return Ok(UsageData {
            ok: false,
            status_label: msg,
            primary_model_name: String::new(),
            time_window: String::new(),
            reset_timestamp: None,
            reset_in_label: String::new(),
            total_count: None,
            remaining_count: None,
            used_count: None,
            used_percent: None,
            weekly_total_count: None,
            weekly_used_count: None,
            weekly_remaining_count: None,
            weekly_used_percent: None,
            weekly_reset_timestamp: None,
            weekly_reset_in_label: String::new(),
            interval_label: String::new(),
            models: vec![],
            last_updated: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        });
    }

    let models = payload.model_remains.unwrap_or_default();
    let primary = models.first();

    let (total_count, remaining_count, used_count, used_percent) = if let Some(m) = primary {
        let total = m.current_interval_total_count.unwrap_or(0);
        let used = m.current_interval_usage_count.unwrap_or(0);
        let remaining = total.saturating_sub(used);
        let percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        (Some(total), Some(remaining), Some(used), Some(percent))
    } else {
        (None, None, None, None)
    };

    let (weekly_total, weekly_remaining, weekly_used, weekly_percent) = if let Some(m) = primary {
        let total = m.current_weekly_total_count.unwrap_or(0);
        let used = m.current_weekly_usage_count.unwrap_or(0);
        let remaining = total.saturating_sub(used);
        let percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        (Some(total), Some(remaining), Some(used), Some(percent))
    } else {
        (None, None, None, None)
    };

    let now = Local::now();

    let (reset_timestamp, reset_in_label) = if let Some(m) = primary {
        if let Some(rt) = m.remains_time {
            let target = now + chrono::Duration::milliseconds(rt);
            let duration = target.signed_duration_since(now);
            let label = format_duration(duration.num_seconds());
            (Some(target.timestamp_millis()), label)
        } else {
            (None, String::new())
        }
    } else {
        (None, String::new())
    };

    let (weekly_reset_timestamp, weekly_reset_in_label) = if let Some(m) = primary {
        if let Some(rt) = m.weekly_remains_time {
            let target = now + chrono::Duration::milliseconds(rt);
            let duration = target.signed_duration_since(now);
            let label = format_duration(duration.num_seconds());
            (Some(target.timestamp_millis()), label)
        } else {
            (None, String::new())
        }
    } else {
        (None, String::new())
    };

    let (time_window, interval_label) = if let Some(m) = primary {
        let start = m.start_time.unwrap_or(0);
        let end = m.end_time.unwrap_or(0);
        if start > 0 && end > 0 {
            let start_dt = DateTime::from_timestamp(start / 1000, 0)
                .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
            let end_dt = DateTime::from_timestamp(end / 1000, 0)
                .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
            let window = format!("{} ~ {}", start_dt.format("%H:%M"), end_dt.format("%H:%M"));
            let duration = end_dt.signed_duration_since(start_dt);
            let interval = format_english_duration(duration.num_seconds());
            (format!("{} (UTC+8)", window), interval)
        } else {
            (String::new(), String::new())
        }
    } else {
        (String::new(), String::new())
    };

    let model_details: Vec<ModelDetail> = models
        .iter()
        .filter(|m| {
            let total = m.current_interval_total_count.unwrap_or(0);
            let used = m.current_interval_usage_count.unwrap_or(0);
            total > 0 || used > 0
        })
        .map(|m| {
            let total = m.current_interval_total_count.unwrap_or(0);
            let used = m.current_interval_usage_count.unwrap_or(0);
            let remaining = total.saturating_sub(used);
            let (time_window, _) = match (m.start_time, m.end_time) {
                (Some(start), Some(end)) => {
                    let start_dt = DateTime::from_timestamp(start / 1000, 0)
                        .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                    let end_dt = DateTime::from_timestamp(end / 1000, 0)
                        .unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                    (
                        format!("{} ~ {}", start_dt.format("%H:%M"), end_dt.format("%H:%M")),
                        (),
                    )
                }
                _ => ("00:00 ~ 00:00".to_string(), ()),
            };
            ModelDetail {
                name: m
                    .model_name
                    .clone()
                    .unwrap_or_else(|| "Unknown".to_string()),
                time_window,
                total_count: total,
                remaining_count: remaining,
                used_count: used,
            }
        })
        .collect();

    Ok(UsageData {
        ok: true,
        status_label: "Success".to_string(),
        primary_model_name: primary
            .and_then(|m| m.model_name.clone())
            .unwrap_or_default(),
        time_window,
        reset_timestamp,
        reset_in_label,
        total_count,
        remaining_count,
        used_count,
        used_percent,
        weekly_total_count: weekly_total.filter(|&v| v > 0),
        weekly_used_count: weekly_used,
        weekly_remaining_count: weekly_remaining,
        weekly_used_percent: weekly_percent.filter(|&v| v.is_finite()),
        weekly_reset_timestamp,
        weekly_reset_in_label,
        interval_label,
        models: model_details,
        last_updated: now.format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

fn fetch_minimax_payload_blocking(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, Box<dyn std::error::Error + Send + Sync>> {
    match fetch_minimax_payload_reqwest(api_key, timeout_ms, url) {
        Ok(payload) => Ok(payload),
        Err(error) => {
            let reqwest_error = format_reqwest_error(&error);
            if !error.is_timeout() && !error.is_connect() {
                return Err(reqwest_error.into());
            }

            #[cfg(target_os = "macos")]
            {
                log::warn!(
                    "MiniMax request failed through reqwest, trying system curl fallback: {}",
                    reqwest_error
                );
                match fetch_minimax_payload_curl(api_key, timeout_ms, url) {
                    Ok(payload) => {
                        log::info!("MiniMax request recovered through system curl fallback");
                        Ok(payload)
                    }
                    Err(curl_error) => Err(format!(
                        "{}; system curl fallback failed: {}",
                        reqwest_error, curl_error
                    )
                    .into()),
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                #[allow(clippy::needless_return)]
                return Err(reqwest_error.into());
            }
        }
    }
}

fn fetch_minimax_payload_reqwest(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_millis(CONNECT_TIMEOUT_MS))
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    client
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .send()
        .and_then(|response| response.json::<MiniMaxResponse>())
}

#[cfg(target_os = "macos")]
fn fetch_minimax_payload_curl(
    api_key: &str,
    timeout_ms: u64,
    url: &str,
) -> Result<MiniMaxResponse, Box<dyn std::error::Error + Send + Sync>> {
    validate_header_value(api_key)?;

    let connect_timeout = seconds_for_curl(CONNECT_TIMEOUT_MS);
    let max_time_ms = timeout_ms.clamp(1_000, CURL_FALLBACK_MAX_TIME_MS);
    let max_time = seconds_for_curl(max_time_ms);
    let auth_header = format!("Authorization: Bearer {}", api_key.trim());
    let config = format!("header = \"{}\"\n", curl_config_quote_value(&auth_header));

    let mut child = Command::new("/usr/bin/curl")
        .arg("-sS")
        .arg("--connect-timeout")
        .arg(&connect_timeout)
        .arg("--max-time")
        .arg(&max_time)
        .arg("--request")
        .arg("GET")
        .arg("--url")
        .arg(url)
        .arg("--header")
        .arg("Content-Type: application/json")
        .arg("--header")
        .arg("Accept: application/json")
        .arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start /usr/bin/curl: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .map_err(|e| format!("failed to write curl config: {}", e))?;
    } else {
        return Err("failed to open curl stdin for config".into());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for curl: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "curl exited with {}; stderr: {}",
            output.status,
            truncate_for_error(&stderr, 500)
        )
        .into());
    }

    serde_json::from_slice::<MiniMaxResponse>(&output.stdout).map_err(|e| {
        let stdout = String::from_utf8_lossy(&output.stdout);
        format!(
            "failed to parse curl response JSON: {}; body: {}",
            e,
            truncate_for_error(&stdout, 500)
        )
        .into()
    })
}

#[cfg(target_os = "macos")]
fn seconds_for_curl(ms: u64) -> String {
    let seconds = (ms as f64 / 1000.0).max(0.001);
    format!("{:.3}", seconds)
}

#[cfg(target_os = "macos")]
fn validate_header_value(value: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if value.trim().is_empty() {
        return Err("API key is empty".into());
    }
    if value.chars().any(|ch| ch.is_control()) {
        return Err("API key contains unsupported control characters".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn curl_config_quote_value(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            _ => quoted.push(ch),
        }
    }
    quoted
}

#[cfg(target_os = "macos")]
fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

fn format_reqwest_error(error: &reqwest::Error) -> String {
    let mut message = format!(
        "{} (timeout={}, connect={}, status={:?})",
        error,
        error.is_timeout(),
        error.is_connect(),
        error.status()
    );
    let mut source = error.source();
    while let Some(err) = source {
        message.push_str("; caused by: ");
        message.push_str(&err.to_string());
        source = err.source();
    }
    message
}

fn format_duration(seconds: i64) -> String {
    if seconds <= 0 {
        return "00:00".to_string();
    }
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

fn format_english_duration(total_seconds: i64) -> String {
    if total_seconds <= 0 {
        return "0m".to_string();
    }
    let days = total_seconds / 86400;
    let hours = (total_seconds % 86400) / 3600;
    let minutes = (total_seconds % 3600) / 60;

    if days > 0 {
        format!("{}d", days)
    } else if hours > 0 {
        format!("{}h", hours)
    } else {
        format!("{}m", minutes)
    }
}
