#!/usr/bin/env python3
# PE Top10 × MA30/ATR 10x historical simulation v1
# Deterministic VPS compute layer. No network access required.
# Source of truth: 15m Binance USD-M cache on VPS.

import argparse
import bisect
import csv
import gzip
import hashlib
import json
import math
import os
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HOUR_MS = 3600_000
Q15_MS = 900_000
FEE_RATE = 0.0005
TRANCHE_MARGIN = 10.0
TRANCHE_NOTIONAL = 100.0
MAX_MARGIN = 30.0

DEFAULT_CACHE = Path("/var/lib/trade-workbench/market-cache/15m-history-v1")
DEFAULT_OUT = Path("/var/lib/trade-workbench/research/pe/backtest-output/v1")
START_DATE = date(2026, 4, 2)
END_DATE = date(2026, 9, 18)
SCHEMA_VERSION = "pe-top10-ma30-atr-10x-v1"


def bjt_str(ms):
    if ms is None:
        return ""
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc) + timedelta(hours=8)
    return dt.strftime("%Y-%m-%d %H:%M")


def selection_ms(d):
    # 08:00 Asia/Shanghai == 00:00 UTC.
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def symbol_from_path(p):
    name = p.name
    suffix = ".jsonl.gz"
    return name[:-len(suffix)] if name.endswith(suffix) else name


def load_15m(path):
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            rows.append({
                "openTime": int(r["openTime"]),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r.get("volume", 0.0)),
                "closeTime": int(r["closeTime"]),
            })
    rows.sort(key=lambda x: x["openTime"])
    return rows


def signed_pe(closes, n):
    if len(closes) < n + 1:
        return None
    x = closes[-(n + 1):]
    if any(v <= 0 for v in x):
        return None
    rets = [math.log(x[i] / x[i - 1]) for i in range(1, len(x))]
    denom = sum(abs(v) for v in rets)
    if denom <= 0:
        return 0.0
    return math.log(x[-1] / x[0]) / denom


def derive_hourly(bars):
    groups = defaultdict(list)
    for r in bars:
        h = (r["openTime"] // HOUR_MS) * HOUR_MS
        groups[h].append(r)

    out = []
    closes = []
    tr_seed = []
    atr = None
    prev_close = None
    prev_hour = None

    for h in sorted(groups):
        g = sorted(groups[h], key=lambda x: x["openTime"])
        expected = [h + i * Q15_MS for i in range(4)]
        got = [x["openTime"] for x in g]

        if got != expected:
            # Gap or duplicate: reset all rolling indicators.
            closes = []
            tr_seed = []
            atr = None
            prev_close = None
            prev_hour = None
            continue

        if prev_hour is not None and h != prev_hour + HOUR_MS:
            closes = []
            tr_seed = []
            atr = None
            prev_close = None

        o = g[0]["open"]
        hi = max(x["high"] for x in g)
        lo = min(x["low"] for x in g)
        c = g[-1]["close"]

        if prev_close is None:
            tr = hi - lo
        else:
            tr = max(hi - lo, abs(hi - prev_close), abs(lo - prev_close))

        tr_seed.append(tr)
        if len(tr_seed) == 14:
            atr = sum(tr_seed) / 14.0
        elif len(tr_seed) > 14:
            atr = ((atr * 13.0) + tr) / 14.0

        closes.append(c)
        if len(closes) > 100:
            closes = closes[-100:]

        ma30 = sum(closes[-30:]) / 30.0 if len(closes) >= 30 else None

        out.append({
            "openTime": h,
            "open": o,
            "high": hi,
            "low": lo,
            "close": c,
            "ma30": ma30,
            "atr14": atr,
            "pe6": signed_pe(closes, 6),
            "pe12": signed_pe(closes, 12),
            "pe24": signed_pe(closes, 24),
            "pe72": signed_pe(closes, 72),
        })

        prev_close = c
        prev_hour = h

    return out


def touch(bar, level):
    return level is not None and bar["low"] <= level <= bar["high"]


def avg_entry_nominal(fills):
    if not fills:
        return None
    w = sum(x["notional"] for x in fills)
    return sum(x["price"] * x["notional"] for x in fills) / w


def atomic_json(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def build_candidates(cache, outdir, dates, rebuild=False):
    db = outdir / "candidates.sqlite"
    if rebuild and db.exists():
        db.unlink()

    conn = sqlite3.connect(db)
    conn.execute("""
      CREATE TABLE IF NOT EXISTS candidates(
        d TEXT NOT NULL,
        symbol TEXT NOT NULL,
        pe6 REAL NOT NULL,
        pe12 REAL,
        pe24 REAL,
        pe72 REAL,
        selection_price REAL NOT NULL,
        ma30 REAL NOT NULL,
        atr14 REAL NOT NULL,
        PRIMARY KEY(d, symbol)
      )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_candidates_d_pe6 ON candidates(d, pe6 DESC)")
    conn.commit()

    existing = conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
    if existing and not rebuild:
        print(f"CANDIDATES_REUSE rows={existing}", flush=True)
        return conn

    paths = sorted((cache / "symbols").glob("*.jsonl.gz"))
    if len(paths) < 527:
        raise RuntimeError(f"expected >=527 symbol files, found {len(paths)}")

    date_refs = [(d.isoformat(), selection_ms(d) - HOUR_MS) for d in dates]

    for i, p in enumerate(paths, 1):
        symbol = symbol_from_path(p)
        bars = load_15m(p)
        hourly = derive_hourly(bars)
        hmap = {x["openTime"]: x for x in hourly}
        batch = []

        for ds, ref_h in date_refs:
            x = hmap.get(ref_h)
            if not x:
                continue
            vals = [x.get("pe6"), x.get("pe12"), x.get("pe24"), x.get("pe72"), x.get("ma30"), x.get("atr14")]
            if any(v is None or not math.isfinite(v) for v in vals):
                continue
            batch.append((
                ds, symbol, x["pe6"], x["pe12"], x["pe24"], x["pe72"],
                x["close"], x["ma30"], x["atr14"]
            ))

        conn.executemany("""
          INSERT OR REPLACE INTO candidates
          (d,symbol,pe6,pe12,pe24,pe72,selection_price,ma30,atr14)
          VALUES(?,?,?,?,?,?,?,?,?)
        """, batch)

        if i % 20 == 0 or i == len(paths):
            conn.commit()
            print(f"CANDIDATES {i}/{len(paths)} symbol={symbol}", flush=True)

    return conn


def top10_instances(conn, dates):
    instances = []
    daily_meta = {}

    for d in dates:
        ds = d.isoformat()
        n = conn.execute("SELECT COUNT(*) FROM candidates WHERE d=?", (ds,)).fetchone()[0]
        rows = conn.execute("""
          SELECT symbol,pe6,pe12,pe24,pe72,selection_price,ma30,atr14
          FROM candidates
          WHERE d=?
          ORDER BY pe6 DESC, symbol ASC
          LIMIT 10
        """, (ds,)).fetchall()

        daily_meta[ds] = {
            "UniverseUsed": n,
            "Top10Count": len(rows),
            "DataCoverage": f"universe={n};SURVIVORSHIP_BIAS_CURRENT_527",
        }

        for rank, r in enumerate(rows, 1):
            instances.append({
                "Date_BJT": ds,
                "SelectionTime_BJT": f"{ds} 08:00",
                "Rank": rank,
                "Symbol": r[0],
                "PE6h": r[1],
                "PE12h": r[2],
                "PE24h": r[3],
                "PE72h": r[4],
                "SelectionPrice": r[5],
                "SelectionMA30": r[6],
                "SelectionATR14": r[7],
                "UniverseUsed": n,
                "DataQuality": "SURVIVORSHIP_BIAS_CURRENT_527",
            })

    return instances, daily_meta


def simulate_one(inst, bars, hourly):
    start_ms = selection_ms(date.fromisoformat(inst["Date_BJT"]))
    open_times = [x["openTime"] for x in bars]
    start_idx = bisect.bisect_left(open_times, start_ms)
    hmap = {x["openTime"]: x for x in hourly}

    fills = []
    fill_by_label = {}
    qty = 0.0
    cost = 0.0
    gross = 0.0
    fees = 0.0
    margin_used = 0.0
    first_fill_ms = None
    exit_ms = None
    exit_reason = ""
    exit_price = None
    tp1_done = False
    tp1_time = None
    tp1_price = None
    tp2_time = None
    tp2_price = None
    stop_time = None
    stop_price = None
    liq = False
    mae = None
    mfe = None
    notes = set()
    missing_dynamic = False

    def current_avg_nominal():
        return avg_entry_nominal(fills)

    def sell_fraction(frac, price):
        nonlocal qty, cost, gross, fees
        if qty <= 0:
            return
        q = qty * frac
        avg_cost = cost / qty
        gross += q * (price - avg_cost)
        fees += q * price * FEE_RATE
        qty -= q
        cost -= avg_cost * q
        if qty < 1e-15:
            qty = 0.0
            cost = 0.0

    for bar in bars[start_idx:]:
        cur_hour = (bar["openTime"] // HOUR_MS) * HOUR_MS
        prev_hour = cur_hour - HOUR_MS
        prevf = hmap.get(prev_hour)

        if not prevf or prevf.get("ma30") is None or prevf.get("atr14") is None:
            missing_dynamic = True
            continue

        ma = prevf["ma30"]
        atr = prevf["atr14"]
        levels = {
            "A": ma + 1.0 * atr,
            "B": ma + 1.5 * atr,
            "C": ma,
        }

        entry_hits = [k for k in ("B", "A", "C") if k not in fill_by_label and touch(bar, levels[k])]
        pos_at_start = qty > 0

        tp1_level = ma + 3.0 * atr if pos_at_start and not tp1_done else None
        avg_nom = current_avg_nominal()
        tp2_level = avg_nom * 1.20 if pos_at_start and avg_nom is not None else None

        hit_tp1 = bool(pos_at_start and not tp1_done and touch(bar, tp1_level))
        hit_tp2 = bool(pos_at_start and touch(bar, tp2_level))

        event_count = len(entry_hits) + int(hit_tp1) + int(hit_tp2)
        if event_count >= 2:
            notes.add("AMBIGUOUS_INTRABAR")

        # Conservative ambiguity ordering for a long strategy:
        # existing-position profit events are resolved before same-candle new entries;
        # TP1 before TP2 if both are inside the same 15m candle.
        if pos_at_start and hit_tp1:
            sell_fraction(0.33, tp1_level)
            tp1_done = True
            tp1_time = bar["openTime"]
            tp1_price = tp1_level

        if pos_at_start and hit_tp2 and qty > 0:
            sell_fraction(1.0, tp2_level)
            tp2_time = bar["openTime"]
            tp2_price = tp2_level
            exit_ms = bar["openTime"]
            exit_reason = "TP2"
            exit_price = tp2_level
            break

        # If there was no position at candle start, no same-candle instant TP is credited.
        for label in entry_hits:
            if margin_used + TRANCHE_MARGIN > MAX_MARGIN + 1e-9:
                continue
            px = levels[label]
            q = TRANCHE_NOTIONAL / px
            fills.append({
                "label": label,
                "price": px,
                "time": bar["openTime"],
                "notional": TRANCHE_NOTIONAL,
                "qty": q,
            })
            fill_by_label[label] = fills[-1]
            qty += q
            cost += TRANCHE_NOTIONAL
            fees += TRANCHE_NOTIONAL * FEE_RATE
            margin_used += TRANCHE_MARGIN
            if first_fill_ms is None:
                first_fill_ms = bar["openTime"]

        if qty > 0:
            avg_nom = current_avg_nominal()
            if avg_nom:
                adverse = bar["low"] / avg_nom - 1.0
                favorable = bar["high"] / avg_nom - 1.0
                mae = adverse if mae is None else min(mae, adverse)
                mfe = favorable if mfe is None else max(mfe, favorable)
                if adverse <= -0.10:
                    liq = True

        # 1H close stop: after the final 15m candle of that hour.
        if bar["openTime"] % HOUR_MS == 45 * 60_000:
            hf = hmap.get(cur_hour)
            if hf and hf.get("ma30") is not None and hf["close"] < hf["ma30"]:
                if qty > 0:
                    sell_fraction(1.0, hf["close"])
                    stop_time = bar["closeTime"]
                    stop_price = hf["close"]
                    exit_ms = bar["closeTime"]
                    exit_reason = "STOP_MA30_CLOSE"
                    exit_price = hf["close"]
                else:
                    exit_ms = bar["closeTime"]
                    exit_reason = "NO_FILL_CANCELLED"
                break

    if not exit_reason:
        if qty > 0:
            exit_reason = "OPEN_AT_DATA_END"
            exit_ms = bars[-1]["closeTime"] if bars else start_ms
        else:
            exit_reason = "NO_FILL_DATA_END"
            exit_ms = bars[-1]["closeTime"] if bars else start_ms

    if missing_dynamic:
        notes.add("MISSING_DYNAMIC_1H_SKIPPED")

    avg_nom = current_avg_nominal()
    # For a fully closed position, current_avg_nominal still uses all historical fills, intentionally.
    if fills:
        avg_nom = avg_entry_nominal(fills)

    net = gross - fees
    gross_rom = (gross / margin_used * 100.0) if margin_used > 0 else 0.0
    net_rom = (net / margin_used * 100.0) if margin_used > 0 else 0.0
    hold_hours = ((exit_ms - first_fill_ms) / HOUR_MS) if first_fill_ms is not None and exit_ms is not None else 0.0

    row = dict(inst)
    for label in ("A", "B", "C"):
        f = fill_by_label.get(label)
        row[f"Buy{label}_Time_BJT"] = bjt_str(f["time"]) if f else ""
        row[f"Buy{label}_Price"] = f["price"] if f else None

    row.update({
        "FilledTranches": len(fills),
        "MarginUsed_USD": margin_used,
        "NotionalFilled_USD": len(fills) * TRANCHE_NOTIONAL,
        "AvgEntry": avg_nom,
        "TP1_Time_BJT": bjt_str(tp1_time),
        "TP1_Price": tp1_price,
        "TP2_Target_Last": (avg_nom * 1.20) if avg_nom else None,
        "TP2_Time_BJT": bjt_str(tp2_time),
        "TP2_Price": tp2_price,
        "Stop_Time_BJT": bjt_str(stop_time),
        "Stop_Price": stop_price,
        "ExitTime_BJT": bjt_str(exit_ms),
        "ExitPrice": exit_price,
        "ExitReason": exit_reason,
        "GrossPnL_USD": gross,
        "FeesAssumed_USD": fees,
        "NetPnL_USD": net,
        "ReturnOnUsedMarginPct": gross_rom,
        "NetReturnOnUsedMarginPct": net_rom,
        "MAE_Pct": (mae * 100.0) if mae is not None else None,
        "MFE_Pct": (mfe * 100.0) if mfe is not None else None,
        "HoldHours": hold_hours,
        "LiqRiskFlag": bool(liq),
        "TP1Executed": bool(tp1_done),
        "OpenRemainingQty": qty,
        "Notes": ";".join(sorted(notes)),
    })
    return row


def run_simulations(cache, instances):
    by_symbol = defaultdict(list)
    for x in instances:
        by_symbol[x["Symbol"]].append(x)

    results = []
    symbols = sorted(by_symbol)

    for i, symbol in enumerate(symbols, 1):
        path = cache / "symbols" / f"{symbol}.jsonl.gz"
        if not path.exists():
            raise RuntimeError(f"missing selected symbol data: {symbol}")
        bars = load_15m(path)
        hourly = derive_hourly(bars)
        for inst in sorted(by_symbol[symbol], key=lambda x: x["Date_BJT"]):
            results.append(simulate_one(inst, bars, hourly))
        print(f"SIM {i}/{len(symbols)} symbol={symbol} instances={len(by_symbol[symbol])}", flush=True)

    results.sort(key=lambda x: (x["Date_BJT"], x["Rank"], x["Symbol"]))
    return results


def daily_summaries(trades, daily_meta):
    by_date = defaultdict(list)
    for r in trades:
        by_date[r["Date_BJT"]].append(r)

    out = []
    cum_net = 0.0
    cum_gross = 0.0
    cum_margin = 0.0

    for ds in sorted(by_date):
        rows = by_date[ds]
        executed = [r for r in rows if r["MarginUsed_USD"] > 0]
        closed = [r for r in executed if r["ExitReason"] != "OPEN_AT_DATA_END"]
        wins = [r for r in closed if r["NetPnL_USD"] > 0]
        losses = [r for r in closed if r["NetPnL_USD"] <= 0]

        gross = sum(r["GrossPnL_USD"] for r in rows)
        net = sum(r["NetPnL_USD"] for r in rows)
        margin = sum(r["MarginUsed_USD"] for r in rows)
        cum_gross += gross
        cum_net += net
        cum_margin += margin

        best = max(executed, key=lambda r: r["NetPnL_USD"]) if executed else None
        worst = min(executed, key=lambda r: r["NetPnL_USD"]) if executed else None

        def avg(vals):
            vals = [v for v in vals if v is not None]
            return sum(vals) / len(vals) if vals else None

        meta = daily_meta[ds]
        out.append({
            "Date_BJT": ds,
            "Top10Count": len(rows),
            "ExecutedInstances": len(executed),
            "NoFillCancelled": sum(1 for r in rows if r["ExitReason"].startswith("NO_FILL")),
            "Wins": len(wins),
            "Losses": len(losses),
            "OpenAtDataEnd": sum(1 for r in rows if r["ExitReason"] == "OPEN_AT_DATA_END"),
            "GrossPnL_USD": gross,
            "NetPnL_USD": net,
            "MarginUsed_USD": margin,
            "ReturnOnMarginPct": (net / margin * 100.0) if margin else 0.0,
            "TP1Count": sum(1 for r in rows if r["TP1Executed"]),
            "TP2Count": sum(1 for r in rows if r["ExitReason"] == "TP2"),
            "StopCount": sum(1 for r in rows if r["ExitReason"] == "STOP_MA30_CLOSE"),
            "LiqRiskCount": sum(1 for r in rows if r["LiqRiskFlag"]),
            "AvgHoldHours": avg([r["HoldHours"] for r in executed]),
            "AvgMAE_Pct": avg([r["MAE_Pct"] for r in executed]),
            "AvgMFE_Pct": avg([r["MFE_Pct"] for r in executed]),
            "CumulativeGrossPnL_USD": cum_gross,
            "CumulativeNetPnL_USD": cum_net,
            "CumulativeMarginUsed_USD": cum_margin,
            "CumulativeROI_Pct": (cum_net / cum_margin * 100.0) if cum_margin else 0.0,
            "BestSymbol": best["Symbol"] if best else "",
            "BestSymbolNetPnL_USD": best["NetPnL_USD"] if best else None,
            "WorstSymbol": worst["Symbol"] if worst else "",
            "WorstSymbolNetPnL_USD": worst["NetPnL_USD"] if worst else None,
            "UniverseUsed": meta["UniverseUsed"],
            "DataCoverage": meta["DataCoverage"],
            "Status": "COMPLETE" if len(rows) == 10 else "PARTIAL_TOP10",
        })
    return out


def audit(trades, daily):
    errors = []
    by_date = defaultdict(list)
    for r in trades:
        by_date[r["Date_BJT"]].append(r)
        if r["FilledTranches"] > 3:
            errors.append(f'{r["Date_BJT"]} {r["Symbol"]}: FilledTranches>3')
        if r["MarginUsed_USD"] > 30.0 + 1e-9:
            errors.append(f'{r["Date_BJT"]} {r["Symbol"]}: MarginUsed>30')
        if r["ExitReason"] in ("TP2", "STOP_MA30_CLOSE") and abs(r["OpenRemainingQty"]) > 1e-10:
            errors.append(f'{r["Date_BJT"]} {r["Symbol"]}: closed with remaining qty')

    dmap = {x["Date_BJT"]: x for x in daily}
    for ds, rows in by_date.items():
        ranks = sorted(r["Rank"] for r in rows)
        if len(rows) == 10 and ranks != list(range(1, 11)):
            errors.append(f"{ds}: invalid ranks {ranks}")
        x = dmap[ds]
        net = sum(r["NetPnL_USD"] for r in rows)
        gross = sum(r["GrossPnL_USD"] for r in rows)
        margin = sum(r["MarginUsed_USD"] for r in rows)
        if abs(net - x["NetPnL_USD"]) > 1e-8:
            errors.append(f"{ds}: daily net mismatch")
        if abs(gross - x["GrossPnL_USD"]) > 1e-8:
            errors.append(f"{ds}: daily gross mismatch")
        if abs(margin - x["MarginUsed_USD"]) > 1e-8:
            errors.append(f"{ds}: daily margin mismatch")

    return errors


def total_summary(trades, daily):
    executed = [r for r in trades if r["MarginUsed_USD"] > 0]
    closed = [r for r in executed if r["ExitReason"] != "OPEN_AT_DATA_END"]
    wins = [r for r in closed if r["NetPnL_USD"] > 0]
    gross = sum(r["GrossPnL_USD"] for r in trades)
    net = sum(r["NetPnL_USD"] for r in trades)
    fees = sum(r["FeesAssumed_USD"] for r in trades)
    margin = sum(r["MarginUsed_USD"] for r in trades)

    sym = defaultdict(float)
    for r in executed:
        sym[r["Symbol"]] += r["NetPnL_USD"]

    best_sym = max(sym.items(), key=lambda x: x[1]) if sym else ("", 0.0)
    worst_sym = min(sym.items(), key=lambda x: x[1]) if sym else ("", 0.0)
    best_day = max(daily, key=lambda x: x["NetPnL_USD"]) if daily else None
    worst_day = min(daily, key=lambda x: x["NetPnL_USD"]) if daily else None

    return {
        "SchemaVersion": SCHEMA_VERSION,
        "StartDate_BJT": START_DATE.isoformat(),
        "EndDate_BJT": END_DATE.isoformat(),
        "CandidateRows": len(trades),
        "ExecutedInstances": len(executed),
        "ClosedInstances": len(closed),
        "Wins": len(wins),
        "WinRatePct": (len(wins) / len(closed) * 100.0) if closed else None,
        "GrossPnL_USD": gross,
        "FeesAssumed_USD": fees,
        "NetPnL_USD": net,
        "CumulativeMarginUsed_USD": margin,
        "ROI_Pct": (net / margin * 100.0) if margin else None,
        "TP1HitRatePct": (sum(1 for r in executed if r["TP1Executed"]) / len(executed) * 100.0) if executed else None,
        "TP2HitRatePct": (sum(1 for r in executed if r["ExitReason"] == "TP2") / len(executed) * 100.0) if executed else None,
        "StopRatePct": (sum(1 for r in executed if r["ExitReason"] == "STOP_MA30_CLOSE") / len(executed) * 100.0) if executed else None,
        "LiqRiskRatePct": (sum(1 for r in executed if r["LiqRiskFlag"]) / len(executed) * 100.0) if executed else None,
        "BestDate": best_day["Date_BJT"] if best_day else "",
        "BestDateNetPnL_USD": best_day["NetPnL_USD"] if best_day else None,
        "WorstDate": worst_day["Date_BJT"] if worst_day else "",
        "WorstDateNetPnL_USD": worst_day["NetPnL_USD"] if worst_day else None,
        "BestSymbol": best_sym[0],
        "BestSymbolNetPnL_USD": best_sym[1],
        "WorstSymbol": worst_sym[0],
        "WorstSymbolNetPnL_USD": worst_sym[1],
        "UniverseBias": "SURVIVORSHIP_BIAS_CURRENT_527",
    }


def write_csv(path, rows):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    keys = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def write_chunks(outdir, trades, daily, total):
    chunks_dir = outdir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    dmap = defaultdict(list)
    for r in trades:
        dmap[r["Date_BJT"]].append(r)
    smap = {x["Date_BJT"]: x for x in daily}
    dates = sorted(dmap)

    manifest_chunks = []
    for i in range(0, len(dates), 5):
        ds = dates[i:i + 5]
        trows = [r for d in ds for r in dmap[d]]
        srows = [smap[d] for d in ds]
        obj = {
            "SchemaVersion": SCHEMA_VERSION,
            "DateStart_BJT": ds[0],
            "DateEnd_BJT": ds[-1],
            "ProcessedDays": len(ds),
            "Trades": trows,
            "Daily_Summary": srows,
            "Audit": {
                "Top10ExpectedPerDay": 10,
                "ChunkStatus": "READY",
            },
        }
        fn = f"chunk_{i//5:03d}_{ds[0]}_{ds[-1]}.json"
        p = chunks_dir / fn
        atomic_json(p, obj)
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        manifest_chunks.append({
            "File": f"chunks/{fn}",
            "DateStart_BJT": ds[0],
            "DateEnd_BJT": ds[-1],
            "ProcessedDays": len(ds),
            "TradeRows": len(trows),
            "SHA256": sha,
        })

    manifest = {
        "SchemaVersion": SCHEMA_VERSION,
        "GeneratedAtUTC": datetime.now(timezone.utc).isoformat(),
        "Source15m": str(DEFAULT_CACHE),
        "SourceRule": "527 current-universe Binance USD-M 15m cache; historical universe not reconstructed",
        "SelectionTime": "08:00 Asia/Shanghai; uses only last fully closed 1H and earlier",
        "Ranking": "Signed PE6h descending; PE12h/24h/72h recorded",
        "MA30": "SMA30",
        "ATR14": "Wilder/RMA",
        "FeeRatePerExecution": FEE_RATE,
        "ChunkDays": 5,
        "ChunkCount": len(manifest_chunks),
        "Chunks": manifest_chunks,
        "TotalSummary": total,
    }
    atomic_json(outdir / "manifest.json", manifest)
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(DEFAULT_CACHE))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--rebuild-candidates", action="store_true")
    args = ap.parse_args()

    cache = Path(args.cache)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    status_path = cache / "STATUS.json"
    status = json.loads(status_path.read_text(encoding="utf-8"))
    if status.get("status") != "COMPLETE" or status.get("missingCount") != 0:
        raise RuntimeError(f"15m cache not ready: {status}")

    dates = list(daterange(START_DATE, END_DATE))
    print(f"START dates={len(dates)} cache={cache}", flush=True)

    conn = build_candidates(cache, outdir, dates, rebuild=args.rebuild_candidates)
    instances, daily_meta = top10_instances(conn, dates)
    conn.close()

    expected = len(dates) * 10
    if len(instances) != expected:
        print(f"WARNING top10 rows={len(instances)} expected={expected}", flush=True)

    trades = run_simulations(cache, instances)
    daily = daily_summaries(trades, daily_meta)
    errors = audit(trades, daily)

    atomic_json(outdir / "audit.json", {
        "SchemaVersion": SCHEMA_VERSION,
        "ErrorCount": len(errors),
        "Errors": errors,
        "CheckedAtUTC": datetime.now(timezone.utc).isoformat(),
    })

    if errors:
        raise RuntimeError(f"audit failed with {len(errors)} errors; see audit.json")

    total = total_summary(trades, daily)
    atomic_json(outdir / "total_summary.json", total)
    write_csv(outdir / "Trades.csv", trades)
    write_csv(outdir / "Daily_Summary.csv", daily)
    manifest = write_chunks(outdir, trades, daily, total)

    atomic_json(outdir / "READY.json", {
        "Status": "READY",
        "SchemaVersion": SCHEMA_VERSION,
        "TradeRows": len(trades),
        "DailyRows": len(daily),
        "ChunkCount": manifest["ChunkCount"],
        "GeneratedAtUTC": datetime.now(timezone.utc).isoformat(),
    })

    print(json.dumps({
        "status": "READY",
        "tradeRows": len(trades),
        "dailyRows": len(daily),
        "chunks": manifest["ChunkCount"],
        "total": total,
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
