#!/usr/bin/env python3
"""Convert a frozen gzip CSV master into the Task-002B per-symbol cache layout."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

FIELDS = ("open_time_utc", "close_time_utc", "open", "high", "low", "close", "volume", "quote_volume", "trade_count", "taker_buy_base_volume", "taker_buy_quote_volume")
INTERVAL_MS = 300_000

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_master(path: Path):
    groups = defaultdict(dict)
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        for source in csv.DictReader(handle):
            symbol = (source.get("symbol") or source.get("Symbol") or "").upper().strip()
            timestamp = source.get("open_time_utc") or source.get("open_time_ms") or source.get("openTime")
            if not symbol or timestamp is None:
                raise ValueError("master row requires symbol and open_time_utc")
            open_ms = int(timestamp)
            if open_ms in groups[symbol]:
                raise ValueError(f"duplicate open time: {symbol}:{open_ms}")
            groups[symbol][open_ms] = {
                "open_time_utc": open_ms,
                "close_time_utc": int(source.get("close_time_utc") or source.get("close_time_ms") or open_ms + INTERVAL_MS - 1),
                **{field: source.get(field, "") for field in FIELDS[2:]},
            }
    return groups

def write_symbol(path: Path, rows, compression: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent, delete=False) as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        plain = Path(handle.name)
    if compression == "zstd":
        subprocess.run(["zstd", "-q", "-19", "-T1", "-f", str(plain), "-o", str(path)], check=True)
        plain.unlink()
    else:
        plain.replace(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--compression", choices=("zstd", "plain"), default="zstd")
    args = parser.parse_args()
    source = Path(args.input)
    destination = Path(args.output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    groups = read_master(source)
    files = {}
    total_rows = duplicate_count = gap_count = 0
    for symbol in sorted(groups):
        rows = [groups[symbol][key] for key in sorted(groups[symbol])]
        times = [row["open_time_utc"] for row in rows]
        gap_count += sum(b - a != INTERVAL_MS for a, b in zip(times, times[1:]))
        output = destination / "symbols" / f"{symbol}.csv.zst"
        write_symbol(output, rows, args.compression)
        files[symbol] = {"path": str(output.relative_to(destination)), "rows": len(rows), "first_open_time_utc": times[0], "last_open_time_utc": times[-1], "sha256": sha(output)}
        total_rows += len(rows)
    aggregate = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest = {"schema_version": "fast-detach-v2-master-to-task002b-cache-1", "source_sha256": sha(source), "source_bytes": source.stat().st_size, "compression": args.compression, "utc_rule": "open_time_utc and close_time_utc are unix epoch milliseconds in UTC", "metrics_present_rule": "all Task-002B canonical fields are emitted; absent master metric values remain empty", "symbol_count": len(files), "total_rows": total_rows, "duplicate_open_time_count": duplicate_count, "unexpected_gap_count": gap_count, "files": files, "aggregate_sha256": aggregate}
    (destination / "MASTER_TO_SYMBOLS_MANIFEST.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
