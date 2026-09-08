# binance-gateway — 币安固定 IP 网关

零依赖 Node 服务。与交易网站部署在同一台、带固定公网 IP 的 VPS 上；网站仅通过本机回环地址访问它，
由网关统一访问 Binance Futures 的公开与只读私有接口。

## 架构

```
浏览器 ──▶ HTTPS 网站 ──▶ 本机网关(127.0.0.1:8788) ──▶ fapi.binance.com
                                      │                    ↑
                                      └─ 仅 VPS 固定 IP 出口 ┘
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
BINANCE_GATEWAY_BASE_URL=http://127.0.0.1:8788
BINANCE_GATEWAY_TOKEN=与网关 .env 相同
```

网站和网关必须在同一台 VPS；**不要**把 `8788` 暴露到公网，也不要填写 VPS 公网 IP。配置后，
账户、币种搜索、K 线、雷达扫描和连接诊断都会优先走网关。只有 VPS 的公网 IPv4 需要添加到 Binance API 白名单。

## 手机推送通知（Bark，可选）

网关服务上线/下线时通过 [Bark](https://github.com/Finb/Bark) 推送到手机，不在电脑旁也能
第一时间知道 VPS/网关状态变化。

1. iPhone 安装 Bark App，打开后复制你的推送密钥（形如 `xxxxxxxxxxxxxxxx`）。
2. 在 VPS 上编辑 `/opt/binance-gateway/.env`：

   ```bash
   sudo nano /opt/binance-gateway/.env
   ```

   填入：

   ```bash
   BARK_API_KEY=你的推送密钥
   # 自建 Bark 服务器时才需要改，默认官方 https://api.day.app
   BARK_BASE_URL=https://api.day.app
   ```

3. 重启服务验证（会先收到一条"下线"，再收到一条"上线"）：

   ```bash
   sudo systemctl restart binance-gateway
   ```

工作原理：

- `notify.sh` 挂在 systemd 的 `ExecStartPost` / `ExecStopPost`，服务正常启动/停止时立即推送。
- 安装脚本会额外启用一个每 5 分钟的健康看门狗（`binance-gateway-watchdog.timer`），
  node 进程假死、开机后服务启动失败等 ExecStopPost 触发不到的场景，也会在状态翻转时推送。
- **整机断电**时 VPS 本身无法发出"下线"通知（机器都没了，谁也发不出去）；恢复供电开机后
  会自动推送"上线"。如需断电即时告警，需要额外的外部监控（另一台机器定时访问
  `http://VPS_IP:8788/health` 并推送）。
- 未配置 `BARK_API_KEY` 时所有通知静默跳过；Bark 需要 VPS 能访问外网 HTTPS 443。

## 端点

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 健康检查 |
| GET | `/api/status` | 是 | 出口 IP、币安可达性、时间偏移 |
| GET/POST | `/api/binance/<fapi路径>` | 是 | 转发到币安 Futures，私有路径自动签名 |

## 安全说明

- 默认只读：`BINANCE_GATEWAY_TRADING=false` 时，下单/杠杆/保证金路径一律 403。
- token 至少 16 位；缺失时服务拒绝启动。
- 同机部署时 `BINANCE_GATEWAY_ALLOWED_CLIENT_IP` 留空即可；服务仅监听回环地址，公网防火墙无需开放 8788。
- 日志只记录方法/路径/状态码/耗时，不记录签名、token、密钥。
- 开真实交易前，请先只读跑通，再在非生产/极小资金环境验证。

## 常见问题

- **转发 403**：Cloudflare Workers 出口被币安拒绝 → 配置网关后仍 403，检查网关 `/api/status`
  的 `outboundIp` 是否已加入币安白名单。
- **签名报 -1021**：网关会自动重新同步时间并重试；持续出现说明 VPS 时钟偏差过大，
  执行 `timedatectl set-ntp true`。
- **私接口 400 missing signature**：确认 `.env` 中 `BINANCE_GATEWAY_API_KEY` /
  `BINANCE_GATEWAY_API_SECRET` 已填且重启过服务。
- **私接口 `Signature for this request is not valid`**：签名必须覆盖完整的查询参数和
  `POST` 表单参数。当前网关会把 `timestamp`、`recvWindow`、`signature` 追加到请求体后再转发，
  不要在网站侧自行生成或改写签名。
