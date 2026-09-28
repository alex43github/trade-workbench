#!/usr/bin/env python3
import csv, gzip, json, math, re, statistics, sys, time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SNAP_DIR = Path("/opt/sqz-radar-v2/data/event-stage-snapshots")
CACHE_DIR = Path("/var/lib/trade-workbench/market-cache/15m-history-v1/symbols")
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
OUT_DIR = Path(f"/tmp/reignition-fast-backtest-{STAMP}")
OUT_DIR.mkdir(parents=True, exist_ok=True)

HORIZONS = (1, 4, 6, 12)
BAR_MS = 15 * 60 * 1000
NOW_MS = int(datetime.now(timezone.utc).timestamp() * 1000)
BINANCE = "https://fapi.binance.com/fapi/v1/klines"

def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None

def intnum(v):
    x = num(v)
    return int(x) if x is not None else None

def snapshot_ms(path):
    m = re.match(r"(\d{8}T\d{6}Z)-", path.name)
    if not m:
        return None
    return int(datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)

def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")

def load_snapshot_observations():
    obs = []
    for p in sorted(SNAP_DIR.glob("*.json")):
        t = snapshot_ms(p)
        if t is None:
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        # Important: use only candidates. The same row can also be repeated
        # under eden_ideal / ideal_geometry inside the same snapshot.
        rows = data.get("candidates")
        if not isinstance(rows, list):
            continue
        for r in rows:
            if not isinstance(r, dict):
                continue
            if r.get("true_15m_reignition") is not True:
                continue
            if str(r.get("stage")) != "SECOND_ENTRY":
                continue
            symbol = str(r.get("symbol") or "").upper()
            price = num(r.get("close15m"))
            if not symbol or price is None or price <= 0:
                continue
            obs.append({
                "snapshot_file": p.name,
                "snapshot_ms": t,
                "symbol": symbol,
                "signal_price": price,
                "close1h": num(r.get("close1h")),
                "transition": str(r.get("transition") or ""),
                "reset_time_ms": intnum(r.get("reset_time_ms")),
                "breakout_time_ms": intnum(r.get("breakout_time_ms")),
                "reset_swing_low_15m": num(r.get("reset_swing_low_15m")),
                "priority_score": num(r.get("priority_score")),
                "ideal_similarity_score": num(r.get("ideal_similarity_score")),
                "squeeze_mechanism_confidence": num(r.get("squeeze_mechanism_confidence")),
                "funding": num(r.get("funding")),
                "global_ratio": num(r.get("global_ratio")),
                "top_account_ratio": num(r.get("top_account_ratio")),
                "oi_change_pct": num(r.get("oi_change_pct")),
                "taker_buy_sell": num(r.get("taker_buy_sell")),
                "fire_count": intnum(r.get("fire_count")),
                "user_stage": r.get("user_stage"),
            })
    return sorted(obs, key=lambda x: (x["snapshot_ms"], x["symbol"]))

def dedupe_events(observations):
    events, reset_keys, last_event, last_seen = [], {}, {}, {}
    for o in observations:
        sym, reset = o["symbol"], o["reset_time_ms"]
        if reset and (sym, reset) in reset_keys:
            last_seen[sym] = o["snapshot_ms"]
            continue
        if not reset:
            idx = last_event.get(sym)
            if idx is not None and o["snapshot_ms"] - last_seen.get(sym, 0) <= 150 * 60 * 1000:
                last_seen[sym] = o["snapshot_ms"]
                continue

        event = dict(o)
        event["event_id"] = f"{sym}:{o['snapshot_ms']}"
        events.append(event)
        idx = len(events) - 1
        last_event[sym] = idx
        last_seen[sym] = o["snapshot_ms"]
        if reset:
            reset_keys[(sym, reset)] = idx
    return events

def load_local(symbol):
    p = CACHE_DIR / f"{symbol}.jsonl.gz"
    if not p.is_file():
        return []
    rows = []
    try:
        with gzip.open(p, "rt") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    vals = {
                        "openTime": intnum(r.get("openTime")),
                        "closeTime": intnum(r.get("closeTime")),
                        "open": num(r.get("open")), "high": num(r.get("high")),
                        "low": num(r.get("low")), "close": num(r.get("close")),
                    }
                    if all(v is not None for v in vals.values()):
                        rows.append(vals)
                except Exception:
                    continue
    except Exception:
        return []
    return sorted(rows, key=lambda x: x["openTime"])

def fetch_binance(symbol, start_ms, end_ms):
    params = urlencode({
        "symbol": symbol, "interval": "15m",
        "startTime": int(start_ms), "endTime": int(end_ms), "limit": 1500,
    })
    req = Request(f"{BINANCE}?{params}", headers={"User-Agent": "trade-workbench-reignition-mvp/1.0"})
    with urlopen(req, timeout=20) as resp:
        raw = json.load(resp)
    rows = []
    for r in raw:
        try:
            rows.append({
                "openTime": int(r[0]), "open": float(r[1]), "high": float(r[2]),
                "low": float(r[3]), "close": float(r[4]), "closeTime": int(r[6]),
            })
        except Exception:
            pass
    return rows

def merged_bars(symbol, needed_start, needed_end):
    local = load_local(symbol)
    source = "LOCAL"
    have_start = local[0]["openTime"] if local else None
    have_end = local[-1]["closeTime"] if local else None
    need_fill = have_start is None or have_end is None or have_start > needed_start or have_end < needed_end
    extra = []
    if need_fill and needed_start < NOW_MS:
        try:
            extra = fetch_binance(symbol, needed_start - BAR_MS, min(needed_end + BAR_MS, NOW_MS))
            if extra:
                source = "LOCAL+BINANCE" if local else "BINANCE"
            time.sleep(0.20)
        except Exception as e:
            print(f"BINANCE_FILL_FAILED {symbol}: {e}", file=sys.stderr)
    by_open = {r["openTime"]: r for r in local}
    for r in extra:
        by_open[r["openTime"]] = r
    return sorted(by_open.values(), key=lambda x: x["openTime"]), source

def first_bar_at_or_after(bars, target_ms):
    for b in bars:
        if b["closeTime"] >= target_ms:
            return b if b["closeTime"] - target_ms <= BAR_MS + 1000 else None
    return None

observations = load_snapshot_observations()
events = dedupe_events(observations)

print(f"RAW_SECOND_ENTRY_OBSERVATIONS={len(observations)}")
print(f"DEDUPED_SECOND_ENTRY_EVENTS={len(events)}")
print(f"UNIQUE_SYMBOLS={len(set(e['symbol'] for e in events))}")

by_symbol = defaultdict(list)
for e in events:
    by_symbol[e["symbol"]].append(e)

symbol_bars, symbol_source = {}, {}
for i, (sym, evs) in enumerate(sorted(by_symbol.items()), 1):
    start = min(e["snapshot_ms"] for e in evs)
    end = min(max(e["snapshot_ms"] for e in evs) + 12 * 3600 * 1000 + BAR_MS, NOW_MS)
    bars, source = merged_bars(sym, start, end)
    symbol_bars[sym], symbol_source[sym] = bars, source
    if i % 25 == 0:
        print(f"DATA_READY={i}/{len(by_symbol)}")

rows_out = []
for e in events:
    row = dict(e)
    row["signal_time_utc"] = iso(e["snapshot_ms"])
    row["signal_time_source"] = "FIRST_QUALIFYING_SNAPSHOT"
    row["market_data_source"] = symbol_source.get(e["symbol"], "NONE")
    bars = symbol_bars.get(e["symbol"], [])
    first_future_open = ((e["snapshot_ms"] + BAR_MS - 1) // BAR_MS) * BAR_MS

    for h in HORIZONS:
        prefix = f"h{h}"
        target = e["snapshot_ms"] + h * 3600 * 1000
        if target > NOW_MS:
            row[f"{prefix}_status"] = "NOT_MATURED"
            row[f"{prefix}_return_pct"] = row[f"{prefix}_mfe_pct"] = row[f"{prefix}_mae_pct"] = None
            continue

        out_bar = first_bar_at_or_after(bars, target)
        if not out_bar:
            row[f"{prefix}_status"] = "MISSING_DATA"
            row[f"{prefix}_return_pct"] = row[f"{prefix}_mfe_pct"] = row[f"{prefix}_mae_pct"] = None
            continue

        path = [b for b in bars if b["openTime"] >= first_future_open and b["closeTime"] <= out_bar["closeTime"]]
        if not path:
            row[f"{prefix}_status"] = "MISSING_DATA"
            row[f"{prefix}_return_pct"] = row[f"{prefix}_mfe_pct"] = row[f"{prefix}_mae_pct"] = None
            continue

        entry = e["signal_price"]
        row[f"{prefix}_status"] = "OK"
        row[f"{prefix}_return_pct"] = (out_bar["close"] / entry - 1) * 100
        row[f"{prefix}_mfe_pct"] = (max(b["high"] for b in path) / entry - 1) * 100
        row[f"{prefix}_mae_pct"] = (min(b["low"] for b in path) / entry - 1) * 100

    rows_out.append(row)

fields = [
    "event_id","symbol","signal_time_utc","signal_time_source","signal_price","close1h",
    "transition","reset_time_ms","breakout_time_ms","reset_swing_low_15m","priority_score",
    "ideal_similarity_score","squeeze_mechanism_confidence","funding","global_ratio",
    "top_account_ratio","oi_change_pct","taker_buy_sell","fire_count","user_stage",
    "market_data_source",
]
for h in HORIZONS:
    fields += [f"h{h}_status",f"h{h}_return_pct",f"h{h}_mfe_pct",f"h{h}_mae_pct"]

csv_path = OUT_DIR / "reignition_events.csv"
with csv_path.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows_out)

jsonl_path = OUT_DIR / "reignition_events.jsonl"
with jsonl_path.open("w") as f:
    for r in rows_out:
        f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")

def med(values):
    return statistics.median(values) if values else None

summary = {
    "raw_second_entry_observations": len(observations),
    "deduped_events": len(events),
    "unique_symbols": len(set(e["symbol"] for e in events)),
    "signal_time_source": "FIRST_QUALIFYING_SNAPSHOT",
    "entry_price_source": "snapshot.close15m",
    "horizons": {},
}
for h in HORIZONS:
    ok = [r for r in rows_out if r.get(f"h{h}_status") == "OK"]
    rets = [r[f"h{h}_return_pct"] for r in ok]
    mfes = [r[f"h{h}_mfe_pct"] for r in ok]
    maes = [r[f"h{h}_mae_pct"] for r in ok]
    summary["horizons"][str(h)] = {
        "n_ok": len(ok),
        "n_not_matured": sum(r.get(f"h{h}_status") == "NOT_MATURED" for r in rows_out),
        "n_missing": sum(r.get(f"h{h}_status") == "MISSING_DATA" for r in rows_out),
        "positive_rate_pct": (sum(x > 0 for x in rets) / len(rets) * 100) if rets else None,
        "ge_1pct_rate_pct": (sum(x >= 1 for x in rets) / len(rets) * 100) if rets else None,
        "ge_2pct_rate_pct": (sum(x >= 2 for x in rets) / len(rets) * 100) if rets else None,
        "median_return_pct": med(rets),
        "median_mfe_pct": med(mfes),
        "median_mae_pct": med(maes),
    }

summary_path = OUT_DIR / "summary.json"
summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

print()
print("========== REIGNITION FAST BACKTEST ==========")
print(f"SNAPSHOTS={len(list(SNAP_DIR.glob('*.json')))}")
print(f"RAW_SECOND_ENTRY_OBSERVATIONS={len(observations)}")
print(f"DEDUPED_EVENTS={len(events)}")
print(f"UNIQUE_SYMBOLS={summary['unique_symbols']}")
print("SIGNAL_TIME=first snapshot where candidates.stage=SECOND_ENTRY and true_15m_reignition=true")
print("ENTRY_PRICE=snapshot close15m")
print()

def fmt(v):
    return "NA" if v is None else f"{v:.2f}%"

for h in HORIZONS:
    s = summary["horizons"][str(h)]
    print(
        f"{h}H N={s['n_ok']} NOT_MATURED={s['n_not_matured']} MISSING={s['n_missing']} "
        f"POSITIVE={fmt(s['positive_rate_pct'])} "
        f">=1%={fmt(s['ge_1pct_rate_pct'])} >=2%={fmt(s['ge_2pct_rate_pct'])} "
        f"MED_RETURN={fmt(s['median_return_pct'])} "
        f"MED_MFE={fmt(s['median_mfe_pct'])} MED_MAE={fmt(s['median_mae_pct'])}"
    )

print()
print("========== FIRST 20 EVENTS ==========")
for r in rows_out[:20]:
    vals = []
    for h in HORIZONS:
        v = r.get(f"h{h}_return_pct")
        vals.append(f"{h}H={'NA' if v is None else f'{v:+.2f}%'}")
    print(r["signal_time_utc"], r["symbol"], f"entry={r['signal_price']}", " ".join(vals))

print()
print(f"CSV={csv_path}")
print(f"JSONL={jsonl_path}")
print(f"SUMMARY={summary_path}")
print("PRODUCTION_CHANGED=false")
print("BACKTEST_COMPLETE=true")
