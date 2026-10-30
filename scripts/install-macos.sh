#!/usr/bin/env bash
# VaultBackup Agent — launchd installer (macOS, hardened)
# Usage: sudo ./install-macos.sh [path-to-binary]
set -euo pipefail

BINARY="${1:-}"
if [[ -z "$BINARY" ]]; then
  ARCH=$(uname -m)
  if [[ -x ./vaultbackup-agent ]]; then
    BINARY=./vaultbackup-agent
  elif [[ "$ARCH" == "arm64" && -x ./dist/vaultbackup-agent-darwin-arm64 ]]; then
    BINARY=./dist/vaultbackup-agent-darwin-arm64
  elif [[ "$ARCH" == "arm64" && -x ./vaultbackup-agent-darwin-arm64 ]]; then
    BINARY=./vaultbackup-agent-darwin-arm64
  elif [[ -x ./dist/vaultbackup-agent-darwin-amd64 ]]; then
    BINARY=./dist/vaultbackup-agent-darwin-amd64
  elif [[ -x ./vaultbackup-agent-darwin-amd64 ]]; then
    BINARY=./vaultbackup-agent-darwin-amd64
  else
    echo "Usage: $0 /path/to/vaultbackup-agent" >&2
    exit 1
  fi
fi

PREFIX="${PREFIX:-/opt/vaultbackup}"
LABEL="com.vaultbackup.agent"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
USER_NAME="${VB_USER:-_vaultbackup}"

echo "==> Installing VaultBackup Agent to $PREFIX"

# Dedicated user (macOS system account style)
if ! id -u "$USER_NAME" &>/dev/null; then
  # Find a free UID in system range
  UID_NUM=350
  while id -u "$UID_NUM" &>/dev/null 2>&1; do UID_NUM=$((UID_NUM+1)); done
  dscl . -create "/Users/$USER_NAME"
  dscl . -create "/Users/$USER_NAME" UserShell /usr/bin/false
  dscl . -create "/Users/$USER_NAME" RealName "VaultBackup Agent"
  dscl . -create "/Users/$USER_NAME" UniqueID "$UID_NUM"
  dscl . -create "/Users/$USER_NAME" PrimaryGroupID 1
  dscl . -create "/Users/$USER_NAME" NFSHomeDirectory "$PREFIX"
fi

mkdir -p "$PREFIX" "$PREFIX/work" "$PREFIX/logs"
cp -f "$BINARY" "$PREFIX/vaultbackup-agent"
chmod 755 "$PREFIX/vaultbackup-agent"

if [[ ! -f "$PREFIX/config.yaml" ]]; then
  if [[ -f ./config.example.yaml ]]; then
    cp ./config.example.yaml "$PREFIX/config.yaml"
    # Force absolute paths
    sed -i '' 's|work_dir: .*|work_dir: /opt/vaultbackup/work|' "$PREFIX/config.yaml" 2>/dev/null || true
    sed -i '' 's|log_file: .*|log_file: /opt/vaultbackup/logs/agent.log|' "$PREFIX/config.yaml" 2>/dev/null || true
  else
    cat >"$PREFIX/config.yaml" <<'YAML'
name: agent
work_dir: /opt/vaultbackup/work
log_file: /opt/vaultbackup/logs/agent.log
log_max_mb: 20
schedule: "0 2 * * *"
compression: gzip

license:
  server_url: ""
  token: ""
  check_every_hours: 6

notify:
  webhook_url: ""

database:
  type: ""
  uri: ""

destination:
  mode: ""
YAML
  fi
fi
chmod 600 "$PREFIX/config.yaml"
chown -R "$USER_NAME:wheel" "$PREFIX"

# launchd plist — KeepAlive restarts on crash; RunAtLoad starts at boot
# ThrottleInterval prevents tight restart loops
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PREFIX}/vaultbackup-agent</string>
    <string>-config</string>
    <string>${PREFIX}/config.yaml</string>
    <string>-webui=127.0.0.1:8787</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PREFIX}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PREFIX}/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${PREFIX}/logs/stderr.log</string>
  <key>UserName</key>
  <string>${USER_NAME}</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${PREFIX}</string>
  </dict>
</dict>
</plist>
PLIST
chmod 644 "$PLIST"

launchctl bootout system/"$LABEL" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable system/"$LABEL"
launchctl kickstart -k system/"$LABEL"

echo ""
echo "Installed and started (launchd)."
echo "  Config : $PREFIX/config.yaml"
echo "  Logs   : $PREFIX/logs/"
echo "  Web UI : http://127.0.0.1:8787  (localhost only)"
echo "  Status : launchctl print system/$LABEL"
echo ""
echo "IMPORTANT:"
echo "  1. Edit $PREFIX/config.yaml — set license.server_url + token"
echo "  2. Open http://127.0.0.1:8787 → Test license → confirm License OK"
echo "  3. Set notify.webhook_url for alerts on critical errors"
echo "  4. Restart: sudo launchctl kickstart -k system/$LABEL"
echo ""
echo "License: agent must reach the Worker at least once every 72 hours."
echo "Monitor console for agents offline > 48 h."
