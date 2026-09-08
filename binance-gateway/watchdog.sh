#!/usr/bin/env bash
# binance-gateway/watchdog.sh — 周期性健康检查，网关状态翻转时通过 notify.sh 推送 Bark
# 覆盖 ExecStopPost 无法触发的场景：node 进程假死、开机后服务启动失败等。
# 注意: 整机断电时本机无法发出"下线"通知；恢复供电开机后会自动推送"上线"。
set -u

GATEWAY_DIR="${BINANCE_GATEWAY_DIR:-/opt/binance-gateway}"
ENV_FILE="${BINANCE_GATEWAY_ENV_FILE:-${GATEWAY_DIR}/.env}"
STATE_FILE="${BINANCE_GATEWAY_WATCHDOG_STATE:-${GATEWAY_DIR}/.watchdog-state}"
PORT="${BINANCE_GATEWAY_PORT:-8788}"
HEALTH_URL="${BINANCE_GATEWAY_HEALTH_URL:-http://127.0.0.1:${PORT}/health}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

alive=0
if curl -fsS -m 10 "$HEALTH_URL" >/dev/null 2>&1; then
  alive=1
fi

prev="unknown"
if [ -s "$STATE_FILE" ]; then
  prev="$(tr -d '[:space:]' < "$STATE_FILE" 2>/dev/null || true)"
fi
[ -n "$prev" ] || prev="unknown"

NOTIFY="${GATEWAY_DIR}/notify.sh"

case "${prev}:${alive}" in
  "0:1")
    echo 1 > "$STATE_FILE"
    if [ -x "$NOTIFY" ]; then "$NOTIFY" online || true; fi
    ;;
  "1:0")
    echo 0 > "$STATE_FILE"
    if [ -x "$NOTIFY" ]; then "$NOTIFY" offline || true; fi
    ;;
  *)
    # 首次运行或无变化：只记录状态，避免安装/重启时重复推送
    echo "$alive" > "$STATE_FILE"
    ;;
esac

exit 0
