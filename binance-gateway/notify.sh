#!/usr/bin/env bash
# binance-gateway/notify.sh — 通过 Bark 推送网关上线/下线通知
# 用法: notify.sh online|offline
#
# 安全说明:
#   1. 未配置 BARK_API_KEY 时静默退出，不影响安装与运行。
#   2. 内部出错也永远以 0 退出；挂在 systemd ExecStartPost/ExecStopPost 上
#      不会把服务标记为失败。
#   3. 推送内容只含主机名/IP/端口，不包含任何密钥或 token。
set -u

ENV_FILE="${BINANCE_GATEWAY_ENV_FILE:-/opt/binance-gateway/.env}"

STATE="${1:-}"
case "$STATE" in
  online|offline) ;;
  *) exit 0 ;;
esac

if [ -f "$ENV_FILE" ]; then
  # 读取网关 .env（含 BARK_API_KEY / BARK_BASE_URL 等配置）
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

BARK_KEY="${BARK_API_KEY:-}"
[ -n "$BARK_KEY" ] || exit 0

BARK_BASE="${BARK_BASE_URL:-https://api.day.app}"
HOST="$(hostname 2>/dev/null || echo vps)"
PORT="${BINANCE_GATEWAY_PORT:-8788}"
PUBLIC_IP="${BINANCE_GATEWAY_PUBLIC_IP:-unknown}"

if [ "$STATE" = "online" ]; then
  TITLE="✅ 交易网关已上线"
  BODY="主机 ${HOST} · IP ${PUBLIC_IP} · 端口 ${PORT} · 服务已启动"
else
  TITLE="⚠️ 交易网关已下线"
  BODY="主机 ${HOST} · IP ${PUBLIC_IP} · 端口 ${PORT} · 服务已停止或健康检查失败"
fi

# Bark 请求格式: GET {base}/{key}/{标题}?body=...（标题走路径并做 URL 编码，body 走查询参数）
send() {
  local key="$1" title="$2" body="$3"
  local title_enc="$title"
  if command -v node >/dev/null 2>&1; then
    title_enc="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$title" 2>/dev/null || echo "$title")"
  fi
  curl -fsS -m 10 -G \
    "${BARK_BASE}/${key}/${title_enc}" \
    --data-urlencode "body=${body}" \
    --data-urlencode "group=binance-gateway" \
    >/dev/null 2>&1 || true
}

# 支持多个设备 key（逗号或空格分隔），例如手机 + iPad
OLDIFS="$IFS"
IFS=', '
for key in $BARK_KEY; do
  [ -n "$key" ] || continue
  send "$key" "$TITLE" "$BODY"
done
IFS="$OLDIFS"

exit 0
