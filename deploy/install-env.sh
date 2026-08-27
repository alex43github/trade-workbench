#!/usr/bin/env bash
set -euo pipefail

source_file="${1:-$(dirname "$0")/workbench.env.example}"
target_file="${2:-/etc/trade-workbench/workbench.env}"
service_user="${SERVICE_USER:-trade-workbench}"

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run with sudo so the secret file can be installed securely.' >&2
  exit 1
fi
if [[ ! -f "$source_file" ]]; then
  printf 'Template not found: %s\n' "$source_file" >&2
  exit 1
fi
if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/trade-workbench --create-home --shell /usr/sbin/nologin "$service_user"
fi
install -d -o root -g root -m 0700 /etc/trade-workbench
install -d -o "$service_user" -g "$service_user" -m 0700 /var/lib/trade-workbench/sqlite /var/lib/trade-workbench/backups /var/lib/trade-workbench/structure-radar
if [[ -e "$target_file" ]]; then
  printf 'Refusing to overwrite existing secret file: %s\n' "$target_file" >&2
  exit 1
fi
install -o root -g root -m 0600 "$source_file" "$target_file"
printf 'Installed %s. Edit it as root, replace all placeholder tokens, then restart the services.\n' "$target_file"
