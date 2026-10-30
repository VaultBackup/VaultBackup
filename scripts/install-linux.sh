#!/usr/bin/env bash
# VaultBackup Agent — production systemd installer (hardened)
# Usage: sudo ./install-linux.sh [path-to-binary]
set -euo pipefail

BINARY="${1:-}"
if [[ -z "$BINARY" ]]; then
  if [[ -x ./vaultbackup-agent ]]; then
    BINARY=./vaultbackup-agent
  elif [[ -x ./dist/vaultbackup-agent-linux-amd64 ]]; then
    BINARY=./dist/vaultbackup-agent-linux-amd64
  elif [[ -x ./vaultbackup-agent-linux-amd64 ]]; then
    BINARY=./vaultbackup-agent-linux-amd64
  else
    echo "Usage: $0 /path/to/vaultbackup-agent" >&2
    exit 1
  fi
fi
if [[ ! -x "$BINARY" ]]; then
  echo "Binary not executable: $BINARY" >&2
  exit 1
fi

PREFIX="${PREFIX:-/opt/vaultbackup}"
USER_NAME="${VB_USER:-vaultbackup}"
GROUP_NAME="${VB_GROUP:-$USER_NAME}"
SERVICE=vaultbackup-agent

echo "==> Installing VaultBackup Agent to $PREFIX (user=$USER_NAME)"

# Dedicated system user
if ! id -u "$USER_NAME" &>/dev/null; then
  useradd --system --home-dir "$PREFIX" --shell /usr/sbin/nologin --user-group "$USER_NAME" 2>/dev/null \
    || useradd --system --home-dir "$PREFIX" --shell /sbin/nologin -g "$GROUP_NAME" "$USER_NAME" 2>/dev/null \
    || true
fi

mkdir -p "$PREFIX" "$PREFIX/work" "$PREFIX/logs"
cp -f "$BINARY" "$PREFIX/vaultbackup-agent"
chmod 755 "$PREFIX/vaultbackup-agent"

if [[ ! -f "$PREFIX/config.yaml" ]]; then
  if [[ -f ./config.example.yaml ]]; then
    cp ./config.example.yaml "$PREFIX/config.yaml"
    # Force absolute paths so relative paths never break after reboot / chdir
    sed -i 's|work_dir: .*|work_dir: /opt/vaultbackup/work|' "$PREFIX/config.yaml" 2>/dev/null || true
    sed -i 's|log_file: .*|log_file: /opt/vaultbackup/logs/agent.log|' "$PREFIX/config.yaml" 2>/dev/null || true
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
chown -R "$USER_NAME:$GROUP_NAME" "$PREFIX"

# systemd unit — hardened for crash / OOM / SIGKILL recovery
cat >/etc/systemd/system/${SERVICE}.service <<UNIT
[Unit]
Description=VaultBackup Desktop Agent
Documentation=https://vaultbackup.app
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory=$PREFIX
ExecStart=$PREFIX/vaultbackup-agent -config $PREFIX/config.yaml -webui=127.0.0.1:8787
# Restart on any exit (crash, OOM-kill, SIGKILL, unclean shutdown)
Restart=always
RestartSec=10
# Optional watchdog (agent would need to implement sd_notify; left commented)
# WatchdogSec=60
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$PREFIX
PrivateTmp=true
LimitNOFILE=65536
# Clear environment of secrets that might leak into child processes
Environment=HOME=$PREFIX

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE}.service"
systemctl restart "${SERVICE}.service" || systemctl start "${SERVICE}.service"

echo ""
echo "Installed and started."
echo "  Config : $PREFIX/config.yaml"
echo "  Logs   : journalctl -u $SERVICE -f"
echo "  Web UI : http://127.0.0.1:8787  (localhost only)"
echo "  Status : systemctl status $SERVICE"
echo ""
echo "IMPORTANT:"
echo "  1. Edit $PREFIX/config.yaml — set license.server_url + token"
echo "  2. Open http://127.0.0.1:8787 → Test license → confirm License OK"
echo "  3. Set notify.webhook_url for alerts on critical errors"
echo "  4. Restart: systemctl restart $SERVICE"
echo ""
echo "License: agent must reach the Worker at least once every 72 hours."
echo "Monitor console for agents offline > 48 h."
