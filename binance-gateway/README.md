# binance-gateway — 币安固定 IP 网关

零依赖 Node 服务。部署在有固定 IP 的 VPS 上，交易网站（Cloudflare Workers）通过它访问
Binance Futures 私有接口，绕开 Workers 出口 IP 被币安 403 的问题。

## 架构

```
浏览器 ──▶ 网站(Cloudflare) ──▶ 本网关(VPS 固定 IP) ──▶ fapi.binance.com
                                 │
                                 └─ 持有 Binance API Key/Secret，负责签名
```

## 一键安装（VPS）

1. 把整个 `binance-gateway/` 目录传到 VPS（如 `/root/binance-gateway`）。
2. 编辑 `install.sh` 顶部的 `VPS_FIXED_IP` 为你的固定 IP（留空会自动探测）。
3. 执行：

```bash
cd /root/binance-gateway
chmod +x install.sh
sudo bash install.sh
```

脚本会安装 Node.js >= 20、生成 `/opt/binance-gateway/.env`（含随机 token）、
创建 systemd 服务并启动。

4. 编辑密钥：

```bash
sudo nano /opt/binance-gateway/.env
```

填入 `BINANCE_GATEWAY_API_KEY` / `BINANCE_GATEWAY_API_SECRET`（币安 Futures API，
强烈建议**只读 + 禁止提现**），如修改了 token 请同步修改网站侧环境变量。

5. 重启并验证：

```bash
sudo systemctl restart binance-gateway
curl -s http://127.0.0.1:8788/health
curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:8788/api/status
```

`api/status` 里的 `outboundIp` 就是币安看到的出口 IP，把它加到币安 API 的 IP 白名单。

## 网站侧配置（环境变量）

```
BINANCE_GATEWAY_BASE_URL=http://你的VPS固定IP:8788
BINANCE_GATEWAY_TOKEN=与网关 .env 相同
```

配置后，网站的账户/连接接口优先走网关。

## 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 健康检查 |
| GET | `/api/status` | 是 | 出口 IP、币安可达性、时间偏移 |
| GET/POST | `/api/binance/<fapi路径>` | 是 | 转发到币安 Futures，私有路径自动签名 |

## 安全说明

- 默认只读：`BINANCE_GATEWAY_TRADING=false` 时，下单/杠杆/保证金路径一律 403。
- token 至少 16 位；缺失时服务拒绝启动。
- 建议 `BINANCE_GATEWAY_ALLOWED_CLIENT_IP` 只放行 Cloudflare Workers 出口段或你的 IP。
- 日志只记录方法/路径/状态码/耗时，不记录签名、token、密钥。
- 开真实交易前，请先只读跑通，再在非生产/极小资金环境验证。

## 常见问题

- **转发 403**：Cloudflare Workers 出口被币安拒绝 → 配置网关后仍 403，检查网关 `/api/status`
  的 `outboundIp` 是否已加入币安白名单。
- **签名报 -1021**：网关会自动重新同步时间并重试；持续出现说明 VPS 时钟偏差过大，
  执行 `timedatectl set-ntp true`。
- **私接口 400 missing signature**：确认 `.env` 中 `BINANCE_GATEWAY_API_KEY` /
  `BINANCE_GATEWAY_API_SECRET` 已填且重启过服务。
