#!/bin/bash
# MiniMax Monitor Installer
# ==========================================

set -e

APP_NAME="MiniMax Monitor"
APP_BUNDLE="MiniMax Monitor.app"
# Get script directory and find DMG
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/minimax-monitor.dmg" ]; then
    APP_DMG="$SCRIPT_DIR/minimax-monitor.dmg"
else
    APP_DMG="/tmp/minimax-monitor.dmg"
fi
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

echo "=========================================="
echo "  MiniMax Monitor Installer"
echo "=========================================="
echo ""

# Check for admin privileges (for system-wide installation)
ADMIN_INSTALL=false
if [ "$EUID" -ne 0 ] && [ "$1" != "--user" ]; then
    echo "NOTE: Running without sudo. Will install for current user only."
    echo "      Use --admin flag to install system-wide (requires sudo)."
    echo ""
fi

# Parse arguments
AUTO_LAUNCH=false
for arg in "$@"; do
    case $arg in
        --auto-launch)
            AUTO_LAUNCH=true
            ;;
        --user)
            # User-only installation
            ;;
        --admin)
            ADMIN_INSTALL=true
            ;;
    esac
done

# Mount DMG
info "Mounting disk image..."
DMG_OUTPUT=$(hdiutil attach "$APP_DMG" -nobrowse 2>&1)
DMG_VOLUME=$(echo "$DMG_OUTPUT" | grep '/Volumes' | head -1 | awk '{print $3}')
DMG_VOLUME_BASE=$(basename "$DMG_VOLUME" | sed 's/ 1$//')

if [ -z "$DMG_VOLUME" ]; then
    error "Failed to mount disk image: $DMG_OUTPUT"
fi

# Find the actual volume name
APP_VOLUME=""
for vol in /Volumes/MiniMax*; do
    if [ -d "$vol" ] && [ -d "$vol/$APP_BUNDLE" ]; then
        APP_VOLUME="$vol"
        break
    fi
done

if [ -z "$APP_VOLUME" ]; then
    error "Could not find $APP_BUNDLE in mounted volumes"
fi

info "Disk image mounted at: $DMG_VOLUME"

# Stop existing app if running
if pgrep -f "$APP_BUNDLE" > /dev/null; then
    warn "Stopping existing $APP_NAME..."
    pkill -f "$APP_BUNDLE" || true
    sleep 1
fi

# Remove old installation
if [ -d "$INSTALL_DIR/$APP_BUNDLE" ]; then
    info "Removing old installation..."
    rm -rf "$INSTALL_DIR/$APP_BUNDLE"
fi

# Copy app bundle
info "Installing $APP_NAME to $INSTALL_DIR..."
cp -r "$APP_VOLUME/$APP_BUNDLE" "$INSTALL_DIR/"

# Set permissions
chmod -R 755 "$INSTALL_DIR/$APP_BUNDLE"
chown -R $(whoami) "$INSTALL_DIR/$APP_BUNDLE"

# Unmount DMG
hdiutil detach "$APP_VOLUME" 2>/dev/null || true
info "Disk image unmounted."

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
else
    info "Skipping auto-launch setup."
fi

echo ""
echo "=========================================="
info "Installation complete!"
echo ""
echo "  To enable auto-launch on startup, run:"
echo "    $0 --auto-launch"
echo ""
echo "  To start the app, click:"
echo "    $INSTALL_DIR/$APP_BUNDLE"
echo "=========================================="
echo ""