#!/usr/bin/env bash
set -Eeuo pipefail

CACHE="/var/lib/trade-workbench/market-cache/15m-history-v1"
OUT="/var/lib/trade-workbench/research/pe/backtest-output/v1"
ENGINE="/opt/trade-workbench/scripts/pe-top10-ma30-atr-backtest-v1.py"
PUB="/var/lib/trade-workbench/pe-backtest-publish-repo"
REPO="alex43github/trade-workbench"
RAW="https://raw.githubusercontent.com/\${REPO}/main/scripts/pe-top10-ma30-atr-backtest-v1.py"

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
print(json.dumps(d,ensure_ascii=False,indent=2))
if d.get("status")!="COMPLETE" or d.get("missingCount")!=0 or d.get("completeCount")!=527:
    raise SystemExit("15M CACHE NOT READY")
PY

echo
echo "===== 2. INSTALL COMPUTE ENGINE ====="
mkdir -p "$(dirname "$ENGINE")" "$OUT"
curl -fsSL "$RAW" -o "$ENGINE"
chmod 755 "$ENGINE"
python3 -m py_compile "$ENGINE"
echo "ENGINE_OK=$ENGINE"

echo
echo "===== 3. RUN FULL 170D DETERMINISTIC BACKTEST ====="
rm -f "$OUT/candidates.sqlite"
python3 "$ENGINE" --cache "$CACHE" --out "$OUT" --rebuild-candidates

echo
echo "===== 4. LOCAL AUDIT ====="
cat "$OUT/READY.json"
echo
cat "$OUT/audit.json"
echo
cat "$OUT/total_summary.json"

python3 - <<'PY'
import json
from pathlib import Path
p=Path("/var/lib/trade-workbench/research/pe/backtest-output/v1/READY.json")
d=json.loads(p.read_text(encoding="utf-8"))
if d.get("Status")!="READY":
    raise SystemExit("BACKTEST NOT READY")
a=json.loads(Path("/var/lib/trade-workbench/research/pe/backtest-output/v1/audit.json").read_text(encoding="utf-8"))
if a.get("ErrorCount")!=0:
    raise SystemExit("AUDIT FAILED")
print("LOCAL_BACKTEST_STATUS=READY")
PY

echo
echo "===== 5. PREPARE DEDICATED GITHUB PUBLISH CLONE ====="
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
  echo "GH_AUTH=OK"
else
  echo "GH_AUTH=NOT_CONFIRMED"
fi

if [ ! -d "$PUB/.git" ]; then
  rm -rf "$PUB"
  git clone "https://github.com/\${REPO}.git" "$PUB"
else
  git -C "$PUB" fetch origin main
  git -C "$PUB" checkout -f main
  git -C "$PUB" reset --hard origin/main
fi

echo
echo "===== 6. COPY ONLY SMALL AUDITABLE OUTPUTS ====="
DEST="$PUB/research/pe-backtest/v1"
rm -rf "$DEST"
mkdir -p "$DEST/chunks"

cp "$OUT/manifest.json" "$DEST/"
cp "$OUT/READY.json" "$DEST/"
cp "$OUT/audit.json" "$DEST/"
cp "$OUT/total_summary.json" "$DEST/"
cp "$OUT/Trades.csv" "$DEST/"
cp "$OUT/Daily_Summary.csv" "$DEST/"
cp "$OUT"/chunks/*.json "$DEST/chunks/"

echo "Published file count:"
find "$DEST" -type f | wc -l
du -sh "$DEST"

echo
echo "===== 7. COMMIT + PUSH ====="
git -C "$PUB" config user.name "trade-workbench-vps"
git -C "$PUB" config user.email "trade-workbench-vps@users.noreply.github.com"

git -C "$PUB" add research/pe-backtest/v1

if git -C "$PUB" diff --cached --quiet; then
  echo "GITHUB_COMMIT=NO_CHANGES"
else
  git -C "$PUB" commit -m "Publish PE Top10 MA30 ATR 10x backtest v1"
fi

git -C "$PUB" push origin main

echo
echo "===== 8. VERIFY PUBLIC ARTIFACT ====="
curl -fsSL "https://raw.githubusercontent.com/\${REPO}/main/research/pe-backtest/v1/READY.json"
echo
curl -fsSL "https://raw.githubusercontent.com/\${REPO}/main/research/pe-backtest/v1/manifest.json" | python3 -m json.tool | head -80

echo
echo "============================================================"
echo "PE_BACKTEST_V1_PUBLISHED=READY"
echo "GitHub path: research/pe-backtest/v1"
echo "Local output: $OUT"
echo "============================================================"
