# TradingView Screener sidecar

这是一个只读、仅回环可访问的 TradingView 补充数据 sidecar。它只监听
`127.0.0.1`，不读取 Binance、Bark、Telegram 或任何交易凭据，也没有下单路径。

## 安装和启动

在服务目录外创建隔离虚拟环境，然后安装固定版本依赖：

```sh
python3 -m venv /path/to/tvscreener-venv
/path/to/tvscreener-venv/bin/python -m pip install -r services/tvscreener/requirements.txt
TVSCREENER_HOST=127.0.0.1 TVSCREENER_PORT=8791 \
  /path/to/tvscreener-venv/bin/python services/tvscreener/server.py
```

`TVSCREENER_HOST` 只能是 `127.0.0.1`；端口默认是 `8791`。sidecar 只有两个接口：

- `GET /healthz`：只返回服务版本、`tvscreener` 版本、最近成功时间和熔断状态；
- `POST /v1/screen`：只接受 Task 1 的 `{assetType, symbols, intervals, fields, sortBy, limit}` 白名单。

请求中的 `filters`、`query` 或其他 TradingView 原始 JSON 会被拒绝，且不会被转发。
实现只使用 `CryptoScreener`、显式字段选择、固定的结果范围和每个请求周期的
`.with_interval()`。它不会使用 `CoinScreener` 或 `FuturesScreener`。

## 读-only 数据边界

响应保留 TradingView 的 `tvSymbol`、交易所和原始符号。无法保守映射为 Binance
USDT 符号的行仍然保留，并使用 `binanceSymbol: null` 和映射警告。缺失、`null`、
`NaN`、正负无穷和不支持的字段都输出 `null` 加 warning，绝不会用 `0` 代替。

TradingView 请求的超时为 10 秒。连续三次失败会打开 30 秒熔断器，期间筛选请求
返回 HTTP 503；健康检查仍然可用。成功请求会重置连续失败计数并更新
`lastSuccessAt`。sidecar 故障只影响补充研究数据，不应阻断 Node 主站。

## 本地检查

```sh
python3 -m pytest services/tvscreener/test_sidecar.py -q
```

真实探测只能使用公开的 TradingView Screener 数据，不得添加 Binance 或其他交易
所凭据；如果网络或依赖不可用，应记录为风险而不是伪造成功结果。
