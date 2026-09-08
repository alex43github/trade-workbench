#!/usr/bin/env bash
set -euo pipefail

data_dir="${WORKBENCH_DATA_DIR:-/var/lib/trade-workbench}"
database="${STREETLIGHT_LOCAL_D1:-$data_dir/sqlite/d1.sqlite}"
backup_dir="${BACKUP_DIR:-$data_dir/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_dir/d1-$timestamp.sqlite"

umask 077
install -d -m 0700 "$backup_dir"
if [[ ! -f "$database" ]]; then
  printf 'SQLite database not found: %s\n' "$database" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  printf '%s\n' 'sqlite3 is required for a consistent online backup.' >&2
  exit 1
fi
sqlite3 "$database" ".backup '$destination'"
sqlite3 "$destination" 'PRAGMA integrity_check;' | grep -qx 'ok'
printf '%s\n' "$destination"
