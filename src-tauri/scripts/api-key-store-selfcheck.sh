#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PROBE_DIR="$TMP_DIR/probe"
mkdir -p "$PROBE_DIR/src"

cat > "$PROBE_DIR/Cargo.toml" <<'EOF'
[package]
name = "api-key-store-probe"
version = "0.1.0"
edition = "2021"

[dependencies]
keyring = { version = "3", features = ["apple-native"] }
dirs = "5"
EOF

cat > "$PROBE_DIR/src/main.rs" <<EOF
#[path = "$(pwd)/src/api_key_store.rs"]
mod api_key_store;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: probe <save <key>|load|clear>");
        std::process::exit(2);
    }

    let result = match args[1].as_str() {
        "save" => {
            if args.len() < 3 {
                Err("missing key argument".to_string())
            } else {
                api_key_store::save_api_key(&args[2]).map(|_| "OK".to_string())
            }
        }
        "load" => Ok(api_key_store::load_api_key().unwrap_or_else(|| "__EMPTY__".to_string())),
        "clear" => api_key_store::clear_api_key().map(|_| "OK".to_string()),
        _ => Err(format!("unknown command: {}", args[1])),
    };

    match result {
        Ok(output) => println!("{}", output),
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    }
}
EOF

SERVICE="com.decard.minimax-monitor.selfcheck.$(date +%s)"

export MINIMAX_MONITOR_CONFIG_DIR="$TMP_DIR/config"
export MINIMAX_MONITOR_KEYCHAIN_SERVICE="$SERVICE"
export MINIMAX_MONITOR_KEYCHAIN_LEGACY_SERVICES="$SERVICE.legacy1,$SERVICE.legacy2"
export MINIMAX_MONITOR_DISABLE_KEYCHAIN="1"

cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- clear >/dev/null
cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- save "k1-value" >/dev/null
LOAD_1="$(cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- load)"
if [[ "$LOAD_1" != "k1-value" ]]; then
  echo "selfcheck failed: expected k1-value, got $LOAD_1"
  exit 1
fi

cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- save "k2-value" >/dev/null
LOAD_2="$(cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- load)"
if [[ "$LOAD_2" != "k2-value" ]]; then
  echo "selfcheck failed: expected k2-value, got $LOAD_2"
  exit 1
fi

cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- clear >/dev/null
LOAD_3="$(cargo run --quiet --manifest-path "$PROBE_DIR/Cargo.toml" -- load)"
if [[ "$LOAD_3" != "__EMPTY__" ]]; then
  echo "selfcheck failed: expected __EMPTY__, got $LOAD_3"
  exit 1
fi

cargo test api_key_store -- --test-threads=1

echo "api key store selfcheck passed"
