# Radar local release-candidate evidence bundle

`PRODUCTION_PROVENANCE=UNRESOLVED`

This is a local-only evidence bundle for RADAR-LOCAL-03. It is not a production
`RELEASE.json`, does not describe the current VPS, and must not be installed or
applied. Until a separately approved, exact VPS baseline is available, unmatched
VPS files require **zero deployment actions**.

## Intended local comparison inventory

The inventory is the exact scope emitted by
`node scripts/radar-deployment-preflight.mjs` on 2026-09-13. SHA-256 values
describe local workspace bytes only.

| File | SHA-256 |
| --- | --- |
| `services/structure-radar/bar-cache.ts` | `34f56cb649b176356df94918229af0295e4e2d380f8442a6f95c6f8f9db1dde3` |
| `services/structure-radar/bark.ts` | `cb889e5ffc921410d894378a87566bcae658f87854010605bcae721ee23a3133` |
| `services/structure-radar/binance-public.ts` | `597bdf8243c1db6976144190594f2c142eb0038d4573fc116566d6d01b65d338` |
| `services/structure-radar/config.ts` | `9b321b06881ce5b8d1d445882e6069b7afb85dd88a1a5023dcb5b9ede3ba9af0` |
| `services/structure-radar/http-server.ts` | `130001eae28aa4cce26a2cb8b149354cc1728912d5ce272a3cc6cce6385cb20d` |
| `services/structure-radar/main.ts` | `99e8a29462f81a0fb9a3d2710c00e279fa66a58785325ea0ee28551ecd046994` |
| `services/structure-radar/runtime.ts` | `75de5891b5145bbf50eee61d57b5d1792b734202d992d6a5cfe8f0bc73de7af4` |
| `services/structure-radar/radar-cadence.ts` | `24f904cececfa8a330c1d62c176a8f64d1e0221bb36be740eeb43f0c1de2dcbf` |
| `services/structure-radar/squeeze-radar.ts` | `654173497bf8620cd157772d84e3b1d09a45c4039e14710c0e099df95599a43d` |
| `services/structure-radar/trend-radar.ts` | `3ac4e84b1088b3e077fcb1a2a280c7af0e5426f8af27272886ae4ed434d7dfde` |
| `services/structure-radar/radar-repository.ts` | `0fb5172585f48dbdef9057d9003a9d59f896c5f0adf44c8dd1ce976225090c6a` |
| `services/structure-radar/scanner.ts` | `286c161559740e1c1d2a13301c49d74fa044d089331557b60195091c3fb5d08f` |
| `services/structure-radar/websocket-feed.ts` | `a1882a99497d3ddcd34b3a528abd069f5cb61002a915ce26ee687720c47be2aa` |
| `deploy/squeeze-radar.service` | `50126569d9b6626e4a24327b2c07e63605b14591f641ed2e2b30e9533ba9f2ba` |

The inventory includes the sidecar's direct runtime dependencies. It still does
not identify any VPS baseline or authorize a deployment.

## Expected process and configuration names

- Service/process name: `squeeze-radar.service` / `structure-radar` Node process.
- Entrypoint: `services/structure-radar/main.ts`.
- Service environment-file name: `/etc/trade-workbench/workbench.env`.
- Runtime configuration names: `RADAR_DATA_DIRECTORY`, `RADAR_PORT`,
  `RADAR_LOCAL_TOKEN`, `RADAR_NOTIFY_ENABLED`, `BARK_BASE_URL`, and
  `RADAR_BARK_CONFIG_PATH`.
- No values, URLs, tokens, or credentials are included in this bundle.

## Local evidence

- Narrow acceptance suite: 48 passed, 1 skipped, 0 failed. It covers SQZ
  transitions/restart dedupe, TREND 1h/4h transitions and 15m suppression,
  independent digest routing, hour buckets, health fail-closed behavior, and
  persisted Bark dedupe with injected fetchers only.
- `npm run build`: passed. The build reported two pre-existing Vite future
  config-loader warnings and no build failure.
- `git diff --check`: must be run as the final local gate for this task.

## Static route audit

`main.ts` is the only local runtime caller of SQZ/TREND radar emitters. SQZ
state-transition notices flow through `BarkClient.sendOnce`; TREND candidates are
persisted and flow only into `runHourlyRadarCycle`, whose two independent digest
routes also use `BarkClient.sendOnce`. The immediate SQZ transition route is
intentional and is not a summary cadence route; it requires a closed 1h scan,
state transition, and Bark's persistent dedupe. Both hourly summaries fail closed
on degraded scans or delivery failure, and health derives from successful scan /
cycle evidence.

The broader application has a legacy, independent Square-crowding alert route
at `app/api/radar/alerts/route.ts`. It can use the word `SQUEEZE_TRIGGER`, but
does not use the SQZ/TREND sidecar event model, cadence, or deployment slice.
It is therefore explicitly excluded from this sidecar RC rather than being
mistaken for a routed SQZ/TREND event. Changing or consolidating that legacy
product notification requires a separate scoped task.

## Preflight guard

`verifyRadarDeploymentProvenance` accepts only `approved-baseline`, requires the
remote file set to exactly match the intended inventory, and returns an empty
action list for absent, invalid, mismatched, or extra remote files. A byte-for-byte
match still yields only `manual deployment review required`; the tool has no
remote connection, copy, overwrite, or deployment capability.
