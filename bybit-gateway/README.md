# Bybit V5 gateway

This process is a private, server-side adapter for Bybit USDT linear perpetuals. It accepts requests only from the local Trade Workbench service and never exposes API credentials to the browser, Telegram, database, or logs.

## Safety defaults

- Bind only to `127.0.0.1:8789`; do not add this port to Caddy, UFW, or a cloud security group.
- Keep `BYBIT_GATEWAY_TRADING=false`. In this read-only state, account, position, order, and market reads are available while all order mutations are rejected.
- Use a token distinct from the Binance gateway token. Keep it in `/etc/trade-workbench/workbench.env`, owned by `root:root` with mode `0600`.
- Use a dedicated Bybit API key with withdrawals and transfers disabled. Restrict it to the VPS fixed outbound IP before enabling any mutation.
- The upstream must be HTTPS (`https://api.bybit.com`); do not point it to a public proxy or browser-controlled URL.

## Installation

Set the `BYBIT_GATEWAY_*` values in the root-owned environment file, keep the trading flag false, then install `deploy/bybit-gateway.service`. The service unit binds loopback only and reads no credentials from command arguments.

Verify only the local health endpoint after installation:

```bash
curl --fail --silent http://127.0.0.1:8789/health
```

Before considering trading enablement, independently verify account permissions, fixed-IP allowlisting, service ownership, and the final confirmation workflows. No deployment instruction in this repository submits an order.
