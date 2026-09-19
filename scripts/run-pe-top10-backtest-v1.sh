#!/usr/bin/env bash
set -Eeuo pipefail

CACHE="/var/lib/trade-workbench/market-cache/15m-history-v1"
ENGINE="/opt/trade-workbench/scripts/pe-top10-ma30-atr-backtest-v1.py"
OUT="/var/lib/trade-workbench/research/pe/backtest-output/v1"
PUB_REL="research/pe-backtest/v1"
RAW="https://raw.githubusercontent.com/alex43github/trade-workbench/main/scripts/pe-top10-ma30-atr-backtest-v1.py"

echo "============================================================"
echo " PE TOP10 × MA30/ATR 10x V1 DEPLOY + RUN + PUBLISH"
echo "============================================================"

echo
echo "===== 1. PRECHECK 15M CACHE ====="
python3 - <<'PY'
import json
from pathlib import Path
p=Path("/var/lib/trade-workbench/market-cache/15m-history-v1/STATUS.json")
d=json.loads(p.read_text(encoding="utf-8"))
print(json.dumps(d, ensure_ascii=False, indent=2))
if d.get("status")!="COMPLETE" or d.get("missingCount")!=0 or d.get("completed")!=527:
    raise SystemExit("FATAL: 15m cache is not COMPLETE 527/527")
PY

echo
echo "===== 2. INSTALL COMPUTE ENGINE ====="
mkdir -p "$(dirname "$ENGINE")" "$OUT"
curl -fsSL "$RAW" -o "$ENGINE"
chmod 755 "$ENGINE"
python3 -m py_compile "$ENGINE"
echo "ENGINE_INSTALL=OK"

echo
echo "===== 3. RUN DETERMINISTIC BACKTEST ====="
python3 "$ENGINE" --cache "$CACHE" --out "$OUT" --rebuild-candidates

echo
echo "===== 4. LOCAL ARTIFACT AUDIT ====="
python3 - <<'PY'
import json, hashlib
from pathlib import Path
out=Path("/var/lib/trade-workbench/research/pe/backtest-output/v1")
required=["READY.json","manifest.json","audit.json","total_summary.json","Trades.csv","Daily_Summary.csv"]
missing=[x for x in required if not (out/x).exists()]
if missing:
    raise SystemExit("FATAL missing artifacts: "+",".join(missing))
ready=json.loads((out/"READY.json").read_text(encoding="utf-8"))
audit=json.loads((out/"audit.json").read_text(encoding="utf-8"))
manifest=json.loads((out/"manifest.json").read_text(encoding="utf-8"))
if ready.get("Status")!="READY":
    raise SystemExit("FATAL READY status is not READY")
if audit.get("ErrorCount")!=0:
    raise SystemExit("FATAL audit errors are nonzero")
if manifest.get("SchemaVersion")!="pe-top10-ma30-atr-10x-v1":
    raise SystemExit("FATAL schema version mismatch")
chunks=manifest.get("Chunks",[])
if not chunks:
    raise SystemExit("FATAL no chunks")
for c in chunks:
    p=out/c["File"]
    if not p.exists():
        raise SystemExit("FATAL missing chunk "+str(p))
    if hashlib.sha256(p.read_bytes()).hexdigest()!=c["SHA256"]:
        raise SystemExit("FATAL SHA mismatch "+p.name)
print(json.dumps({
  "Status":"READY",
  "TradeRows":ready.get("TradeRows"),
  "DailyRows":ready.get("DailyRows"),
  "ChunkCount":ready.get("ChunkCount"),
  "AuditErrors":audit.get("ErrorCount")
}, ensure_ascii=False, indent=2))
print("LOCAL_BACKTEST_STATUS=READY")
PY

echo
echo "===== 5. DISCOVER GITHUB CHECKOUT ====="
REPO=""
for d in /opt/trade-workbench-src /opt/trade-workbench /root/trade-workbench; do
  if [ -d "$d/.git" ]; then
    url="$(git -C "$d" remote get-url origin 2>/dev/null || true)"
    case "$url" in
      *alex43github/trade-workbench*) REPO="$d"; break ;;
    esac
  fi
done

if [ -z "$REPO" ]; then
  REPO="/tmp/trade-workbench-pe-publish"
  rm -rf "$REPO"
  git clone -q "https://github.com/alex43github/trade-workbench.git" "$REPO"
fi

echo "PUBLISH_REPO=$REPO"
git -C "$REPO" remote -v || true

echo
echo "===== 6. PREPARE PUBLIC ARTIFACT TREE ====="
mkdir -p "$REPO/$PUB_REL"
rm -rf "$REPO/$PUB_REL/chunks"
mkdir -p "$REPO/$PUB_REL/chunks"
cp -f "$OUT/READY.json" "$REPO/$PUB_REL/"
cp -f "$OUT/manifest.json" "$REPO/$PUB_REL/"
cp -f "$OUT/audit.json" "$REPO/$PUB_REL/"
cp -f "$OUT/total_summary.json" "$REPO/$PUB_REL/"
cp -f "$OUT/Trades.csv" "$REPO/$PUB_REL/"
cp -f "$OUT/Daily_Summary.csv" "$REPO/$PUB_REL/"
cp -f "$OUT"/chunks/*.json "$REPO/$PUB_REL/chunks/"

echo
echo "===== 7. COMMIT ARTIFACTS ====="
git -C "$REPO" add "$PUB_REL"
if git -C "$REPO" diff --cached --quiet; then
  echo "PUBLISH_GIT_STATUS=NO_CHANGES"
else
  git -C "$REPO" -c user.name="trade-workbench-vps" -c user.email="trade-workbench-vps@local" commit -m "Publish PE Top10 MA30 ATR backtest v1 artifacts"
fi

echo
echo "===== 8. PUSH ARTIFACTS ====="
if git -C "$REPO" push origin HEAD:main; then
  echo "PE_BACKTEST_V1_PUBLISHED=READY"
  echo "GitHub path: $PUB_REL"
else
  echo "LOCAL_BACKTEST_STATUS=READY"
  echo "PUBLISH_STATUS=BLOCKED_GITHUB_PUSH"
  echo "Artifacts are preserved at: $OUT"
  exit 0
fi
