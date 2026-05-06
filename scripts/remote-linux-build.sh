#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.remote}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "未找到环境文件: $ENV_FILE"
  echo "请创建 .env.remote，至少包含:"
  echo "  REMOTE_LINUX=192.168.19.107"
  echo "  REMOTE_LINUX_USER=runner"
  echo "  REMOTE_LINUX_DIR=/opt/builds/minimax"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_vars=(REMOTE_LINUX REMOTE_LINUX_USER REMOTE_LINUX_DIR)
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "缺少必填变量: $var_name (来源: $ENV_FILE)"
    exit 1
  fi
done

REMOTE_LINUX_PORT="${REMOTE_LINUX_PORT:-22}"
REMOTE_LINUX_SSH_KEY="${REMOTE_LINUX_SSH_KEY:-}"
REMOTE_LINUX_PASSWORD="${REMOTE_LINUX_PASSWORD:-}"
REMOTE_LINUX_BUILD_CMD="${REMOTE_LINUX_BUILD_CMD:-npm config delete proxy || true; npm config delete https-proxy || true; sudo apt-get update && sudo apt-get install -y libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev libwebkit2gtk-4.1-dev patchelf pkg-config rpm && npm ci && npm run tauri:build:ci}"
REMOTE_LINUX_ARTIFACT_DIR="${REMOTE_LINUX_ARTIFACT_DIR:-src-tauri/target/release/bundle}"
LOCAL_OUTPUT_DIR="${LOCAL_OUTPUT_DIR:-$ROOT_DIR/dist/linux-remote/$(date +%Y%m%d-%H%M%S)}"

REMOTE_TARGET="${REMOTE_LINUX_USER}@${REMOTE_LINUX}"
SSH_ARGS=(-p "$REMOTE_LINUX_PORT" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH_CMD="ssh -p $REMOTE_LINUX_PORT -o StrictHostKeyChecking=accept-new"

if [[ -n "$REMOTE_LINUX_SSH_KEY" ]]; then
  if [[ ! -f "$REMOTE_LINUX_SSH_KEY" ]]; then
    echo "REMOTE_LINUX_SSH_KEY 指向的文件不存在: $REMOTE_LINUX_SSH_KEY"
    exit 1
  fi
  SSH_ARGS+=(-i "$REMOTE_LINUX_SSH_KEY")
  RSYNC_SSH_CMD="$RSYNC_SSH_CMD -i $REMOTE_LINUX_SSH_KEY"
fi

run_ssh() {
  if [[ -n "$REMOTE_LINUX_PASSWORD" ]]; then
    sshpass -p "$REMOTE_LINUX_PASSWORD" ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "$@"
  else
    ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "$@"
  fi
}

run_rsync() {
  if [[ -n "$REMOTE_LINUX_PASSWORD" ]]; then
    sshpass -p "$REMOTE_LINUX_PASSWORD" rsync "$@"
  else
    rsync "$@"
  fi
}

echo "==> 远程构建目标: $REMOTE_TARGET"
echo "==> 远程目录: $REMOTE_LINUX_DIR"
echo "==> 本地产物目录: $LOCAL_OUTPUT_DIR"

echo "==> 准备远程目录"
run_ssh "mkdir -p '$REMOTE_LINUX_DIR'"

echo "==> 同步代码到远程 Linux"
run_rsync -az --delete \
  --exclude ".git" \
  --exclude ".worktree" \
  --exclude ".worktrees" \
  --exclude "node_modules" \
  --exclude "out" \
  --exclude "dist" \
  --exclude "src-tauri/target" \
  --exclude "*.vsix" \
  -e "$RSYNC_SSH_CMD" \
  "$ROOT_DIR/" \
  "$REMOTE_TARGET:$REMOTE_LINUX_DIR/"

echo "==> 远程执行构建命令"
run_ssh "cd '$REMOTE_LINUX_DIR' && \
  export PATH=\"\$HOME/.cargo/bin:\$PATH\" && \
  (source \"\$HOME/.cargo/env\" 2>/dev/null || true) && \
  (command -v rustup >/dev/null 2>&1 && rustup default stable >/dev/null 2>&1 || true) && \
  $REMOTE_LINUX_BUILD_CMD"

mkdir -p "$LOCAL_OUTPUT_DIR"

echo "==> 拉取 Linux 构建产物"
for bundle in appimage deb rpm; do
  run_rsync -az \
    -e "$RSYNC_SSH_CMD" \
    "$REMOTE_TARGET:$REMOTE_LINUX_DIR/$REMOTE_LINUX_ARTIFACT_DIR/$bundle/" \
    "$LOCAL_OUTPUT_DIR/$bundle/" || true
done

echo "==> 完成"
echo "产物目录: $LOCAL_OUTPUT_DIR"
