# Strong Trend + Squeeze Focus Radar — Design

Date: 2026-09-13
Canonical working branch: `chatgpt/source-of-truth-20260913`
Base source-of-truth reconciliation: 29 prior `MERGE_REQUIRED` items resolved with explicit canonical decisions; production deployment is still separate.

## Goal

Add one coherent monitoring subsystem to the existing Structure Radar and website so that the system can:

1. discover strong-trend and squeeze candidates from the full Binance USDT-M perpetual universe on the 1H cycle;
2. promote high-value symbols into a focused short-timeframe pool;
3. continuously monitor that focused pool on 5m / 15m / 1H for re-entry, second-wave, MA30 reclaim/loss, re-ignition and model-driven BUY / ADD opportunities;
4. expose current state clearly on the website;
5. send deduplicated Bark notifications with explicit classification, direction, stage and suggested action;
6. never place orders automatically.

## Scope and non-goals

In scope:
- Binance USDT-M perpetual market discovery;
- strong-trend and squeeze/short-squeeze/long-squeeze classification;
- focused pool management;
- 5m / 15m / 1H short-cycle monitoring;
- MA30 structural event alerts;
- model-driven BUY / ADD / WAIT / NO_CHASE / INVALIDATED decisions;
- Bark notifications;
- website radar status and drill-through to `/trade?symbol=...`;
- restart-safe dedupe and sticky state;
- health/status telemetry.

Out of scope for this feature:
- automatic exchange order placement;
- weakening any existing EXIT_ONLY / manual-close idempotency / ENTRY-preflight / fail-closed controls;
- replacing the production order gateway;
- making every MA30 cross an automatic buy signal;
- scanning all contracts every 5 minutes with full derivatives depth.

`realOrderRouteEnabled` remains false for the radar subsystem.

## Architecture

Use the existing `services/structure-radar` sidecar as the single scanner/runtime owner.

Do not create a second independent scheduler or duplicate Bark path.

The architecture has two layers:

### 1. Full-market 1H discovery layer

Once per hour, after a closed 1H candle is available:

- scan the full Binance USDT-M perpetual universe;
- evaluate strong-trend state using 1H with 4H context;
- evaluate squeeze state using price structure plus available derivatives context;
- persist state and event timestamps;
- produce two separate hourly Bark summaries:
  - `每小时强趋势雷达`
  - `每小时潜在轧空/轧多雷达`

Each candidate must state:
- symbol;
- classification: `STRONG_TREND`, `SHORT_SQUEEZE`, `LONG_SQUEEZE`, or combined;
- trade direction/bias;
- current stage;
- score / confidence tier;
- whether current action is `BUY_ALLOWED`, `WAIT_RESET`, `NO_CHASE`, `WATCH_ONLY`, or `INVALIDATED`;
- why it is in the list;
- scan/model version and scan timestamp.

### 2. Focus Pool short-timeframe layer

The Focus Pool is the union of:

1. 1H strong-trend / squeeze candidates;
2. sticky second-wave candidates retained for 72 hours after meaningful detection/actionable state;
3. current account positions;
4. user watchlist symbols.

Position/watchlist membership means “must monitor”; it does not imply bullishness or model approval.

For each Focus Pool symbol, continuously maintain 5m / 15m / 1H closed-bar state.

The short-timeframe layer is event-driven from closed Binance kline websocket events wherever possible. Full derivative revalidation should be throttled and focused on symbols whose structure warrants it.

## Focus Pool record

Persist a record per symbol containing at minimum:

- `symbol`
- `sources[]`: `HOURLY_TREND`, `HOURLY_SQUEEZE`, `STICKY_72H`, `POSITION`, `WATCHLIST`
- `bias`: `LONG`, `SHORT`, `NEUTRAL`, `UNKNOWN`
- `classification[]`
- `trendStage`
- `squeezeStage`
- `stickyUntil`
- `firstDetectedAt`
- `lastQualifiedAt`
- `lastEventAt`
- 5m MA30 relation
- 15m MA30 relation
- 1H MA30 relation
- last model decision
- last decision reason codes
- last Bark event keys

A symbol leaves the Focus Pool only when all sources expire/disappear and sticky retention has ended.

## MA30 structural event rules

Use only closed candles. No intrabar MA30 alert may be emitted.

For LONG-bias Focus Pool symbols:

- `15M_MA30_RECLAIM`: previous closed 15m candle closed at/below MA30, current closed 15m candle closes above MA30;
- `15M_MA30_LOSS`: previous closed 15m candle closed at/above MA30, current closed 15m candle closes below MA30;
- `1H_MA30_RECLAIM`: same rule on 1H;
- `1H_MA30_LOSS`: same rule on 1H.

Equivalent mirrored rules may be evaluated for SHORT-bias symbols where useful, but the required first-class user alerts are the LONG-bias reclaim/loss events above.

Deduplication key:

`ma30:<symbol>:<timeframe>:<candleCloseTime>:<eventType>`

The same closed candle must never create duplicate Bark alerts across restart or repeated processing.

5m MA30 does not create mandatory raw crossing alerts. 5m is primarily used for timing, re-acceleration, local pullback completion, breakout/reclaim confirmation and BUY/ADD scoring.

## Short-timeframe model decision state

For each Focus Pool symbol maintain one decision state:

- `WATCH`
- `WAIT_RESET`
- `BUY_READY`
- `ADD_READY`
- `NO_CHASE`
- `RISK_OFF`
- `INVALIDATED`

A state change is event-worthy only when the semantic action changes or material reasons change.

### BUY_READY intent

`BUY_READY` should require more than a MA30 reclaim. The model should combine evidence such as:

- 1H trend/squeeze bias still valid;
- 15m or 1H MA30 reclaim after a meaningful adjustment;
- 5m/15m higher-low or re-acceleration structure;
- price not excessively extended from MA30 / local value;
- OI behavior consistent with renewed participation rather than terminal blow-off;
- funding not excessively crowded against the intended entry;
- taker / long-short migration supportive when available;
- relative strength vs BTC/ETH not deteriorating;
- room to prior high / measured continuation target;
- stop distance acceptable relative to expected reward.

MA30 reclaim alone should usually produce a structural alert first. It may become `BUY_READY` in the same candle only when the rest of the evidence is already strong.

### ADD_READY intent

`ADD_READY` is for an existing LONG exposure or an already-qualified trend where:

- the prior thesis remains valid;
- a new 5m/15m/1H structure confirms renewed momentum;
- the symbol is not in `NO_CHASE` / blow-off state;
- adding does not rely on widening invalidation materially;
- the new entry improves or preserves expected R/R.

The radar does not execute the add. It only signals the condition.

### NO_CHASE

Use when trend/squeeze remains strong but entry efficiency is poor because of extension, blow-off risk, very poor stop distance or terminal crowding.

A later reset/reclaim can move the symbol back to `WAIT_RESET` or `BUY_READY`.

## A/B execution guidance in Bark

For actionable LONG notifications, include two execution concepts without placing orders:

### A group — pullback/retest entry

Used when a reclaim/breakout is valid but buying the immediate market price has poor efficiency.

Message should include:
- A entry/retest zone;
- A invalidation / stop rule;
- A first risk-reduction / take-profit rule;
- A continuation/trailing rule.

### B group — confirmation/breakout entry

Used when waiting for a second confirmation is preferable.

Message should include:
- B trigger condition or breakout level;
- B invalidation / stop rule;
- B first take-profit / risk-reduction rule;
- B continuation/trailing rule.

A/B levels must be derived from structure/ATR/MA context rather than a fixed arbitrary percentage where possible.

Leverage is never prescribed as a constant multiplier. Risk should be framed by invalidation distance and risk budget.

## Bark notification taxonomy

All notifications use the existing single Bark client and persistent send-once dedupe.

### Type 1 — hourly full-market digest

Two independent digests:
- `【每小时强趋势雷达】`
- `【每小时潜在轧空/轧多雷达】`

Each symbol line must clearly state category and direction.

Example fields:
- `ENAUSDT｜STRONG_TREND + SHORT_SQUEEZE｜LONG`
- `Stage: REIGNITION_READY`
- `Action: WAIT_RESET / BUY_ALLOWED / NO_CHASE`
- score and concise reason codes.

### Type 2 — structural event

Examples:
- `【重点监控】ENAUSDT 15m MA30 收回`
- `【重点监控】ENAUSDT 1H MA30 收回`
- `【重点监控】ENAUSDT 15m MA30 失守`
- `【轧空雷达】ENAUSDT 二次测试`
- `【轧空雷达】ENAUSDT REIGNITION_READY`

The body must explicitly say whether this is:
- only a structural improvement;
- an actual model BUY/ADD permission;
- or a risk warning.

If no model permission exists, say: `结构改善，但 AI 尚未给出买入许可。`

### Type 3 — AI decision alert

Emit on transitions into:
- `BUY_READY`
- `ADD_READY`
- `NO_CHASE`
- `RISK_OFF`
- `INVALIDATED`

BUY/ADD notifications include A/B execution guidance, stop/invalidation and take-profit/risk-reduction rules.

## Website design

Add a radar area to the existing website rather than a separate unrelated application.

The website must show at least two views:

### 1H 全市场

Show latest discovery candidates with:
- symbol;
- classification;
- direction;
- trend/squeeze stage;
- score;
- action status;
- last 1H scan time;
- whether it has entered Focus Pool.

### 重点 5m/15m

Show Focus Pool rows/cards with:
- symbol;
- source badges;
- bias;
- classification;
- current model action;
- 5m structure summary;
- 15m MA30 status;
- 1H MA30 status;
- latest event;
- sticky remaining time;
- last scan/event time.

Clicking a symbol navigates to `/trade?symbol=<symbol>`.

The existing “AI强参与币” surface should consume the same canonical Focus Pool/model-decision source instead of maintaining an independent competing shortlist.

## API

Extend the sidecar HTTP API with read-only endpoints such as:

- `GET /focus-pool`
- `GET /focus-pool/:symbol`
- `GET /hourly-radar`

and proxy them through authenticated/no-store website API routes.

No endpoint in this feature may submit exchange orders.

## Persistence and restart safety

Persist:
- trend state;
- squeeze state;
- Focus Pool state;
- MA30 relation/event watermark per timeframe;
- decision state;
- Bark event dedupe keys;
- last successful hourly and focus scan timestamps.

After restart:
- replay/backfill closed candles;
- do not resend already emitted MA30/BUY/ADD events;
- do not treat startup backfill as a new live opportunity unless a genuinely new closed candle exists.

## Health and failure behavior

Expose separate health for:

- hourly universe scan freshness;
- Focus Pool short-cycle freshness;
- Binance websocket freshness;
- derivatives source degradation count;
- Bark delivery status;
- current universe size;
- current Focus Pool size;
- last successful 5m / 15m / 1H processing timestamps.

Fail closed for actionability:
- stale data cannot produce `BUY_READY` / `ADD_READY`;
- partial derivatives may allow structural alerts but must be labeled `DERIVATIVES_PARTIAL`;
- Bark delivery failure must not mutate a previously-unsent event into “delivered”.

## Testing strategy

Use TDD for new behavior.

Required tests include:

1. Focus Pool source union and 72h expiry;
2. position/watchlist forced monitoring without implied bullish classification;
3. 15m MA30 reclaim/loss closed-candle detection;
4. 1H MA30 reclaim/loss detection;
5. restart/same-candle idempotency;
6. 5m event does not emit mandatory raw MA30 alert;
7. BUY_READY cannot occur on stale data;
8. MA30 reclaim alone does not necessarily imply BUY_READY;
9. BUY_READY / ADD_READY transition Bark dedupe;
10. NO_CHASE can later recover through reset/reclaim;
11. hourly trend and squeeze digests remain separate;
12. every hourly digest candidate includes classification and direction;
13. existing standalone generic 15m Bark path remains disabled;
14. no direct legacy radar API may bypass the canonical Bark cadence/dedupe path;
15. API sanitization does not expose Bark URL, API key, exchange secret or account credentials;
16. website API and UI render disconnected/degraded states safely;
17. existing Binance gateway safety regression suites remain green.

## Rollout

1. Implement and test only on GitHub branch / PR.
2. Lock an exact tested commit SHA.
3. Codex checks out that exact commit into an isolated local worktree on the Mac.
4. Run localhost website + radar with real-order route disabled.
5. User validates layout, statuses, MA30 semantics and Bark message format (Bark can be mocked during the first UI pass).
6. After local acceptance, deploy the same approved commit to an isolated VPS staging service/port/data directory.
7. Validate continuous WebSocket, hourly scans, focused 5m/15m monitoring, restart recovery and Bark dedupe.
8. Only after explicit production approval deploy the same reviewed artifact/commit to production and record truthful release provenance.

## Acceptance criteria

The feature is ready for localhost handoff when:

- 29 prior reconciliation differences are no longer ambiguous;
- new Focus Pool and short-cycle tests pass;
- build passes;
- relevant radar regression tests pass;
- Binance live-order safety regression tests pass;
- secret scan / diff check are clean;
- no order path was enabled;
- GitHub has one exact candidate commit SHA;
- UI/API provide enough state for the user to evaluate the feature locally.
