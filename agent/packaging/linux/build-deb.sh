#!/usr/bin/env bash
# Build a simple .deb for amd64/arm64 agent binary.
# Usage: ./build-deb.sh /path/to/vaultbackup-agent-linux-amd64 [version] [arch]
set -euo pipefail
BINARY="${1:-}"
VERSION="${2:-1.2.8}"
ARCH="${3:-}"
if [[ -z "$BINARY" || ! -f "$BINARY" ]]; then
  echo "Usage: $0 /path/to/vaultbackup-agent-linux-{amd64|arm64} [version] [arch]" >&2
  exit 1
fi
if [[ -z "$ARCH" ]]; then
  case "$BINARY" in
    *arm64*) ARCH=arm64 ;;
    *) ARCH=amd64 ;;
  esac
fi
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/vaultbackup-agent_${VERSION}_${ARCH}"
mkdir -p "$ROOT/DEBIAN" \
  "$ROOT/opt/vaultbackup" \
  "$ROOT/etc/vaultbackup" \
  "$ROOT/lib/systemd/system" \
  "$ROOT/usr/share/doc/vaultbackup-agent"

install -m 755 "$BINARY" "$ROOT/opt/vaultbackup/vaultbackup-agent"
cat >"$ROOT/etc/vaultbackup/config.yaml.example" <<'YAML'
name: agent-1
schedule: "0 3 * * *"
work_dir: /var/lib/vaultbackup
log_file: /var/log/vaultbackup/agent.log
retention: 14
license:
  server_url: "https://backup.enadoctemp.workers.dev"
  token: ""
database:
  type: sqlite
  uri: ""
  backup_type: full
destination:
  mode: local
  local_dir: /var/lib/vaultbackup/backups
security:
  encrypt: true
  key_file: /var/lib/vaultbackup/agent.key
YAML

cat >"$ROOT/lib/systemd/system/vaultbackup-agent.service" <<'UNIT'
[Unit]
Description=VaultBackup Desktop Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/vaultbackup/vaultbackup-agent -config /etc/vaultbackup/config.yaml -webui 0.0.0.0:8787
WorkingDirectory=/opt/vaultbackup
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT

cat >"$ROOT/DEBIAN/control" <<CTRL
Package: vaultbackup-agent
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: VaultBackup <support@vaultbackup.local>
Description: VaultBackup desktop agent for private database backups
CTRL

cat >"$ROOT/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
mkdir -p /var/lib/vaultbackup/backups /var/log/vaultbackup
if [ ! -f /etc/vaultbackup/config.yaml ] && [ -f /etc/vaultbackup/config.yaml.example ]; then
  cp /etc/vaultbackup/config.yaml.example /etc/vaultbackup/config.yaml
fi
systemctl daemon-reload || true
POST
chmod 755 "$ROOT/DEBIAN/postinst"

OUT="vaultbackup-agent_${VERSION}_${ARCH}.deb"
dpkg-deb --build "$ROOT" "$OUT"
echo "Built $OUT"
