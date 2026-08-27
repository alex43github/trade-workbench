#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: sudo %s /var/lib/trade-workbench/backups/d1-YYYYMMDDTHHMMSSZ.sqlite\n' "$0" >&2
  exit 2
fi
backup="$1"
data_dir="${WORKBENCH_DATA_DIR:-/var/lib/trade-workbench}"
database="${STREETLIGHT_LOCAL_D1:-$data_dir/sqlite/d1.sqlite}"

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run with sudo after stopping trade-workbench.service.' >&2
  exit 1
fi
if [[ ! -f "$backup" ]]; then
  printf 'Backup not found: %s\n' "$backup" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  printf '%s\n' 'sqlite3 is required to verify the backup before restore.' >&2
  exit 1
fi
sqlite3 "$backup" 'PRAGMA integrity_check;' | grep -qx 'ok'
install -d -o trade-workbench -g trade-workbench -m 0700 "$(dirname "$database")"
install -o trade-workbench -g trade-workbench -m 0600 "$backup" "$database.restore"
mv -f "$database.restore" "$database"
rm -f "$database-wal" "$database-shm"
printf 'Restored %s to %s. Start trade-workbench.service now.\n' "$backup" "$database"
