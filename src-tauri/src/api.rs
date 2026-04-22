use crate::state::{ModelDetail, UsageData};
use chrono::{DateTime, Local, Utc};
use serde::Deserialize;
use std::time::Duration;

const REMAINS_ENDPOINT: &str = "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains";

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

pub async fn fetch_minimax_usage(api_key: &str, timeout_ms: u64) -> Result<UsageData, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;
    
    let response = client
        .get(REMAINS_ENDPOINT)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await?;
    
    let payload: MiniMaxResponse = response.json().await?;
    
    let business_status_code = payload.status_code.or(payload.base_resp.as_ref().and_then(|b| b.status_code)).unwrap_or(0);
    
    if business_status_code != 0 {
        let msg = payload.status_msg.or(payload.base_resp.and_then(|b| b.status_msg)).unwrap_or_else(|| "Unknown error".to_string());
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
        let remaining = m.current_interval_usage_count.unwrap_or(0);
        let used = total.saturating_sub(remaining);
        let percent = if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 };
        (Some(total), Some(remaining), Some(used), Some(percent))
    } else {
        (None, None, None, None)
    };
    
    let (weekly_total, weekly_remaining, weekly_used, weekly_percent) = if let Some(m) = primary {
        let total = m.current_weekly_total_count.unwrap_or(0);
        let remaining = m.current_weekly_usage_count.unwrap_or(0);
        let used = total.saturating_sub(remaining);
        let percent = if total > 0 { (used as f64 / total as f64) * 100.0 } else { 0.0 };
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
            let start_dt = DateTime::from_timestamp(start / 1000, 0).unwrap_or_else(|| Utc::now().with_timezone(&Utc));
            let end_dt = DateTime::from_timestamp(end / 1000, 0).unwrap_or_else(|| Utc::now().with_timezone(&Utc));
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
            let remaining = m.current_interval_usage_count.unwrap_or(0);
            let used = total.saturating_sub(remaining);
            let (time_window, _) = if m.start_time.is_some() && m.end_time.is_some() {
                let start = m.start_time.unwrap();
                let end = m.end_time.unwrap();
                let start_dt = DateTime::from_timestamp(start / 1000, 0).unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                let end_dt = DateTime::from_timestamp(end / 1000, 0).unwrap_or_else(|| Utc::now().with_timezone(&Utc));
                (format!("{} ~ {}", start_dt.format("%H:%M"), end_dt.format("%H:%M")), ())
            } else {
                ("00:00 ~ 00:00".to_string(), ())
            };
            ModelDetail {
                name: m.model_name.clone().unwrap_or_else(|| "Unknown".to_string()),
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
        primary_model_name: primary.and_then(|m| m.model_name.clone()).unwrap_or_default(),
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