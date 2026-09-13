# VPS ↔ GitHub SHA-256 源码对账（2026-09-13）

## Verdict

`RECONCILIATION_REQUIRED`

`SOURCE_OF_TRUTH_READY=NO`

GitHub 基线：`alex43github/trade-workbench` / `source-baseline/20260913-current` / `7d8f6f83ebf9be8e13b52884f9556c20158108e2`。

生产实际使用的安全源码并未全部与该 commit 字节一致；Binance gateway 的退出保护、radar cadence/trend 依赖和多项 Workbench 交易/保护代码均发生漂移。Bybit service 还引用了基线不存在的 `bybit-gateway/*` 源码。

## 方法与边界

- 唯一 allowlist 是该 commit 中的 `SOURCE_BASELINE.sha256` / `SOURCE_BASELINE.json`。
- 对 allowlist 路径只执行精确 `test -f`、`sha256sum`（以及 unit 的 `stat`）；未在 VPS 上执行递归 `find/grep/rg/du/tar`。
- `.env*`（`.env.example` 除外）、数据库、日志、缓存、state、`.next`、`.vinext`、`node_modules`、证书和密钥均未读取。
- 所有 hash 不一致文件先只记录 hash。仅对已确认安全且关键的 7 个源码做受控单文件 diff 摘要。

## 统计

### Manifest 全量（612 条，含测试/文档安全源码）

| 分类 | 数量 |
|---|---:|
| MATCH | 493 |
| VPS_DIFFERS_FROM_GITHUB | 83 |
| GITHUB_SOURCE_NOT_ON_VPS | 36 |
| EXPECTED_RUNTIME_ONLY（manifest 内） | 0 |
| UNKNOWN | 0 |

### 生产运行时/部署清单（315 条，排除测试、文档和 runtime-only 模式）

| 分类 | 数量 |
|---|---:|
| MATCH | 246 |
| VPS_DIFFERS_FROM_GITHUB | 61 |
| GITHUB_SOURCE_NOT_ON_VPS | 8 |
| EXPECTED_RUNTIME_ONLY | 1（仅记录 EnvironmentFile 路径，未读值）|
| UNKNOWN | 0 |

## PRODUCTION_FILE_INVENTORY

| Service/unit | WorkingDirectory | ExecStart / entrypoint | Source files verified |
|---|---|---|---|
| `trade-workbench.service` | `/opt/trade-workbench` | `/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000`（`vinext start`） | `app/**`、`lib/**`、`db/**`、`worker/**`、package/build 配置；manifest 清单逐路径核对 |
| `squeeze-radar.service` | `/opt/trade-workbench` | `/usr/bin/node /opt/trade-workbench/services/structure-radar/main.ts` | `main.ts` 及其 import graph：bar-cache、bark、binance-public、binance-readonly-account、config、http-server、orchestrator、radar-repository、runtime、scanner、websocket-feed、platform-reclaim、trendline-breakout、position-monitor、squeeze-radar、radar-cadence、trend-radar |
| `binance-gateway.service` | `/opt/trade-workbench` | `/usr/bin/node /opt/trade-workbench/binance-gateway/server.mjs` | `server.mjs`、`order-policy.mjs`、`signing.mjs`、`exit-lock.mjs` |
| `bybit-gateway.service` | `/opt/trade-workbench` | `/usr/bin/node /opt/trade-workbench/bybit-gateway/server.mjs` | `bybit-gateway/server.mjs`、`order-policy.mjs`、`signing.mjs`（均为 VPS-only candidate，基线无对应路径） |
| `trade-workbench-maintenance.service` + `.timer` | `/opt/trade-workbench` | `services/workbench/maintenance-scheduler.mjs` | `maintenance-scheduler.mjs`、`maintenance-schedule.mjs` |
| `trade-workbench-protection-strategy.service` + `.timer` | `/opt/trade-workbench` | `services/workbench/protection-strategy-scheduler.mjs` | scheduler 本身；通过 loopback 调用 Workbench protection endpoint |
| `trade-workbench-paper-strategy.service` + `.timer` | `/opt/trade-workbench` | paper scheduler；当前 timer inactive | 已记录 unit 状态，未视为当前 active production path |

所有上述 unit 的 `EnvironmentFiles` 均仅记录路径 `/etc/trade-workbench/workbench.env`，没有读取 value。

## 关键差异（SHA-256）

| Path | VPS SHA256 | GitHub SHA256 | Classification | Which side appears newer | Action needed |
|---|---|---|---|---|---|
| `binance-gateway/order-policy.mjs` | `dc67c3a6a51a824cf4e8d7e550e6d8937a9456808a92737b30094acb700b046e` | `2157abf98ec7ae7d0ee3a97fc6de895006a5f13314d6deb947f859337e14cd96` | VPS_DIFFERS_FROM_GITHUB | GitHub（受控 diff 显示含权威仓位/openOrders/lock 逻辑，VPS 为旧策略） | 生产 gateway 未包含基线 T02 安全实现 |
| `binance-gateway/server.mjs` | `ffeedcc2156d3f2a5218c6d334e14fc66b66d8de152197ec727f5e83dd147bbd` | `891c6d81d0ac43543be6c8c5b1a15c98eeee9d8066ec937ec210dfdb3eb8b693` | VPS_DIFFERS_FROM_GITHUB | GitHub（VPS 未 import/执行 EXIT_ONLY lock、double-read、reconciliation） | 需先完成源码对齐再部署 |
| `services/structure-radar/main.ts` | `6efb163bf7b5f820bbef4bf2d5bdba9b1f18f64cad2c4c617ed92bf3ab5206dd` | `99e8a29462f81a0fb9a3d2710c00e279fa66a58785325ea0ee28551ecd046994` | VPS_DIFFERS_FROM_GITHUB | GitHub（新增 cadence/trend graph） | VPS 缺少对应依赖 |
| `services/structure-radar/radar-cadence.ts` | — | `24f904cececfa8a330c1d62c176a8f64d1e0221bb36be740eeb43f0c1de2dcbf` | GITHUB_SOURCE_NOT_ON_VPS | GitHub only | `main.ts` import 的生产依赖缺失 |
| `services/structure-radar/trend-radar.ts` | — | `3ac4e84b1088b3e077fcb1a2a280c7af0e5426f8af27272886ae4ed434d7dfde` | GITHUB_SOURCE_NOT_ON_VPS | GitHub only | `main.ts` import 的生产依赖缺失 |
| `services/structure-radar/squeeze-radar.ts` | `38f2728c55821eca56f59ede761c7d6f173471b3868112390ff67801f6af86a3` | `654173497bf8620cd157772d84e3b1d09a45c4039e14710c0e099df95599a43d` | VPS_DIFFERS_FROM_GITHUB | GitHub（阶段/去重逻辑更新） | 需对齐 |
| `services/structure-radar/runtime.ts` | `b3f26d4be736cf1538b35515efa5e252102a0ca63bbb3086d07f378e486c8a0c` | `75de5891b5145bbf50eee61d57b5d1792b734202d992d6a5cfe8f0bc73de7af4` | VPS_DIFFERS_FROM_GITHUB | GitHub（cadence/staleness health 更新） | 需对齐 |
| `services/structure-radar/scanner.ts` | `e6a352cdf5e4636a6c2165e8a08451aafaa409afb8e992c0c05d4184fb8929e7` | `286c161559740e1c1d2a13301c49d74fa044d089331557b6019509c3fb5d08f` | VPS_DIFFERS_FROM_GITHUB | UNKNOWN（仅 hash） | 受控 diff |
| `services/structure-radar/radar-repository.ts` | `69b33bda93d33ec5242ddda0c39ff55671ac2a76f4eef5c15d23a8860141e7a5` | `0fb5172585f48dbdef9057d9003a9d59f896c5f0adf44c8dd1ce976225090c6a` | VPS_DIFFERS_FROM_GITHUB | GitHub（新增 trend persistence） | 需对齐 |
| `services/workbench/maintenance-scheduler.mjs` | `dfeb8834a4fe633ddf5e0c1f32fd76757d126926fe362ef0bf8bdbc401ca57e6` | `39c2c707c4746e3021fe7b01723e69bfac2aaa1de43c3456622e7debb7c1e7bb` | VPS_DIFFERS_FROM_GITHUB | GitHub（ATR 独立 dispatch/skip header） | 需对齐 |
| `services/workbench/protection-strategy-scheduler.mjs` | `bf8a12b7557a36bd70f5f850381e9c7ee8451ed4197b4dacfd6d779db4eac67a` | `020fa71ebe46dcc4569cc33c809dbf5a2027e72f6039c90a2e2a453a6af07ea9` | VPS_DIFFERS_FROM_GITHUB | GitHub（state/error safety） | 需对齐 |
| `lib/trade/live-exit-ledger.ts` | — | `6a346d103baca9ac61bdb38bf280ffbff8d3562aae355f8f5d28054a63af6f94` | GITHUB_SOURCE_NOT_ON_VPS | GitHub only | 基线退出幂等依赖未部署 |
| `lib/trade/live-exit-reconciliation.ts` | — | `ec57d447a1e65e85acc53db6002c802d9bb2810bcf63d18348b11599949eb39a` | GITHUB_SOURCE_NOT_ON_VPS | GitHub only | 同上 |
| `lib/trade/live-manual-close-idempotency.ts` | — | `bbc758f87ce6fb9a320946dfb15ff3959d58729ca5e0f993456a6b8bc654f665` | GITHUB_SOURCE_NOT_ON_VPS | GitHub only | 同上 |

表中 hash 均为完整 64 位 SHA-256；未读取正文。

### 其余 53 个生产差异路径

`app/api/account/route.ts`、`app/api/advisory/maintenance/route.ts`、`app/api/radar/atr-band/route.ts`、`app/api/telegram/webhook/[path]/route.ts`、`app/api/trade/live-status/route.ts`、`app/api/trade/live-strategies/[id]/cancel/route.ts`、`app/api/trade/live-strategies/route.ts`、`app/api/trade/manual-protection/route.ts`、`app/api/trade/positions/close/route.ts`、`app/api/trade/protection-status/route.ts`、`app/api/watchlist/route.ts`、`app/trade/*`（9 个）、`db/ensure.ts`、`deploy/workbench.env.example`、`lib/radar/*`（2 个）、`lib/telegram/*`（3 个）、`lib/trade/*`（22 个）、`lib/watchlist.ts`、`services/structure-radar/http-server.ts`、`services/structure-radar/radar-repository.ts`、`services/structure-radar/runtime.ts`、`services/structure-radar/scanner.ts`、`services/workbench/maintenance-schedule.mjs`、`services/workbench/maintenance-scheduler.mjs`、`services/workbench/protection-strategy-scheduler.mjs`。这些路径均为安全源码；未在本轮读取正文，方向记为 `UNKNOWN`，后续需逐文件受控 diff。

## VPS-only candidates（由明确 unit/运行图引用触发）

1. `bybit-gateway/server.mjs` — VPS SHA-256 `cf5b5161432fb7474f0e064633ac5486acf5e497b475629726099f8b5eb6c6b2`。
2. `bybit-gateway/order-policy.mjs` — VPS SHA-256 `1068d3624154390512562389d8ab1946256ae4eceaf24f973b9bc6c53a5c3e1a`。
3. `bybit-gateway/signing.mjs` — VPS SHA-256 `6f3d9db75e4326548701124d7bfde1a555c23e884535791876487925dd2dd7e5`。
4. `/etc/systemd/system/bybit-gateway.service` — unit 明确引用上述入口，但基线没有 `deploy/bybit-gateway.service`。

这些 candidate 仅做 hash/stat，未读取正文、未复制、未上传、未修改 baseline。

## textual diff 摘要（受控单文件）

- `binance-gateway/order-policy.mjs`：VPS 是旧的 intent/命名启发式放行；GitHub 版本加入 authoritative position/openOrders、remaining quantity reservation、冲突 fail-closed、clamp 和 EXIT_ONLY 语义校验。
- `binance-gateway/server.mjs`：VPS 未 import `exit-lock.mjs`，直接调用旧 validator；GitHub 版本包含 same-client reconciliation、双次 position read、open-order reservation 和进程内 per-position lock。
- `services/structure-radar/main.ts`：VPS 删除 trend/cadence import 与记录逻辑；GitHub 版本恢复两条生产依赖。
- `services/structure-radar/squeeze-radar.ts`：VPS 缺少一小时去重并缩减状态/通知阶段；GitHub 版本包含去重与完整阶段处理。
- `services/structure-radar/runtime.ts`：VPS 缺少 cadence/staleness health 逻辑；GitHub 版本增加 stale 检查。
- `services/structure-radar/radar-repository.ts`：VPS 无 trend persistence；GitHub 版本持久化 trend records。
- `services/workbench/maintenance-scheduler.mjs` / `protection-strategy-scheduler.mjs`：GitHub 版本增加 ATR 独立 dispatch、skip header、严格回包校验和受限 state/error 持久化。

## 敏感信息确认

- secret value、API key、token、private key：未读取。
- `/etc/trade-workbench/workbench.env`：只记录路径，未 `cat`。
- SQLite/D1、日志、缓存、`.next`、`.vinext`、`node_modules`、runtime state：未读取、未纳入 hash 对账。
- Git staging：本任务未 staging；未修改 VPS。

## 结论与下一步边界

当前生产不是该 GitHub commit 的完整 byte-for-byte 实例，因此唯一可信结论是 `RECONCILIATION_REQUIRED` / `SOURCE_OF_TRUTH_READY=NO`。本轮没有创建 reconciliation 分支、没有复制 VPS 文件、没有 build/deploy、没有 restart、没有订单或交易动作。下一步若需补齐，必须先对上述 VPS-only Bybit 源码做单文件 secret scan/diff，再另行授权创建新 reconciliation 分支。
