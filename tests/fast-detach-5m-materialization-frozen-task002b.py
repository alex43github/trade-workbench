#!/usr/bin/env python3
"""Integration contract: generated zstd cache is read by frozen Task-002B."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path


def load_task002(path: Path):
    spec = importlib.util.spec_from_file_location("frozen_task_002b", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import frozen Task-002B: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--converter", required=True)
    parser.add_argument("--task002b", required=True)
    args = parser.parse_args()

    subprocess.run(["zstd", "--version"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frozen_task002 = load_task002(Path(args.task002b))

    with tempfile.TemporaryDirectory(prefix="fast-detach-zstd-integration-") as raw:
        root = Path(raw)
        master = root / "metrics_5m_all_fixed.csv.gz"
        output = root / "cache"
        source = "\n".join((
            "symbol,open_time_utc,close_time_utc,open,high,low,close,volume,quote_volume,trade_count,taker_buy_base_volume,taker_buy_quote_volume",
            "ETHUSDT,1770000000000,1770000299999,100,102,99,101,10,1000,5,4,400",
            "ETHUSDT,1770000300000,1770000599999,101,103,100,102,11,1100,6,5,500",
        ))
        with gzip.open(master, "wt", encoding="utf-8", newline="") as handle:
            handle.write(source + "\n")
        master_sha = sha256(master)
        subprocess.run([
            "python3", args.converter,
            "--input", str(master),
            "--output-dir", str(output),
            "--compression", "zstd",
            "--source-file-id", "fixture-file-id",
            "--expected-source-file-id", "fixture-file-id",
            "--expected-source-bytes", str(master.stat().st_size),
            "--expected-source-sha256", master_sha,
            "--min-free-bytes", "0",
            "--max-memory-mib", "64",
        ], check=True)
        cache = output / "symbols" / "ETHUSDT.csv.zst"
        assert cache.is_file(), "zstd cache was not published"
        manifest = json.loads((output / "MASTER_TO_SYMBOLS_MANIFEST.json").read_text(encoding="utf-8"))
        ready = json.loads((output / "TASK002B_CACHE_COMPLETE.json").read_text(encoding="utf-8"))
        assert manifest["compression"] == "zstd"
        assert manifest["files"]["ETHUSDT"]["sha256"] == sha256(cache)
        assert ready["manifest_sha256"] == sha256(output / "MASTER_TO_SYMBOLS_MANIFEST.json")
        rows = frozen_task002.read_symbol_cache(cache)
        assert len(rows) == 2
        assert rows[0]["open_time_ms"] == 1770000000000
        assert rows[0]["close_time_ms"] == 1770000299999
        assert rows[0]["open"] == "100"
        assert rows[0]["high"] == "102"
        assert rows[0]["low"] == "99"
        assert rows[0]["close"] == "101"

        invalid = root / "invalid.csv.gz"
        invalid_output = root / "invalid-cache"
        with gzip.open(invalid, "wt", encoding="utf-8", newline="") as handle:
            handle.write(source.replace(",100,102,99,101,", ",,102,99,101,") + "\n")
        failed = subprocess.run([
            "python3", args.converter,
            "--input", str(invalid),
            "--output-dir", str(invalid_output),
            "--compression", "zstd",
            "--source-file-id", "fixture-file-id",
            "--expected-source-file-id", "fixture-file-id",
            "--expected-source-bytes", str(invalid.stat().st_size),
            "--expected-source-sha256", sha256(invalid),
            "--min-free-bytes", "0",
            "--max-memory-mib", "64",
        ], check=False, capture_output=True, text=True)
        assert failed.returncode != 0, "invalid required OHLC must hard fail"
        assert not invalid_output.exists(), "failed conversion must not publish a partial cache"


if __name__ == "__main__":
    run()
