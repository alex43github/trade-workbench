#!/usr/bin/env python3
"""Fail-closed, bounded-memory master-to-Task-002B cache materializer."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path


FIELDS = (
    "open_time_utc", "close_time_utc", "open", "high", "low", "close",
    "volume", "quote_volume", "trade_count", "taker_buy_base_volume",
    "taker_buy_quote_volume",
)
INTERVAL_MS = 300_000
SCHEMA_VERSION = "fast-detach-v2-master-to-task002b-cache-2"


class MaterializationError(RuntimeError):
    """A source or publication contract failed before a cache became visible."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def require_zstd() -> str:
    executable = shutil.which("zstd")
    if not executable:
        raise MaterializationError("ZSTD_CLI_REQUIRED")
    subprocess.run([executable, "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return executable


def available_memory_bytes() -> int:
    """Return an OS-reported available-memory figure, or fail closed."""
    meminfo = Path("/proc/meminfo")
    if not meminfo.is_file():
        raise MaterializationError("AVAILABLE_RAM_UNAVAILABLE")
    values = {}
    for line in meminfo.read_text(encoding="utf-8").splitlines():
        key, value = line.split(":", 1)
        values[key] = int(value.strip().split()[0]) * 1024
    available = values.get("MemAvailable")
    if available is None:
        raise MaterializationError("AVAILABLE_RAM_UNAVAILABLE")
    return available


def preflight(source: Path, destination: Path, expected_bytes: int, minimum_free: int, max_memory_mib: int) -> dict[str, int]:
    if not source.is_file():
        raise MaterializationError(f"SOURCE_NOT_FOUND:{source}")
    if source.stat().st_size != expected_bytes:
        raise MaterializationError(f"SOURCE_BYTES_MISMATCH:{source.stat().st_size}!={expected_bytes}")
    if max_memory_mib < 64:
        raise MaterializationError("MAX_MEMORY_MIB_TOO_LOW")
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    available_ram = available_memory_bytes()
    memory_bound = max_memory_mib * 1024 * 1024
    if available_ram < memory_bound:
        raise MaterializationError(f"RAM_PREFLIGHT_FAILED:available={available_ram}:bound={memory_bound}")
    free = shutil.disk_usage(parent).free
    estimated_staging = expected_bytes * 2
    estimated_output = expected_bytes
    projected = estimated_staging + estimated_output + minimum_free
    if free < projected:
        raise MaterializationError(f"DISK_PREFLIGHT_FAILED:free={free}:required={projected}")
    if destination.exists():
        raise MaterializationError(f"DESTINATION_ALREADY_EXISTS:{destination}")
    return {"available_ram_bytes": available_ram, "peak_memory_bound_bytes": memory_bound, "free_disk_bytes": free, "estimated_staging_bytes": estimated_staging, "estimated_output_cache_bytes": estimated_output, "projected_required_bytes": projected}


def parse_int(value: object, *, field: str, line: int) -> int:
    if value is None or str(value).strip() == "":
        raise MaterializationError(f"REQUIRED_FIELD_MISSING:{field}:line={line}")
    try:
        return int(str(value))
    except ValueError as exc:
        raise MaterializationError(f"INVALID_INTEGER:{field}:line={line}") from exc


def parse_number(value: object, *, field: str, line: int, positive: bool) -> str:
    if value is None or str(value).strip() == "":
        raise MaterializationError(f"REQUIRED_FIELD_MISSING:{field}:line={line}")
    try:
        number = float(str(value))
    except ValueError as exc:
        raise MaterializationError(f"INVALID_NUMBER:{field}:line={line}") from exc
    if not math.isfinite(number) or (number <= 0 if positive else number < 0):
        raise MaterializationError(f"INVALID_NUMBER_RANGE:{field}:line={line}")
    return str(value)


def open_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA temp_store=FILE")
    connection.execute("CREATE TABLE bars (symbol TEXT NOT NULL, open_time_utc INTEGER NOT NULL, close_time_utc INTEGER NOT NULL, open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL, close TEXT NOT NULL, volume TEXT NOT NULL, quote_volume TEXT NOT NULL, trade_count INTEGER NOT NULL, taker_buy_base_volume TEXT NOT NULL, taker_buy_quote_volume TEXT NOT NULL, PRIMARY KEY(symbol, open_time_utc))")
    return connection


def stream_validate_and_partition(source: Path, database: sqlite3.Connection) -> tuple[int, int]:
    rows = 0
    with gzip.open(source, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        expected = {"symbol", *FIELDS}
        actual = set(reader.fieldnames or ())
        missing = sorted(expected - actual)
        if missing:
            raise MaterializationError(f"MASTER_HEADER_MISSING:{','.join(missing)}")
        for line, raw in enumerate(reader, 2):
            symbol = str(raw.get("symbol") or "").upper().strip()
            if not symbol:
                raise MaterializationError(f"REQUIRED_FIELD_MISSING:symbol:line={line}")
            open_ms = parse_int(raw.get("open_time_utc"), field="open_time_utc", line=line)
            close_ms = parse_int(raw.get("close_time_utc"), field="close_time_utc", line=line)
            if open_ms < 1_000_000_000_000 or open_ms % INTERVAL_MS != 0:
                raise MaterializationError(f"TIMESTAMP_UNIT_OR_ALIGNMENT_INVALID:open_time_utc:line={line}")
            if close_ms != open_ms + INTERVAL_MS - 1:
                raise MaterializationError(f"OPEN_CLOSE_TIME_RELATION_INVALID:line={line}")
            values = {field: parse_number(raw.get(field), field=field, line=line, positive=field in {"open", "high", "low", "close"}) for field in FIELDS[2:] if field != "trade_count"}
            trade_count = parse_int(raw.get("trade_count"), field="trade_count", line=line)
            if trade_count < 0:
                raise MaterializationError(f"INVALID_NUMBER_RANGE:trade_count:line={line}")
            high, low, opened, closed = map(float, (values["high"], values["low"], values["open"], values["close"]))
            if high < max(opened, closed) or low > min(opened, closed) or high < low:
                raise MaterializationError(f"OHLC_RELATION_INVALID:line={line}")
            try:
                database.execute("INSERT INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (symbol, open_ms, close_ms, values["open"], values["high"], values["low"], values["close"], values["volume"], values["quote_volume"], trade_count, values["taker_buy_base_volume"], values["taker_buy_quote_volume"]))
            except sqlite3.IntegrityError as exc:
                raise MaterializationError(f"DUPLICATE_SYMBOL_OPEN_TIME:{symbol}:{open_ms}") from exc
            rows += 1
    database.commit()
    symbols = database.execute("SELECT COUNT(DISTINCT symbol) FROM bars").fetchone()[0]
    if not rows or not symbols:
        raise MaterializationError("MASTER_HAS_NO_VALID_ROWS")
    return rows, symbols


def write_symbol_cache(connection: sqlite3.Connection, symbol: str, stage: Path, zstd: str) -> dict[str, object]:
    output = stage / "symbols" / f"{symbol}.csv.zst"
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_name = tempfile.mkstemp(prefix=f".{symbol}.", suffix=".csv", dir=output.parent)
    rows = 0
    first = last = previous = None
    gaps = 0
    temporary = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
            writer.writeheader()
            for row in connection.execute("SELECT open_time_utc, close_time_utc, open, high, low, close, volume, quote_volume, trade_count, taker_buy_base_volume, taker_buy_quote_volume FROM bars WHERE symbol=? ORDER BY open_time_utc", (symbol,)):
                writer.writerow(dict(zip(FIELDS, row)))
                opened = int(row[0])
                first = opened if first is None else first
                if previous is not None and opened - previous != INTERVAL_MS:
                    gaps += 1
                previous = last = opened
                rows += 1
        subprocess.run([zstd, "-q", "-19", "-T1", "-f", raw_name, "-o", str(temporary)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        os.replace(temporary, output)
    finally:
        if os.path.exists(raw_name):
            os.unlink(raw_name)
        if temporary.exists():
            temporary.unlink()
    return {"path": str(output.relative_to(stage)), "rows": rows, "first_open_time_utc": first, "last_open_time_utc": last, "unexpected_gap_count": gaps, "sha256": sha256_file(output)}


def materialize(args: argparse.Namespace) -> None:
    source = Path(args.input).resolve()
    destination = Path(args.output_dir).resolve()
    if args.source_file_id != args.expected_source_file_id:
        raise MaterializationError("SOURCE_FILE_ID_MISMATCH")
    zstd = require_zstd() if args.compression == "zstd" else None
    guard = preflight(source, destination, args.expected_source_bytes, args.min_free_bytes, args.max_memory_mib)
    source_sha = sha256_file(source)
    if source_sha != args.expected_source_sha256:
        raise MaterializationError(f"SOURCE_SHA256_MISMATCH:{source_sha}")
    stage = Path(tempfile.mkdtemp(prefix=f".{destination.name}.staging-", dir=destination.parent))
    database_path = stage / "partition.sqlite3"
    try:
        database = open_database(database_path)
        total_rows, symbol_count = stream_validate_and_partition(source, database)
        files = {symbol: write_symbol_cache(database, symbol, stage, zstd) for (symbol,) in database.execute("SELECT DISTINCT symbol FROM bars ORDER BY symbol")}
        database.close()
        database_path.unlink(missing_ok=True)
        aggregate = hashlib.sha256(canonical_json(files)).hexdigest()
        manifest = {"schema_version": SCHEMA_VERSION, "source_file_id": args.source_file_id, "source_sha256": source_sha, "source_bytes": source.stat().st_size, "compression": args.compression, "utc_rule": "open_time_utc and close_time_utc are unix epoch milliseconds in UTC", "metrics_present_rule": "all Task-002B canonical fields are required in every master row", "symbol_count": symbol_count, "total_rows": total_rows, "duplicate_open_time_count": 0, "unexpected_gap_count": sum(int(item["unexpected_gap_count"]) for item in files.values()), "files": files, "aggregate_sha256": aggregate, "resource_guard": guard}
        manifest_path = stage / "MASTER_TO_SYMBOLS_MANIFEST.json"
        manifest_path.write_bytes(canonical_json(manifest))
        ready = {"schema_version": SCHEMA_VERSION, "manifest_sha256": sha256_file(manifest_path), "aggregate_sha256": aggregate, "complete": True}
        (stage / "TASK002B_CACHE_COMPLETE.json").write_bytes(canonical_json(ready))
        os.replace(stage, destination)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--compression", choices=("zstd",), default="zstd")
    parser.add_argument("--source-file-id", required=True)
    parser.add_argument("--expected-source-file-id", required=True)
    parser.add_argument("--expected-source-bytes", required=True, type=int)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--min-free-bytes", type=int, default=536_870_912)
    parser.add_argument("--max-memory-mib", type=int, default=512)
    args = parser.parse_args()
    try:
        materialize(args)
    except (MaterializationError, OSError, sqlite3.Error, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"MATERIALIZATION_HARD_FAIL:{exc}") from exc


if __name__ == "__main__":
    main()
