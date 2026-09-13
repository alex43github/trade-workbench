import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const radarPage = fs.readFileSync(path.join(root, "app/radar/page.tsx"), "utf8");
const progressComponent = fs.readFileSync(path.join(root, "app/components/ManualProgress.tsx"), "utf8");
const globalStyles = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");

test("radar manual scans render progress feedback for every scan action", () => {
  assert.equal((radarPage.match(/<ManualProgress\b/g) ?? []).length, 4);
  assert.match(radarPage, /active=\{reversalScanning\}/);
  assert.match(radarPage, /active=\{ma30Scanning\}/);
  assert.match(radarPage, /active=\{atrBandScanning\}/);
});

test("manual scan progress exposes elapsed time and deterministic coin counts", () => {
  assert.match(progressComponent, /role="progressbar"/);
  assert.match(progressComponent, /aria-valuetext/);
  assert.match(progressComponent, /aria-valuenow/);
  assert.match(progressComponent, /totalSymbols/);
  assert.match(progressComponent, /scannedSymbols/);
  assert.match(progressComponent, /remainingSymbols/);
  assert.match(progressComponent, /matchedSymbols/);
  assert.match(progressComponent, /已用时/);
  assert.match(progressComponent, /预计/);
  assert.match(globalStyles, /\.manual-progress/);
  assert.match(globalStyles, /manual-progress-fill/);
  assert.match(radarPage, /progress=\{/);
});
