# VPS deployment package

This package deploys one private Trade Workbench VPS. Caddy is the only public listener. The web app listens on `127.0.0.1:3000`; the Binance gateway listens on `127.0.0.1:8788`; neither port is proxied or opened by the firewall. The gateway is permanently configured for read-only operation with `BINANCE_GATEWAY_TRADING=false`.

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

Then send `/start` to the bot. It accepts only the configured numeric user ID in a private chat; all other messages receive no authorization. The initial Telegram test covers the menu, PAPER/LIVE selection shell, and read-only position/open-order query. It does not enable or send a real order.

Install the units and Caddy configuration, replacing the Caddy hostname first:

```bash
sudo install -m 0644 deploy/{trade-workbench,binance-gateway,trade-workbench-maintenance,trade-workbench-paper-strategy}.service /etc/systemd/system/
sudo install -m 0644 deploy/{trade-workbench-maintenance,trade-workbench-paper-strategy}.timer /etc/systemd/system/
sudo install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now binance-gateway.service trade-workbench.service trade-workbench-maintenance.timer trade-workbench-paper-strategy.timer caddy.service
sudo systemctl status binance-gateway.service trade-workbench.service trade-workbench-maintenance.timer trade-workbench-paper-strategy.timer caddy.service
```

Verify loopback boundaries and public HTTPS:

```bash
sudo ss -ltnp '( sport = :3000 or sport = :8788 )'
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:8788/health
curl --fail https://workbench.example.com/
```

The first `ss` command must show `127.0.0.1:3000` and `127.0.0.1:8788`, never `0.0.0.0` or the VPS public IP. Caddy must be the sole public HTTP/S listener.

## Optional TradingView Screener sidecar

The `tvscreener` sidecar is an optional, read-only research supplement. It listens
only on `127.0.0.1:8791`; it is not a public service and must not be added to
Caddy or the firewall. Binance Futures remains the source of truth for execution,
closed-candle state, positions, open orders, MA/ATR values, and all trading
decisions. If the sidecar is stopped or unavailable, the site continues to work
and the UI labels the supplement as unavailable; an old successful response is
shown as stale after its freshness window.

Install its isolated Python environment outside the release files, using the
exact versions in `services/tvscreener/requirements.txt`:

```bash
sudo install -d -o trade-workbench -g trade-workbench -m 0750 /var/lib/trade-workbench/tvscreener-venv
sudo python3 -m venv /var/lib/trade-workbench/tvscreener-venv
sudo /var/lib/trade-workbench/tvscreener-venv/bin/python -m pip install --requirement /opt/trade-workbench/services/tvscreener/requirements.txt
sudo install -m 0644 /opt/trade-workbench/deploy/tvscreener.service /etc/systemd/system/tvscreener.service
sudo systemctl daemon-reload
sudo systemctl enable --now tvscreener.service
sudo systemctl status tvscreener.service --no-pager
```

Check the loopback boundary and health without exposing the service:

```bash
sudo ss -ltnp '( sport = :8791 )'
curl --fail --silent http://127.0.0.1:8791/healthz
curl --fail --silent -X POST http://127.0.0.1:8791/v1/screen \
  -H 'content-type: application/json' \
  --data '{"assetType":"crypto","symbols":["BINANCE:BTCUSDT"],"intervals":["60"],"fields":["PRICE"],"sortBy":"VOLUME","limit":1}'
```

The first command must show `127.0.0.1:8791`, never `0.0.0.0` or the VPS public
address. The Node application reads `TVSCREENER_BASE_URL` server-side; browsers
never receive the sidecar address. The sidecar does not read the main
`workbench.env`, Binance credentials, Telegram tokens, or Bark keys. To disable
the supplement, stop and disable `tvscreener.service`; no order, strategy,
position, open-order, or live-mode path depends on it.

## PAPER strategy scheduler

`trade-workbench-paper-strategy.timer` invokes the token-protected internal route once a minute through `http://127.0.0.1:3000`. It has no listener of its own. It evaluates only PAPER strategies from public Binance Futures market data, so it keeps refreshing eligible limit entries, simulating fills, applying closed-candle guards, expiring seven-day plans, and issuing configured Bark notifications while every browser is closed. It never sends a real order or uses Binance private credentials.

Verify it without exposing the scheduler token:

```bash
sudo systemctl list-timers trade-workbench-paper-strategy.timer
sudo systemctl start trade-workbench-paper-strategy.service
sudo systemctl status trade-workbench-paper-strategy.service --no-pager
sudo cat /var/lib/trade-workbench/paper-strategy-scheduler-state.json
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
