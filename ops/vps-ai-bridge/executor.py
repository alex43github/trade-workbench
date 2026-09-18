#!/usr/bin/env python3
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

VERSION = "VPS_BRIDGE_EXECUTOR_V7"
ALLOWED_SERVICES = ("squeeze-radar.service", "trade-workbench.service")
RADAR_HEALTH_URL = os.environ.get("RADAR_HEALTH_URL", "http://127.0.0.1:8790/health")
RADAR_SIGNALS_URL = os.environ.get("RADAR_SIGNALS_URL", "http://127.0.0.1:8790/signals")
INSTALL_DIR = Path("/opt/trade-workbench-ai-bridge")
BACKUP_DIR = Path("/var/backups/trade-workbench-ai-bridge")
RAW_BASE = "https://raw.githubusercontent.com/alex43github/trade-workbench"
REF_RE = re.compile(r"^[A-Za-z0-9._/-]{1,128}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
WORKBENCH_ROOT = Path("/opt/trade-workbench")
MA30_BACKUP_ROOT = Path("/var/backups/trade-workbench/ma30-astps")
MA30_STATE_ROOT = Path("/var/lib/trade-workbench/ma30-astps-deploy")
MA30_DEPLOY_PATHS = (
    "lib/radar/ma30-universe.ts",
    "lib/radar/ma30-scanner.ts",
    "lib/radar/ma30-priority-watchlist.ts",
    "lib/radar/ma30-model-types.ts",
    "lib/radar/ma30-astps-bridge.ts",
    "lib/radar/ma30-notifications.ts",
    "lib/radar/ma30-production-cycle.ts",
    "lib/radar/ma30-vps-runtime.ts",
    "lib/radar/ma30-production-notifications.ts",
    "scripts/ma30-production-live-safe.ts",
)
MA30_TEST_PATHS = (
    "tests/ma30-scanner.test.mjs",
    "tests/ma30-priority-watchlist.test.mjs",
    "tests/ma30-astps-bridge.test.mjs",
    "tests/ma30-production-cycle.test.mjs",
    "tests/ma30-production-notifications.test.mjs",
)

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


def action_radar_signals_summary(_payload):
    try:
        req = urllib.request.Request(RADAR_SIGNALS_URL, headers={"User-Agent": "trade-workbench-ai-bridge/2"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.load(resp)
        rows = data.get("signals", []) if isinstance(data, dict) else []
        if not isinstance(rows, list):
            rows = []
        states = {}
        setups = {}
        timeframes = {}
        enriched = 0
        consultation = 0
        consensus = 0
        sample_keys = set()
        consensus_keys = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            state = str(row.get("state"))
            setup = str(row.get("setup"))
            timeframe = str(row.get("timeframe"))
            states[state] = states.get(state, 0) + 1
            setups[setup] = setups.get(setup, 0) + 1
            timeframes[timeframe] = timeframes.get(timeframe, 0) + 1
            if "position" in row or "consultation" in row:
                enriched += 1
            cons = row.get("consultation")
            if isinstance(cons, dict):
                consultation += 1
                sample_keys.update(str(k) for k in row.keys())
                con = cons.get("consensus")
                if isinstance(con, dict):
                    consensus += 1
                    consensus_keys.update(str(k) for k in con.keys())
        return {
            "ok": True,
            "summary": {
                "signals": len(rows),
                "states": states,
                "setups": setups,
                "timeframes": timeframes,
                "enrichedSignals": enriched,
                "withConsultation": consultation,
                "withConsensus": consensus,
                "sampleSignalKeys": sorted(sample_keys),
                "consensusKeys": sorted(consensus_keys),
                "modified": False,
            },
        }
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "summary": {
                "error": "JSONDecodeError",
                "bodyBytes": len(raw.encode()) if "raw" in locals() else None,
                "bodyPrefix": (raw[:120].replace("\\n", " ") if "raw" in locals() else None),
                "modified": False,
            },
        }
    except urllib.error.HTTPError as exc:
        return {"ok": False, "summary": {"error": "HTTPError", "status": exc.code, "modified": False}}
    except Exception as exc:
        return {"ok": False, "summary": {"error": type(exc).__name__, "modified": False}}

def action_runtime_layout(_payload):
    def unit_meta(name):
        rc, out, _ = run([
            "/usr/bin/systemctl", "show", name,
            "--property=FragmentPath,WorkingDirectory,ExecStart,LoadState,ActiveState",
            "--no-pager",
        ])
        values = {}
        if rc == 0:
            for line in out.splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    values[k] = v
        return values
    root = Path("/opt/trade-workbench")
    deployed_commit = None
    try:
        deployed_commit = (root / ".deployed-commit").read_text().strip()[:80]
    except Exception:
        pass
    names = []
    try:
        names = sorted(item.name for item in root.iterdir())[:80]
    except Exception:
        pass
    return {
        "ok": True,
        "summary": {
            "optTradeWorkbenchExists": root.exists(),
            "topLevelEntries": names,
            "units": {name: unit_meta(name) for name in ALLOWED_SERVICES},
            "gitDirectoryExists": (root / ".git").exists(),
            "deployedCommit": deployed_commit,
            "modified": False,
        },
    }

def action_repo_status(_payload):
    rc, head, _ = run(["/usr/bin/git", "-C", "/opt/trade-workbench", "rev-parse", "HEAD"])
    rc2, branch, _ = run(["/usr/bin/git", "-C", "/opt/trade-workbench", "branch", "--show-current"])
    rc3, status, _ = run(["/usr/bin/git", "-C", "/opt/trade-workbench", "status", "--porcelain"])
    return {
        "ok": rc == 0,
        "summary": {
            "head": head if rc == 0 else None,
            "branch": branch if rc2 == 0 else None,
            "dirtyEntries": len([line for line in status.splitlines() if line.strip()]) if rc3 == 0 else None,
            "modified": False,
        },
    }


def action_ma30_status(_payload):
    units = (
        "trade-workbench-ma30-scanner.timer",
        "trade-workbench-ma30-scanner.service",
        "trade-workbench-ma30-priority-watcher.timer",
        "trade-workbench-ma30-priority-watcher.service",
        "trade-workbench-radar-priority-watcher.timer",
        "trade-workbench-radar-priority-watcher.service",
    )
    result = {}
    for name in units:
        rc, load, _ = run(["/usr/bin/systemctl", "show", name, "--property=LoadState", "--value"])
        if rc != 0 or load == "not-found":
            continue
        _, active, _ = run(["/usr/bin/systemctl", "is-active", name])
        _, enabled, _ = run(["/usr/bin/systemctl", "is-enabled", name])
        result[name] = {"active": active, "enabled": enabled, "loadState": load}
    return {"ok": True, "summary": {"units": result, "modified": False}}

def _safe_extract_tar_gz(data, destination):
    archive_path = destination / "source.tar.gz"
    archive_path.write_bytes(data)
    extract_root = destination / "src"
    extract_root.mkdir()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            target = (extract_root / member.name).resolve()
            if extract_root.resolve() not in target.parents and target != extract_root.resolve():
                raise ValueError("unsafe archive path")
        archive.extractall(extract_root)
    roots = [item for item in extract_root.iterdir() if item.is_dir()]
    if len(roots) != 1:
        raise ValueError("unexpected archive root")
    return roots[0]

def _manifest_for(paths):
    rows = []
    for relative in paths:
        target = WORKBENCH_ROOT / relative
        if not target.exists():
            rows.append({"path": relative, "exists": False})
            continue
        stat = target.stat()
        rows.append({
            "path": relative,
            "exists": True,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "mode": stat.st_mode & 0o777,
            "uid": stat.st_uid,
            "gid": stat.st_gid,
        })
    return rows

def _backup_ma30(paths, commit):
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = MA30_BACKUP_ROOT / f"{stamp}-{commit[:12]}"
    backup.mkdir(parents=True, exist_ok=False)
    manifest = _manifest_for(paths)
    for row in manifest:
        if not row["exists"]:
            continue
        source = WORKBENCH_ROOT / row["path"]
        destination = backup / row["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    manifest_path = backup / "manifest.json"
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    manifest_path.write_bytes(manifest_bytes)
    return backup, hashlib.sha256(manifest_bytes).hexdigest(), manifest

def _install_ma30(source_root, paths):
    reference = WORKBENCH_ROOT / "lib/radar/ma30-scanner.ts"
    ref_stat = reference.stat()
    installed = []
    for relative in paths:
        source = source_root / relative
        if not source.is_file():
            raise ValueError(f"missing deploy file: {relative}")
        destination = WORKBENCH_ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            stat = destination.stat()
            mode, uid, gid = stat.st_mode & 0o777, stat.st_uid, stat.st_gid
        else:
            mode, uid, gid = 0o644, ref_stat.st_uid, ref_stat.st_gid
        temporary = destination.with_name(destination.name + ".bridge-new")
        shutil.copyfile(source, temporary)
        os.chmod(temporary, mode)
        os.chown(temporary, uid, gid)
        os.replace(temporary, destination)
        installed.append(relative)
    return installed

def _restore_ma30(backup, manifest):
    for row in manifest:
        destination = WORKBENCH_ROOT / row["path"]
        if row["exists"]:
            source = backup / row["path"]
            temporary = destination.with_name(destination.name + ".bridge-rollback")
            shutil.copyfile(source, temporary)
            os.chmod(temporary, int(row["mode"]))
            os.chown(temporary, int(row["uid"]), int(row["gid"]))
            os.replace(temporary, destination)
        elif destination.exists():
            destination.unlink()

def _last_ma30_journal():
    rc, out, err = run([
        "/usr/bin/journalctl", "-u", "trade-workbench-ma30-scanner.service",
        "-n", "120", "--no-pager", "--output=cat",
    ], timeout=20)
    if rc != 0:
        return {}
    prefixes = (
        "RESULT_STATUS=", "RUN_ID=", "RUN_TIME_BJT=", "SCAN_STATUS=",
        "EXCLUDED_STABLECOINS=", "ASTPS_STATUS=", "ASTPS_MODEL=",
        "ASTPS_CANDIDATES=", "ASTPS_VALIDATED=", "ASTPS_A=", "ASTPS_B=",
        "UNIVERSE=", "FETCH_OK=", "SLOPE_OK=", "FAILED=", "STALE=",
        "A=", "B=", "C=", "SHORT=", "AI=", "NO_TRADING_ACTIONS=",
        "DUPLICATE=",
    )
    evidence = {}
    for line in out.splitlines():
        stripped = line.strip()
        for prefix in prefixes:
            if stripped.startswith(prefix):
                key, value = stripped.split("=", 1)
                evidence[key] = value
    return evidence


def action_ma30_isolated_validation(_payload):
    validation_root = Path("/var/lib/trade-workbench/ma30-validation")
    validation_root.mkdir(parents=True, exist_ok=True)
    parent_stat = Path("/var/lib/trade-workbench").stat()
    os.chown(validation_root, parent_stat.st_uid, parent_stat.st_gid)
    os.chmod(validation_root, 0o700)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    db_path = validation_root / f"{stamp}.sqlite"
    unit = f"trade-workbench-ma30-validation-{stamp.lower()}"
    args = [
        "/usr/bin/systemd-run",
        "--unit", unit,
        "--wait",
        "--pipe",
        "--collect",
        "--property=Type=oneshot",
        "--property=User=trade-workbench",
        "--property=Group=trade-workbench",
        "--property=WorkingDirectory=/opt/trade-workbench",
        "--property=NoNewPrivileges=true",
        "--property=PrivateTmp=true",
        "--property=ProtectHome=true",
        "--property=ProtectSystem=strict",
        "--property=ReadWritePaths=/var/lib/trade-workbench/ma30-validation",
        f"--setenv=STREETLIGHT_LOCAL_D1={db_path}",
        "/usr/bin/node",
        "--experimental-strip-types",
        "--use-env-proxy",
        "/opt/trade-workbench/scripts/ma30-production-live-safe.ts",
    ]
    rc, out, err = run(args, timeout=900)
    evidence = {}
    prefixes = (
        "RESULT_STATUS=", "RUN_ID=", "RUN_TIME_BJT=", "NOTIFICATION_MODE=",
        "SCAN_STATUS=", "EXCLUDED_STABLECOINS=", "ASTPS_STATUS=", "ASTPS_MODEL=",
        "ASTPS_CANDIDATES=", "ASTPS_VALIDATED=", "ASTPS_A=", "ASTPS_B=",
        "UNIVERSE=", "FETCH_OK=", "SLOPE_OK=", "FAILED=", "STALE=",
        "A=", "B=", "C=", "SHORT=", "AI=", "LIFECYCLE_EVENTS=",
        "LOGICAL_BARK_GROUPS=", "PERSISTED=", "NO_TRADING_ACTIONS=",
    )
    for line in (out + "\n" + err).splitlines():
        stripped = line.strip()
        for prefix in prefixes:
            if stripped.startswith(prefix):
                key, value = stripped.split("=", 1)
                evidence[key] = value
    for suffix in ("", "-wal", "-shm"):
        try:
            path = Path(str(db_path) + suffix)
            if path.exists():
                path.unlink()
        except Exception:
            pass
    checks = {
        "completed": evidence.get("RESULT_STATUS") == "COMPLETED",
        "dryRun": evidence.get("NOTIFICATION_MODE") == "DRY_RUN",
        "fullScan": evidence.get("SCAN_STATUS") == "FULL",
        "stablecoinsExcluded": int(evidence.get("EXCLUDED_STABLECOINS", "0") or 0) > 0,
        "astpsReady": evidence.get("ASTPS_STATUS") == "READY",
        "noTradingActions": evidence.get("NO_TRADING_ACTIONS") == "1",
        "noFetchFailures": evidence.get("FAILED") == "0",
        "noStaleCandles": evidence.get("STALE") == "0",
    }
    ok = rc == 0 and all(checks.values())
    return {
        "ok": ok,
        "summary": {
            "phase": "ISOLATED_DRY_RUN",
            "unit": unit,
            "exitCode": rc,
            "checks": checks,
            "evidence": evidence,
            "validationDbRemoved": not db_path.exists(),
            "modifiedProductionState": False,
            "sentBark": False,
            "stderrTail": "\n".join(err.splitlines()[-30:]) if err else "",
        },
    }

def action_deploy_ma30_astps(payload):
    if payload.get("approved") is not True:
        raise ValueError("approved=true required")
    commit = str(payload.get("commit", "")).strip().lower()
    if not COMMIT_RE.fullmatch(commit):
        raise ValueError("exact 40-hex commit required")

    before_radar = health_json(RADAR_HEALTH_URL)
    if before_radar.get("status") != "ok" or before_radar.get("realOrderRouteEnabled") is not False:
        raise RuntimeError("preflight radar safety gate failed")

    with tempfile.TemporaryDirectory(prefix="ma30-astps-", dir="/tmp") as tmp:
        tmp_path = Path(tmp)
        source_bytes = download(f"https://codeload.github.com/alex43github/trade-workbench/tar.gz/{commit}")
        source_root = _safe_extract_tar_gz(source_bytes, tmp_path)
        for relative in (*MA30_DEPLOY_PATHS, *MA30_TEST_PATHS):
            if not (source_root / relative).is_file():
                raise ValueError(f"candidate missing required file: {relative}")

        backup, manifest_hash, manifest = _backup_ma30(MA30_DEPLOY_PATHS, commit)
        installed = []
        rolled_back = False
        try:
            installed = _install_ma30(source_root, MA30_DEPLOY_PATHS)

            MA30_STATE_ROOT.mkdir(parents=True, exist_ok=True)
            marker = MA30_STATE_ROOT / "deployed-commit"
            marker.write_text(commit + "\n")
            os.chmod(marker, 0o600)

            start_rc, start_out, start_err = run(
                ["/usr/bin/systemctl", "start", "trade-workbench-ma30-scanner.service"],
                timeout=900,
            )
            journal = _last_ma30_journal()
            if start_rc != 0:
                raise RuntimeError("MA30 scanner start failed: " + (start_err or start_out)[-700:])
            if journal.get("RESULT_STATUS") == "COMPLETED" and journal.get("ASTPS_STATUS") != "READY":
                raise RuntimeError("MA30 completed without ASTPS READY")
            if journal.get("NO_TRADING_ACTIONS") not in (None, "1"):
                raise RuntimeError("unexpected trading action evidence")

            after_radar = health_json(RADAR_HEALTH_URL)
            if after_radar.get("status") != "ok" or after_radar.get("realOrderRouteEnabled") is not False:
                raise RuntimeError("postflight radar safety gate failed")

            return {"ok": True, "summary": {
                "phase": "DEPLOYED",
                "commit": commit,
                "backup": str(backup),
                "manifestSha256": manifest_hash,
                "installed": installed,
                "prevalidatedByGithubActions": True,
                "scannerEvidence": journal,
                "radarHealth": after_radar,
                "rolledBack": False,
                "modified": True,
            }}
        except Exception:
            _restore_ma30(backup, manifest)
            rolled_back = True
            try:
                marker = MA30_STATE_ROOT / "deployed-commit"
                if marker.exists():
                    marker.unlink()
            except Exception:
                pass
            raise

ACTIONS = {
    "health": action_health,
    "ma30_status": action_ma30_status,
    "ma30_isolated_validation": action_ma30_isolated_validation,
    "deploy_ma30_astps": action_deploy_ma30_astps,
    "radar_signals_summary": action_radar_signals_summary,
    "runtime_layout": action_runtime_layout,
    "repo_status": action_repo_status,
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
