#!/usr/bin/env bash
# binance-gateway/install.sh — 一键安装币安固定 IP 网关到 VPS（Ubuntu/Debian/CentOS/Alpine）
set -euo pipefail

# ============================================================================
# 固定 IP 占位符（必填项）：
#   拿到 VPS 固定 IP 后，把下面的值改成实际 IP，例如 VPS_FIXED_IP="1.2.3.4"
#   留空时安装脚本会自动探测出口 IP 并打印，安装完再去币安后台白名单。
# ============================================================================
VPS_FIXED_IP="${VPS_FIXED_IP:-}"

GATEWAY_DIR="${GATEWAY_DIR:-/opt/binance-gateway}"
GATEWAY_USER="binance-gw"
GATEWAY_PORT="${BINANCE_GATEWAY_PORT:-8788}"
GATEWAY_RUN_USER="root"

say() { printf '\n[binance-gateway] %s\n' "$*"; }
die() { printf '\n[binance-gateway] 错误: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "请使用 root 运行：sudo bash install.sh"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
    if [ "${major:-0}" -ge 20 ]; then
      say "Node.js $(node -v) 已安装，满足要求"
      return
    fi
    say "Node.js 版本过低（$(node -v)），需要 >= 20"
  fi
  say "正在安装 Node.js 20 LTS ..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs || dnf module install -y nodejs:20
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs
  else
    die "无法识别的系统包管理器，请手动安装 Node.js >= 20 后重试"
  fi
  command -v node >/dev/null 2>&1 || die "Node.js 安装失败"
  say "Node.js $(node -v) 安装完成"
}

detect_public_ip() {
  if [ -n "$VPS_FIXED_IP" ]; then
    echo "$VPS_FIXED_IP"
    return
  fi
  for url in https://api.ipify.org https://ifconfig.me/ip https://ipinfo.io/ip; do
    local ip
    if ip="$(curl -fsS -m 10 "$url" 2>/dev/null | tr -d '[:space:]')" && echo "$ip" | grep -qE '^[0-9.]+$'; then
      echo "$ip"
      return
    fi
  done
  echo "unknown"
}

setup_service_user() {
  if id "$GATEWAY_USER" >/dev/null 2>&1; then
    GATEWAY_RUN_USER="$GATEWAY_USER"
    return
  fi
  if useradd --system --home "$GATEWAY_DIR" --shell /usr/sbin/nologin "$GATEWAY_USER" 2>/dev/null; then
    GATEWAY_RUN_USER="$GATEWAY_USER"
  else
    say "无法创建专用系统用户 $GATEWAY_USER，将以 root 运行（安全性下降，建议手动创建）"
  fi
}

write_systemd_unit() {
  local unit="/etc/systemd/system/binance-gateway.service"
  cat > "$unit" <<EOF
[Unit]
Description=Binance Fixed-IP Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GATEWAY_RUN_USER
Group=$GATEWAY_RUN_USER
WorkingDirectory=$GATEWAY_DIR
EnvironmentFile=$GATEWAY_DIR/.env
ExecStart=/usr/bin/env node $GATEWAY_DIR/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

main() {
  require_root
  install_node
  command -v curl >/dev/null 2>&1 || {
    say "正在安装 curl ..."
    if command -v apt-get >/dev/null 2>&1; then apt-get install -y curl
    elif command -v dnf >/dev/null 2>&1; then dnf install -y curl
    elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl
    fi
  }
  command -v openssl >/dev/null 2>&1 || die "缺少 openssl，请先安装"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  mkdir -p "$GATEWAY_DIR"
  cp "$script_dir/server.mjs" "$GATEWAY_DIR/server.mjs"
  chmod +x "$GATEWAY_DIR/server.mjs"

  if [ ! -f "$GATEWAY_DIR/.env" ]; then
    local token
    token="$(openssl rand -hex 24)"
    cat > "$GATEWAY_DIR/.env" <<EOF
BINANCE_GATEWAY_PORT=$GATEWAY_PORT
BINANCE_GATEWAY_TOKEN=$token
BINANCE_GATEWAY_API_KEY=
BINANCE_GATEWAY_API_SECRET=
BINANCE_GATEWAY_TRADING=false
BINANCE_GATEWAY_PUBLIC_IP=$VPS_FIXED_IP
BINANCE_GATEWAY_ALLOWED_CLIENT_IP=
EOF
    chmod 600 "$GATEWAY_DIR/.env"
    say "已生成配置文件：$GATEWAY_DIR/.env"
    say "下一步：编辑该文件，填入币安 API Key/Secret（强烈建议只读权限、禁止提现）"
  else
    say ".env 已存在，保留现有配置（如需更新固定 IP，请编辑 BINANCE_GATEWAY_PUBLIC_IP）"
  fi

  setup_service_user
  chown -R "$GATEWAY_RUN_USER:$GATEWAY_RUN_USER" "$GATEWAY_DIR" 2>/dev/null || true

  if command -v systemctl >/dev/null 2>&1; then
    write_systemd_unit
    systemctl enable binance-gateway >/dev/null 2>&1 || true
    systemctl restart binance-gateway
    sleep 2
    systemctl --no-pager --lines=20 status binance-gateway || true
  else
    say "未检测到 systemd，请手动以后台方式运行：node $GATEWAY_DIR/server.mjs"
  fi

  local public_ip
  public_ip="$(detect_public_ip)"
  say "===== 安装完成 ====="
  say "VPS 出口 IP（币安 API 白名单用）: $public_ip"
  say "网关地址: http://$public_ip:$GATEWAY_PORT"
  say "健康检查: curl -s http://127.0.0.1:$GATEWAY_PORT/health"
  say "状态检查: curl -s -H 'Authorization: Bearer <token>' http://127.0.0.1:$GATEWAY_PORT/api/status"
  say "请到币安 API 管理页把 $public_ip 加入 IP 白名单"
  say "若固定 IP 与探测结果不同，编辑 $GATEWAY_DIR/.env 的 BINANCE_GATEWAY_PUBLIC_IP 后执行 systemctl restart binance-gateway"
  if command -v ufw >/dev/null 2>&1; then
    say "防火墙放行端口：sudo ufw allow $GATEWAY_PORT/tcp"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    say "防火墙放行端口：sudo firewall-cmd --permanent --add-port=$GATEWAY_PORT/tcp && sudo firewall-cmd --reload"
  fi
}

main "$@"
