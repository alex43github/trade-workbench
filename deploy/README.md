# VPS deployment package

This package deploys one private Trade Workbench VPS. Caddy is the only public listener. The web app listens on `127.0.0.1:3000`; Binance and Bybit gateways listen on loopback only and are never proxied or opened by the firewall. Each exchange requires `WORKBENCH_LIVE_TRADING_ENABLED=true` plus its own gateway trading switch; all switches remain false by default.

## Layout

- Release files: `/opt/trade-workbench`
- Persistent local SQLite, radar state, and backups: `/var/lib/trade-workbench`
- Root-owned secrets: `/etc/trade-workbench/workbench.env`
- Caddy virtual host: `/etc/caddy/Caddyfile`

## Install

On Ubuntu/Debian, install the host prerequisites: Node.js 22, Caddy, SQLite, and UFW. Copy a tested release (including `node_modules` or run `npm ci --omit=dev` on the VPS) to `/opt/trade-workbench` and ensure it is owned by `root:root` and not writable by `trade-workbench`.

Create the non-login service account, persistent directories, and secret file:

```bash
cd /opt/trade-workbench
sudo bash deploy/install-env.sh
sudoedit /etc/trade-workbench/workbench.env
```

Replace every `replace-with-...` value with an independent `openssl rand -hex 32` result. Keep `BINANCE_GATEWAY_TRADING=false`. If account reads are needed, use Binance API credentials with read-only permissions, withdrawals/transfers disabled, and the VPS fixed outbound IP allowlisted. Do not add these credentials to Git, shell history, or the application database.

## Telegram private bot

Telegram requires a trusted HTTPS domain. Before enabling it, point a domain A record at the VPS, replace `workbench.example.com` in `deploy/Caddyfile`, and confirm `https://your-domain/` works. A bare IP is suitable only for SSH and deployment diagnostics, not login or Telegram Webhooks.

Create the bot through BotFather, then put its token only in `/etc/trade-workbench/workbench.env`. Set `TELEGRAM_ALLOWED_USER_ID` to your numeric Telegram user ID (not `@username`) and generate distinct random `TELEGRAM_WEBHOOK_PATH` and `TELEGRAM_WEBHOOK_SECRET` values. Keep `BINANCE_GATEWAY_TRADING=false` for the initial test.

After restarting Caddy and `trade-workbench.service`, register the webhook from the VPS. Substitute values locally from the root-owned environment file; do not paste a token into a shell history or this document:

```bash
sudo systemctl restart trade-workbench.service caddy.service
sudo -i
set -a; . /etc/trade-workbench/workbench.env; set +a
curl --fail --silent --show-error \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://your-domain/api/telegram/webhook/${TELEGRAM_WEBHOOK_PATH}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode "allowed_updates=[\"message\",\"callback_query\"]"
```

Then send `/start` to the bot. It accepts only the configured numeric user ID in a private chat; all other messages receive no authorization. The Telegram menu exposes only live trading, and every live order still requires the configured server-side switches plus the final confirmation in the bot or website.

Install the units and Caddy configuration, replacing the Caddy hostname first:

```bash
sudo install -m 0644 deploy/{trade-workbench,binance-gateway,trade-workbench-maintenance,trade-workbench-paper-strategy,trade-workbench-protection-strategy}.service /etc/systemd/system/
sudo install -m 0644 deploy/{trade-workbench-maintenance,trade-workbench-paper-strategy,trade-workbench-protection-strategy}.timer /etc/systemd/system/
sudo install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now binance-gateway.service trade-workbench.service trade-workbench-maintenance.timer trade-workbench-protection-strategy.timer caddy.service
sudo systemctl disable --now trade-workbench-paper-strategy.timer
sudo systemctl status binance-gateway.service trade-workbench.service trade-workbench-maintenance.timer trade-workbench-protection-strategy.timer caddy.service
```

Verify loopback boundaries and public HTTPS:

```bash
sudo ss -ltnp '( sport = :3000 or sport = :8788 )'
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:8788/health
curl --fail https://workbench.example.com/
```

The first `ss` command must show `127.0.0.1:3000` and `127.0.0.1:8788`, never `0.0.0.0` or the VPS public IP. Caddy must be the sole public HTTP/S listener.

TradingView Screener 已从生产运行时移除。雷达、筛选、MA/ATR、持仓和交易状态全部使用 Binance 数据；交易页保留 TradingView 风格图表组件，但不再调用 TradingView Screener。

## Retired PAPER strategy scheduler

PAPER simulation is retired on this deployment. Keep `trade-workbench-paper-strategy.timer` disabled; it is retained only to make an older release reversible and must not be enabled for normal operation. It is independent from real strategy submission and the live protection scheduler.

## Live protection strategy scheduler

`trade-workbench-protection-strategy.timer` invokes the token-protected internal route once a minute through loopback. It evaluates active MA protection strategies using closed Binance Futures candles and, only after the server-side live switches and source-quantity reconciliation pass, submits source-bound reduce-only market exits through the fixed-IP gateway. Fixed-price protection strategies are submitted at the user confirmation step. Unknown or partial gateway results are recorded for reconciliation and are never retried automatically.

Verify the live protection scheduler without exposing the scheduler token:

```bash
sudo systemctl list-timers trade-workbench-protection-strategy.timer
sudo systemctl status trade-workbench-protection-strategy.service --no-pager
```

For production Bark, set either `BARK_BASE_URL` or `BARK_API_KEY` only in `/etc/trade-workbench/workbench.env` (root-owned, mode `0600`), then restart the timer. 浏览器不保存 Bark 密钥；网页只显示是否已配置，避免将通知凭据写入策略数据库或返回给客户端。

## Firewall

Permit only SSH and Caddy’s HTTPS traffic; do not open `3000`, `8788`, or `8790`:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status numbered
```

Restrict SSH to an administrator IP or VPN at the VPS provider firewall when possible. Keep the provider firewall aligned with UFW. Do not add an inbound Binance rule: the gateway makes outbound HTTPS requests only.

## SQLite backup and restore

The database is a local persistent volume at `/var/lib/trade-workbench/sqlite/d1.sqlite`, outside `/opt/trade-workbench`. Back up with SQLite’s online backup command, then copy the resulting file to encrypted off-host storage:

```bash
sudo -u trade-workbench /opt/trade-workbench/deploy/backup-sqlite.sh
sudo find /var/lib/trade-workbench/backups -type f -name 'd1-*.sqlite' -mtime +14 -delete
```

Before restoring, stop the app so no connection can recreate WAL files during the replacement:

```bash
sudo systemctl stop trade-workbench.service
sudo /opt/trade-workbench/deploy/restore-sqlite.sh /var/lib/trade-workbench/backups/d1-YYYYMMDDTHHMMSSZ.sqlite
sudo systemctl start trade-workbench.service
```

The restore script verifies `PRAGMA integrity_check` before replacing the database. Test restores on a separate VPS before relying on a backup.
