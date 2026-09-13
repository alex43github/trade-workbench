# MA30 斜率/加速扫描器 V1 — Stage 1 审计

日期：2026-09-14（Asia/Shanghai）

## 结论

现有仓库已经具备可复用的 Binance USDT-M 公共行情访问链路，不需要为 MA30 扫描器建立第二套 Binance 抓取器。

### 可直接复用

- `lib/radar/binance-public.ts`
  - `listUsdtPerpetualSymbols()`：从 `/fapi/v1/exchangeInfo` 获取并过滤 `TRADING + PERPETUAL + USDT`，可作为本扫描器唯一 Universe 定义。
  - `fetchClosedBars(symbol, interval, now, requestedLimit)`：通过 K 线 closeTime 过滤，只保留已完成 K 线；支持 1H 且单次最多 1000 根。
  - 内置 `BinanceRequestPacer({ minIntervalMs: 150 })` 与 retry，可避免新扫描器自行建立另一套节流逻辑。
- `lib/binance-public.ts`
  - VPS 配置 Binance Gateway 时自动走 `127.0.0.1:8788` 对应网关；否则回退 direct public endpoint。
  - 现有代码使用 `cache: no-store`，因此当前仓库没有可直接复用的历史 K 线持久缓存层。
- 现有 ATR 生命周期扫描已通过 `createAtrLifecycleFetchers()` 使用同一 `fetchClosedBars(..., "1h", ..., 1000)` 链路，因此 MA30 扫描器应共享该公共访问层，而不是复制请求实现。

## 数据设计

### Universe

固定为：

`status=TRADING && contractType=PERPETUAL && quoteAsset=USDT`

来源必须是 `listUsdtPerpetualSymbols()`，不读取原强趋势候选池，也不把 ATR/OI/Funding/Taker 结果作为预过滤条件。

### K线

- 只使用已完成 1H K 线。
- V1 初始抓取建议每 symbol 1000 根 1H，以支持：
  - SMA30；
  - Slope3/6/12/20；
  - Slope acceleration；
  - `MA30_NEW_HIGH_BARS` 最长约 970 个可计算 MA30 点。
- 若未来需要 >970 根 MA30 历史新高跨度，再扩展共享 K 线数据层的分页/持久化，不在 scanner 内部重复打 Binance。

## 部署事实源

`handoff.md` 当前记录：

- VPS：`root@139.59.99.126`
- 应用目录：`/opt/trade-workbench`
- 主应用：`trade-workbench.service`
- Binance Gateway：`binance-gateway.service`，本机回环 `127.0.0.1:8788`
- SQLite：`/var/lib/trade-workbench/sqlite/d1.sqlite`
- 现有 systemd maintenance/strategy timer 可作为新增 scanner service/timer 的部署模板，但新扫描器必须保持只读行情侧，不能进入真实交易下单路径。

## 与现有扫描系统隔离

MA30 Scanner V1 的排名和 AI 精选禁止读取：

- OI
- Funding
- Taker
- Top Trader / Global L/S
- 原强趋势模型分数
- ATR 强势池/机器自选排名

允许复用的只有基础设施：Universe 获取、公共 1H K线 fetch、Binance Gateway、throttle/retry、SQLite/Sheet/Bark 的通用持久化或通知组件。

## Stage 2 接口建议

新建纯函数模块，例如 `lib/radar/ma30-slope.ts`，输入为闭合 1H closes，输出：

- `ma30`
- `slope3PctPerHour`
- `slope6PctPerHour`
- `slope12PctPerHour`
- `slope20PctPerHour`
- 当前价格相对 MA30 偏离（后续 C/AI 使用）

公式统一：

`SlopeN = (ln(MA30_now) - ln(MA30_N_bars_ago)) / N`

展示时转换为 `% / 1H bar`。

## Stage 1 状态

- GitHub/仓库访问：OK
- handoff / VPS 地址与应用目录：已恢复
- Universe 定义：已确认可复用
- 闭合 1H K线链路：已确认可复用
- 节流/retry：已确认可复用
- 历史 K线持久缓存：仓库当前未发现；V1 先复用同一公共 fetch 链路，后续如实际全市场耗时/限速不满足再把共享缓存作为基础设施改进，不在 scanner 内重复实现
- 下一阶段：实现 MA30 + Slope3/6/12/20 纯计算引擎及单元测试
