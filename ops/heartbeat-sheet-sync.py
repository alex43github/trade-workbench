#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

BJT = ZoneInfo("Asia/Shanghai")
SOURCE = "VPS_FOCUS_V23"
DEFAULT_FOCUS_JSON = "/var/lib/trade-workbench/structure-radar/hourly-focus-pool-v22.json"
DEFAULT_STATE_DIR = "/var/lib/trade-workbench/heartbeat-bridge"

def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr, flush=True)

def first(obj: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in obj and obj[name] is not None:
            return obj[name]
    return default

def nested(obj: dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur

def as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default

def parse_ts(value: Any) -> datetime:
    if not value:
        raise ValueError("missing source timestamp")
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def bjt_slot(dt: datetime) -> str:
    return dt.astimezone(BJT).strftime("%Y-%m-%d %H:00 BJT")

def bjt_now() -> str:
    return datetime.now(tz=BJT).strftime("%Y-%m-%d %H:%M:%S BJT")

def sanitize_key(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)

def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"expected JSON object in {path}")
    return data

def build_payload(data: dict[str, Any]) -> dict[str, Any]:
    counts = data.get("counts") if isinstance(data.get("counts"), dict) else {}
    deep = data.get("deepGuard") if isinstance(data.get("deepGuard"), dict) else {}

    source_ts = first(
        data, "sourceGeneratedAt", "generatedAt", "generated_at", "updatedAt", "updated_at"
    )
    source_dt = parse_ts(source_ts)
    slot = bjt_slot(source_dt)

    deep_status = str(first(deep, "status", default="") or "").upper()
    root_status = str(first(data, "status", "runStatus", default="") or "").upper()

    if deep_status in {"ALREADY_COVERED", "DEEP_AVAILABLE", "COMPLETE", "SUCCESS"}:
        phase, run_status, error_stage, error_detail = "FINAL", "SUCCESS", "", ""
    elif deep_status in {"PARTIAL_REQUIRES_DEEP", "DEEP_PENDING", "PENDING"}:
        phase, run_status = "PRE_DEEP", "PARTIAL"
        error_stage, error_detail = "DEEP_PENDING", f"deepGuard.status={deep_status}"
    elif root_status in {"FAILED", "ERROR"}:
        phase, run_status = "FAILED", "FAILED"
        error_stage = str(first(data, "errorStage", default="V23_MAIN"))
        error_detail = str(first(data, "errorDetail", "error", default="V23 main output reported failure"))
    elif root_status in {"READY", "PARTIAL", "SUCCESS"}:
        phase = "PRE_DEEP"
        run_status = "PARTIAL" if root_status != "SUCCESS" else "SUCCESS"
        error_stage = "DEEP_PENDING" if run_status == "PARTIAL" else ""
        error_detail = "deepGuard final coverage not present" if run_status == "PARTIAL" else ""
    else:
        phase, run_status = "FAILED", "FAILED"
        error_stage = "OUTPUT_SCHEMA"
        error_detail = f"unrecognized status root={root_status!r} deep={deep_status!r}"

    heartbeat_key = f"{SOURCE}|{source_dt.astimezone(BJT).strftime('%Y-%m-%dT%H')}|{phase}"

    latest_1h = first(data, "latestClosed1h", default=nested(data, "freshness.latestClosed1h", ""))
    latest_15m = first(data, "latestClosed15m", default=nested(data, "freshness.latestClosed15m", ""))
    cache_15m = first(data, "cache15mFreshness", default=nested(data, "freshness.cache15m", ""))

    broad_hits = as_int(first(deep, "broadHits", default=first(counts, "broadHits", "broad", default=0)))
    deep_count = as_int(first(deep, "deepCount", default=first(counts, "deepCount", "deep", default=0)))

    return {
        "RunTime_BJT": bjt_now(),
        "ModelVersion": str(first(data, "modelVersion", "model", default=os.getenv("HEARTBEAT_MODEL_VERSION", ""))),
        "RunStatus": run_status,
        "UniverseDenominator": as_int(first(counts, "universe", "universeDenominator", default=first(data, "universe", default=0))),
        "BroadHits": broad_hits,
        "DeepCount": deep_count,
        "StickyChecked": as_int(first(counts, "stickyChecked", "sticky", default=0)),
        "PositionsChecked": as_int(first(counts, "positionsChecked", "positions", default=0)),
        "DriveReadStatus": str(first(data, "driveReadStatus", default="VPS_LOCAL_CACHE")),
        "BinanceStatus": str(first(data, "binanceStatus", default="NOT_CALLED_BY_HEARTBEAT_BRIDGE")),
        "SheetWritebackStatus": "SYNC_ATTEMPT",
        "NotificationStatus": "NOT_APPLICABLE",
        "ErrorStage": error_stage,
        "ErrorDetail": error_detail,
        "ScoreVersion": str(first(data, "scoreVersion", default=os.getenv("HEARTBEAT_SCORE_VERSION", ""))),
        "Source": SOURCE,
        "Slot_BJT": slot,
        "Phase": phase,
        "C5Count": as_int(first(counts, "C5", "c5", "C5Count", default=0)),
        "C3Count": as_int(first(counts, "C3", "c3", "C3Count", default=0)),
        "C1Count": as_int(first(counts, "C1", "c1", "C1Count", default=0)),
        "CFocusCount": as_int(first(counts, "CFocus", "cFocus", "CFocusCount", default=0)),
        "DLongCount": as_int(first(counts, "D_LONG", "DLong", "dLong", "DLongCount", default=0)),
        "DShortCount": as_int(first(counts, "D_SHORT", "DShort", "dShort", "DShortCount", default=0)),
        "DFocusLongCount": as_int(first(counts, "DFocusLong", "dFocusLong", "DFocusLongCount", default=0)),
        "DFocusShortCount": as_int(first(counts, "DFocusShort", "dFocusShort", "DFocusShortCount", default=0)),
        "SanityStrongTrendCount": as_int(first(counts, "sanityStrongTrend", "SanityStrongTrendCount", default=0)),
        "SanityShortSqueezeCount": as_int(first(counts, "sanityShortSqueeze", "SanityShortSqueezeCount", default=0)),
        "CandidatePipelineGap": bool(first(data, "pipelineGap", "candidatePipelineGap", default=False)),
        "LatestClosed1h": latest_1h or "",
        "LatestClosed15m": latest_15m or "",
        "Cache15mFreshness": cache_15m or "",
        "ACount": as_int(first(counts, "A", "a", "ACount", default=0)),
        "BCount": as_int(first(counts, "B", "b", "BCount", default=0)),
        "SecondChanceCount": as_int(first(counts, "secondChance", "SecondChanceCount", default=0)),
        "HeartbeatKey": heartbeat_key,
    }

def write_json_atomic(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)

def post_json(url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(
        url=url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("webhook returned non-object JSON")
    return parsed

def deliver(url: str, secret: str, payload: dict[str, Any], timeout: float, attempts: int) -> dict[str, Any]:
    body = dict(payload)
    body["secret"] = secret
    last_error: Exception | None = None
    for i in range(attempts):
        try:
            response = post_json(url, body, timeout)
            if not response.get("ok"):
                raise RuntimeError(f"webhook rejected payload: {response}")
            return response
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
            if i + 1 < attempts:
                time.sleep(min(2 ** i, 4))
    assert last_error is not None
    raise last_error

def main() -> int:
    ap = argparse.ArgumentParser(description="Mirror VPS Focus V23 heartbeat to Google Sheet webhook without touching Binance.")
    ap.add_argument("--focus-json", default=os.getenv("HEARTBEAT_FOCUS_JSON", DEFAULT_FOCUS_JSON))
    ap.add_argument("--state-dir", default=os.getenv("HEARTBEAT_STATE_DIR", DEFAULT_STATE_DIR))
    ap.add_argument("--validate-only", action="store_true")
    ap.add_argument("--print-payload", action="store_true")
    args = ap.parse_args()

    webhook_url = os.getenv("HEARTBEAT_WEBHOOK_URL", "").strip()
    secret = os.getenv("HEARTBEAT_WEBHOOK_SECRET", "").strip()
    timeout = float(os.getenv("HEARTBEAT_HTTP_TIMEOUT", "10"))
    attempts = max(1, int(os.getenv("HEARTBEAT_HTTP_ATTEMPTS", "3")))
    state_dir = Path(args.state_dir)

    if args.validate_only:
        if not webhook_url or not secret:
            eprint("SYNC_PENDING_NO_CREDENTIAL: HEARTBEAT_WEBHOOK_URL/SECRET not configured")
            return 0
        try:
            response = deliver(webhook_url, secret, {"validate_only": True}, timeout, attempts)
            print(json.dumps(response, ensure_ascii=False, sort_keys=True))
            return 0
        except Exception as exc:
            eprint(f"VALIDATE_FAILED: {exc}")
            return 2

    focus_path = Path(args.focus_json)
    try:
        data = read_json(focus_path)
        payload = build_payload(data)
    except Exception as exc:
        eprint(f"LOCAL_HEARTBEAT_BUILD_FAILED: {exc}")
        return 3

    key = str(payload["HeartbeatKey"])
    authoritative = state_dir / "authoritative" / f"{sanitize_key(key)}.json"
    write_json_atomic(authoritative, payload)

    if args.print_payload:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))

    if not webhook_url or not secret:
        pending = dict(payload)
        pending["SheetWritebackStatus"] = "SYNC_PENDING_NO_CREDENTIAL"
        write_json_atomic(state_dir / "pending" / f"{sanitize_key(key)}.json", pending)
        eprint(f"SYNC_PENDING_NO_CREDENTIAL key={key} local={authoritative}")
        return 0

    try:
        response = deliver(webhook_url, secret, payload, timeout, attempts)
        receipt = {"heartbeat": payload, "webhookResponse": response, "syncedAt_BJT": bjt_now()}
        write_json_atomic(state_dir / "synced" / f"{sanitize_key(key)}.json", receipt)
        pending_path = state_dir / "pending" / f"{sanitize_key(key)}.json"
        try:
            pending_path.unlink()
        except FileNotFoundError:
            pass
        print(json.dumps({"ok": True, "heartbeatKey": key, "action": response.get("action"), "row": response.get("row")}, ensure_ascii=False))
        return 0
    except Exception as exc:
        pending = dict(payload)
        pending["SheetWritebackStatus"] = "SYNC_PENDING"
        pending["ErrorStage"] = "HEARTBEAT_BRIDGE"
        pending["ErrorDetail"] = str(exc)[:1000]
        write_json_atomic(state_dir / "pending" / f"{sanitize_key(key)}.json", pending)
        eprint(f"SYNC_PENDING key={key} error={exc} local={authoritative}")
        return 0

if __name__ == "__main__":
    raise SystemExit(main())
