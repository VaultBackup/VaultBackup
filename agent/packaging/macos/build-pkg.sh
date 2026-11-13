#!/usr/bin/env bash
# Build a simple macOS .pkg that installs the agent binary + launchd unit.
# Run on macOS with: ./build-pkg.sh /path/to/vaultbackup-agent-darwin-arm64 [version]
set -euo pipefail

BINARY="${1:-}"
VERSION="${2:-1.2.6}"
ARCH_LABEL="${3:-}"

if [[ -z "$BINARY" || ! -f "$BINARY" ]]; then
  echo "Usage: $0 /path/to/vaultbackup-agent-darwin-{arm64|amd64} [version]" >&2
  exit 1
fi

if [[ -z "$ARCH_LABEL" ]]; then
  case "$BINARY" in
    *arm64*) ARCH_LABEL=arm64 ;;
    *amd64*) ARCH_LABEL=amd64 ;;
    *) ARCH_LABEL=universal ;;
  esac
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

PREFIX_ROOT="$STAGE/payload"
mkdir -p "$PREFIX_ROOT/opt/vaultbackup/bin" \
         "$PREFIX_ROOT/opt/vaultbackup/work" \
         "$PREFIX_ROOT/opt/vaultbackup/logs" \
         "$PREFIX_ROOT/Library/LaunchDaemons" \
         "$STAGE/scripts"

cp -f "$BINARY" "$PREFIX_ROOT/opt/vaultbackup/bin/vaultbackup-agent"
chmod 755 "$PREFIX_ROOT/opt/vaultbackup/bin/vaultbackup-agent"

cat >"$PREFIX_ROOT/opt/vaultbackup/config.yaml.example" <<'YAML'
name: agent-1
schedule: "0 3 * * *"
work_dir: /opt/vaultbackup/work
log_file: /opt/vaultbackup/logs/agent.log
log_max_mb: 20
compression: gzip
retention: 14
license:
  server_url: "https://backup.enadoctemp.workers.dev"
  token: ""
  check_every_hours: 6
security:
  encrypt: true
  key_file: /opt/vaultbackup/work/agent.key
database:
  type: ""
  uri: ""
  backup_type: full
destination:
  mode: local
  local_dir: /opt/vaultbackup/backups
YAML

LABEL="com.vaultbackup.agent"
cat >"$PREFIX_ROOT/Library/LaunchDaemons/${LABEL}.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/vaultbackup/bin/vaultbackup-agent</string>
    <string>-config</string>
    <string>/opt/vaultbackup/config.yaml</string>
    <string>-webui</string>
    <string>127.0.0.1:8787</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/opt/vaultbackup</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/opt/vaultbackup/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/opt/vaultbackup/logs/stderr.log</string>
</dict>
</plist>
PLIST

cat >"$STAGE/scripts/postinstall" <<'POST'
#!/bin/bash
set -e
mkdir -p /opt/vaultbackup/work /opt/vaultbackup/logs /opt/vaultbackup/backups
if [[ ! -f /opt/vaultbackup/config.yaml ]]; then
  cp /opt/vaultbackup/config.yaml.example /opt/vaultbackup/config.yaml
  chmod 600 /opt/vaultbackup/config.yaml
fi
chmod 755 /opt/vaultbackup/bin/vaultbackup-agent
launchctl bootout system/com.vaultbackup.agent 2>/dev/null || true
launchctl bootstrap system /Library/LaunchDaemons/com.vaultbackup.agent.plist 2>/dev/null || \
  launchctl load -w /Library/LaunchDaemons/com.vaultbackup.agent.plist 2>/dev/null || true
exit 0
POST
chmod 755 "$STAGE/scripts/postinstall"

OUT_DIR="${OUT_DIR:-$ROOT/out}"
mkdir -p "$OUT_DIR"
PKG_ID="com.vaultbackup.agent"
PKG_NAME="vaultbackup-agent-${VERSION}-darwin-${ARCH_LABEL}.pkg"

pkgbuild \
  --root "$PREFIX_ROOT" \
  --scripts "$STAGE/scripts" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT_DIR/$PKG_NAME"

echo "Built $OUT_DIR/$PKG_NAME"
ls -la "$OUT_DIR/$PKG_NAME"
