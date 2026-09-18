#!/usr/bin/env python3
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

VERSION = "VPS_BRIDGE_EXECUTOR_V1"
ALLOWED_SERVICES = ("squeeze-radar.service", "trade-workbench.service")
RADAR_HEALTH_URL = os.environ.get("RADAR_HEALTH_URL", "http://127.0.0.1:8790/health")
INSTALL_DIR = Path("/opt/trade-workbench-ai-bridge")
BACKUP_DIR = Path("/var/backups/trade-workbench-ai-bridge")
RAW_BASE = "https://raw.githubusercontent.com/alex43github/trade-workbench"
REF_RE = re.compile(r"^[A-Za-z0-9._/-]{1,128}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

def run(args, timeout=20):
    proc = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=False)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()

def service_state(name):
    rc, out, _ = run(["/usr/bin/systemctl", "is-active", name])
    return out if out else ("unknown" if rc else "active")

def health_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "trade-workbench-ai-bridge/1"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read(256_000).decode()
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {"reachable": True, "status": "non_object"}
        feed = data.get("feed") if isinstance(data.get("feed"), dict) else {}
        return {
            "reachable": True,
            "status": data.get("status"),
            "symbols": data.get("symbols"),
            "bootstrapFailures": data.get("bootstrapFailures"),
            "feedUnhealthyBatches": feed.get("unhealthyBatches"),
            "realOrderRouteEnabled": data.get("realOrderRouteEnabled"),
            "notifications": data.get("notifications"),
        }
    except Exception as exc:
        return {"reachable": False, "error": type(exc).__name__}

def action_health(_payload):
    _, hostname, _ = run(["/usr/bin/hostname"])
    _, utc, _ = run(["/usr/bin/date", "-u", "+%Y-%m-%dT%H:%M:%SZ"])
    return {
        "ok": True,
        "summary": {
            "bridgeVersion": VERSION,
            "hostname": hostname,
            "utc": utc,
            "services": {name: service_state(name) for name in ALLOWED_SERVICES},
            "radarHealth": health_json(RADAR_HEALTH_URL),
            "modified": False,
        },
    }

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()

def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "trade-workbench-ai-bridge/1"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()

def action_update_executor(payload):
    if payload.get("approved") is not True:
        raise ValueError("approved=true required")
    ref = str(payload.get("ref", "")).strip()
    expected = str(payload.get("sha256", "")).strip().lower()
    if not REF_RE.fullmatch(ref):
        raise ValueError("invalid ref")
    if not SHA256_RE.fullmatch(expected):
        raise ValueError("valid expected sha256 required")
    url = f"{RAW_BASE}/{ref}/ops/vps-ai-bridge/executor.py"
    data = download(url)
    actual = sha256_bytes(data)
    if actual != expected:
        raise ValueError(f"sha256 mismatch: {actual}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    current = INSTALL_DIR / "executor.py"
    backup = BACKUP_DIR / f"executor.py.{VERSION}.bak"
    if current.exists() and not backup.exists():
        backup.write_bytes(current.read_bytes())
        os.chmod(backup, 0o700)
    tmp = INSTALL_DIR / "executor.py.new"
    tmp.write_bytes(data)
    os.chmod(tmp, 0o700)
    tmp.replace(current)
    return {
        "ok": True,
        "summary": {
            "updated": "executor.py",
            "ref": ref,
            "sha256": actual,
            "backup": str(backup),
            "restartRequired": False,
        },
    }

ACTIONS = {
    "health": action_health,
    "update_executor": action_update_executor,
}

def main():
    if len(sys.argv) != 2:
        raise SystemExit("one JSON payload argument required")
    payload = json.loads(sys.argv[1])
    if not isinstance(payload, dict):
        raise SystemExit("payload must be object")
    action = payload.get("action")
    handler = ACTIONS.get(action)
    if handler is None:
        raise SystemExit("action not allowed")
    result = handler(payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))

if __name__ == "__main__":
    main()
