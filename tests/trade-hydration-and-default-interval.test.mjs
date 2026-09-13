import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/trade/page.tsx", import.meta.url), "utf8");

test("交易页首屏不从浏览器缓存读取资金曲线，避免 SSR hydration 不一致", () => {
  assert.match(terminalSource, /useState<EquityPoint\[\]>\(\[\]\)/);
  assert.match(terminalSource, /useEffect\(\(\) => \{[\s\S]*streetlight-equity-v1[\s\S]*setEquityPoints/);
});

test("交易页未指定周期时默认打开 1 小时 K 线", () => {
  assert.match(pageSource, /: "1h"/);
  assert.match(terminalSource, /initialInterval = "1h"/);
});
