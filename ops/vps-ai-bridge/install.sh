#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

REF="${BRIDGE_INSTALL_REF:-infra/vps-ai-bridge-v1}"
RAW="https://raw.githubusercontent.com/alex43github/trade-workbench/${REF}"
ENV_FILE="/etc/trade-workbench-ai-bridge.env"

if [[ ! -s "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it first with GITHUB_TOKEN and bridge settings." >&2
  exit 2
fi

install -d -m 700 /opt/trade-workbench-ai-bridge
install -d -m 700 /var/lib/trade-workbench-ai-bridge
install -d -m 700 /var/backups/trade-workbench-ai-bridge

curl -fsSL "${RAW}/ops/vps-ai-bridge/agent.py" -o /opt/trade-workbench-ai-bridge/agent.py
curl -fsSL "${RAW}/ops/vps-ai-bridge/executor.py" -o /opt/trade-workbench-ai-bridge/executor.py
curl -fsSL "${RAW}/deploy/trade-workbench-ai-bridge.service" -o /etc/systemd/system/trade-workbench-ai-bridge.service

chmod 700 /opt/trade-workbench-ai-bridge/agent.py /opt/trade-workbench-ai-bridge/executor.py
chmod 600 "${ENV_FILE}"
chmod 644 /etc/systemd/system/trade-workbench-ai-bridge.service

python3 -m py_compile /opt/trade-workbench-ai-bridge/agent.py /opt/trade-workbench-ai-bridge/executor.py
systemctl daemon-reload
systemctl enable --now trade-workbench-ai-bridge.service
systemctl --no-pager --full status trade-workbench-ai-bridge.service | sed -n '1,12p'
