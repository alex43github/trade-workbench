import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");

test("shared site surfaces expose readable typography tokens", () => {
  for (const file of ["app/advisory.module.css", "app/trade/trade.module.css", "app/globals.css"]) {
    const css = read(file);
    assert.match(css, /--ui-body:\s*14px/);
    assert.match(css, /--ui-meta:\s*11px/);
  }
});

test("all primary shells expose the shared font control", () => {
  const files = ["app/trade/TradingTerminal.tsx", "app/radar/page.tsx", "app/components/AdvisoryShell.tsx"];
  for (const file of files) assert.match(read(file), /FontControl/);
  assert.match(read("app/uiPreferences.ts"), /streetlight-font-scale/);
});

test("advisory dashboard and consultation use the radar light visual system by default", () => {
  const advisoryCss = read("app/advisory.module.css");
  const consultation = read("app/consultations/ConsultationChart.tsx");
  assert.match(advisoryCss, /\.shell\{--bg:#f6f4fb;--side:#eeeafb;--panel:#fff;/);
  assert.match(advisoryCss, /\.shell\[data-theme="dark"\]\{--bg:#090b10;/);
  assert.match(consultation, /theme=\{resolvedTheme\}/);
});

test("font control inherits the active page palette instead of a dark fallback", () => {
  const fontControlCss = read("app/components/FontControl.module.css");
  assert.match(fontControlCss, /var\(--rt-panel/);
  assert.match(fontControlCss, /var\(--panel2/);
});
