#!/bin/bash
# MiniMax Monitor - Build and Install Script
# ==========================================

set -e

APP_NAME="MiniMax Monitor"
APP_BUNDLE="MiniMax Monitor.app"
INSTALL_DIR="/Applications"
LAUNCH_AGENT_NAME="com.decard.minimax-monitor"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_PLIST="$LAUNCH_AGENT_DIR/$LAUNCH_AGENT_NAME.plist"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

echo "=========================================="
echo "  MiniMax Monitor - Build & Install"
echo "=========================================="
echo ""

# Parse arguments
SKIP_BUILD=false
AUTO_LAUNCH=false
for arg in "$@"; do
    case $arg in
        --skip-build)
            SKIP_BUILD=true
            ;;
        --auto-launch)
            AUTO_LAUNCH=true
            ;;
    esac
done

# Build step
if [ "$SKIP_BUILD" = false ]; then
    info "Building $APP_NAME..."
    cd "$PROJECT_ROOT"

    # Check npm/node
    if ! command -v npm &> /dev/null; then
        error "npm not found. Please install Node.js."
    fi

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        info "Installing npm dependencies..."
        npm install
    fi

    # Build Tauri app
    info "Building Tauri app (this may take a few minutes)..."
    npm run tauri:build

    if [ $? -ne 0 ]; then
        error "Build failed!"
    fi

    info "Build completed successfully!"
else
    info "Skipping build step..."
fi

# Find the built app
APP_BUNDLE_PATH=""
for path in \
    "$PROJECT_ROOT/src-tauri/target/release/bundle/macos/$APP_BUNDLE" \
    "$PROJECT_ROOT/src-tauri/target/release/bundle/macos/MiniMax Monitor.app"; do
    if [ -d "$path" ]; then
        APP_BUNDLE_PATH="$path"
        break
    fi
done

if [ -z "$APP_BUNDLE_PATH" ]; then
    error "Could not find built app. Run without --skip-build or check build output."
fi

info "Found app at: $APP_BUNDLE_PATH"

# Stop existing app if running
if pgrep -f "$APP_NAME" > /dev/null; then
    warn "Stopping existing $APP_NAME..."
    pkill -f "$APP_NAME" || true
    sleep 2
fi

# Remove old installation
if [ -d "$INSTALL_DIR/$APP_BUNDLE" ]; then
    info "Removing old installation..."
    rm -rf "$INSTALL_DIR/$APP_BUNDLE"
fi

# Copy app bundle
info "Installing $APP_NAME to $INSTALL_DIR..."
cp -R "$APP_BUNDLE_PATH" "$INSTALL_DIR/"

# Set permissions
chmod -R 755 "$INSTALL_DIR/$APP_BUNDLE"
chown -R $(whoami) "$INSTALL_DIR/$APP_BUNDLE"

info "Installation complete!"

# Handle auto-launch
if [ "$AUTO_LAUNCH" = true ]; then
    info "Enabling auto-launch on startup..."

    # Create LaunchAgents directory
    mkdir -p "$LAUNCH_AGENT_DIR"

    # Create plist
    cat > "$LAUNCH_AGENT_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LAUNCH_AGENT_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/$APP_BUNDLE/Contents/MacOS/minimax-usage-monitor</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>LaunchOnlyOnce</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/minimax-monitor.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/minimax-monitor.log</string>
</dict>
</plist>
EOF

    # Load the launch agent
    launchctl unload "$LAUNCH_AGENT_PLIST" 2>/dev/null || true
    launchctl load "$LAUNCH_AGENT_PLIST"

    info "Auto-launch enabled. $APP_NAME will start on login."
fi

echo ""
echo "=========================================="
echo "  Installation complete!"
echo ""
echo "  To start the app, run:"
echo "    open \"$INSTALL_DIR/$APP_BUNDLE\""
echo ""
echo "  Or click the app in Launchpad"
echo "=========================================="
echo ""