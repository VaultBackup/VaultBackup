#!/usr/bin/env bash
# Install VaultBackup agent as a systemd service (Web UI on 0.0.0.0:8787).
set -euo pipefail

BIN_SRC="${1:-}"
INSTALL_DIR=/opt/vaultbackup
ETC_DIR=/etc/vaultbackup
DATA_DIR=/var/lib/vaultbackup
SERVICE_NAME=vaultbackup-agent

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 /path/to/vaultbackup-agent-linux-amd64.bin"
  exit 1
fi

if [[ -z "$BIN_SRC" || ! -f "$BIN_SRC" ]]; then
  echo "Usage: sudo bash $0 /path/to/vaultbackup-agent-linux-amd64.bin"
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$ETC_DIR" "$DATA_DIR"
install -m 0755 "$BIN_SRC" "$INSTALL_DIR/vaultbackup-agent"

if [[ ! -f "$ETC_DIR/agent.env" ]]; then
  PASS="$(openssl rand -base64 18 | tr -d '=/+' | head -c 20)"
  cat > "$ETC_DIR/agent.env" <<EOF
WEBUI_PASSWORD=$PASS
EOF
  chmod 600 "$ETC_DIR/agent.env"
  echo "Generated UI password in $ETC_DIR/agent.env"
  echo "  WEBUI_PASSWORD=$PASS"
else
  echo "Keeping existing $ETC_DIR/agent.env"
fi

if [[ ! -f "$ETC_DIR/config.yaml" ]]; then
  cat > "$ETC_DIR/config.yaml" <<'EOF'
name: office-linux-1
schedule: "0 3 * * *"
work_dir: /var/lib/vaultbackup
log_file: /var/lib/vaultbackup/agent.log
retention: 14
license:
  server_url: https://backup.enadoctemp.workers.dev
  token: ""
database:
  type: postgres
  uri: ""
  backup_type: full
destination:
  mode: local
  local_dir: /var/lib/vaultbackup/backups
security:
  encrypt: true
  key_file: /var/lib/vaultbackup/agent.key
EOF
  chmod 600 "$ETC_DIR/config.yaml"
fi

# Prefer packaged unit if present next to this script
UNIT_SRC="$(dirname "$0")/vaultbackup-agent.service"
if [[ ! -f "$UNIT_SRC" ]]; then
  UNIT_SRC="/tmp/vaultbackup-agent.service"
  cat > "$UNIT_SRC" <<'EOF'
[Unit]
Description=VaultBackup Desktop Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/vaultbackup
EnvironmentFile=-/etc/vaultbackup/agent.env
ExecStart=/opt/vaultbackup/vaultbackup-agent -config /etc/vaultbackup/config.yaml -webui 0.0.0.0:8787 -webui-password ${WEBUI_PASSWORD}
Restart=always
RestartSec=5
LimitNOFILE=65535
ReadWritePaths=/opt/vaultbackup /etc/vaultbackup /var/lib/vaultbackup

[Install]
WantedBy=multi-user.target
EOF
fi

install -m 0644 "$UNIT_SRC" /etc/systemd/system/${SERVICE_NAME}.service
systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME}.service
sleep 1
systemctl --no-pager --full status ${SERVICE_NAME}.service || true

echo
echo "Service: ${SERVICE_NAME}"
echo "Web UI:  http://0.0.0.0:8787  (use this host IP from other machines)"
echo "Password: see /etc/vaultbackup/agent.env (WEBUI_PASSWORD)"
echo "Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "Config:  /etc/vaultbackup/config.yaml  (or use the Web UI)"
