import assert from "node:assert/strict";
import test from "node:test";
import { createRadarDiagnostic, createRadarDiagnosticFromError } from "../lib/radar/scan-diagnostic.ts";

test("classifies a browser/network failure separately from insufficient data", () => {
  const diagnostic = createRadarDiagnostic(null, "Load failed", new Date("2026-08-27T14:31:10.000Z"));

  assert.equal(diagnostic.code, "NETWORK_ERROR");
  assert.equal(diagnostic.detail, "Load failed");
  assert.match(diagnostic.checks.join(" "), /本地扫描服务/);
});

test("classifies upstream rate limits with a retry action", () => {
  const diagnostic = createRadarDiagnostic(429, "Too Many Requests", new Date("2026-08-27T14:31:10.000Z"));

  assert.equal(diagnostic.code, "RATE_LIMITED");
  assert.match(diagnostic.checks.join(" "), /等待/);
});

test("tells anonymous VPS visitors to sign in before starting a scan", () => {
  const diagnostic = createRadarDiagnostic(401, "operator authentication required", new Date("2026-08-27T14:31:10.000Z"));

  assert.equal(diagnostic.code, "AUTH_REQUIRED");
  assert.match(diagnostic.checks.join(" "), /\/signin/);
  assert.match(diagnostic.checks.join(" "), /匿名访问/);
  assert.doesNotMatch(diagnostic.checks.join(" "), /localhost:3003/);
});

test("preserves structured Binance transport details in a scan diagnosis", () => {
  const error = Object.assign(new Error("Binance 公共行情不可达"), { status: 503, hint: "请检查服务器出口" });
  const diagnostic = createRadarDiagnosticFromError(error, "扫描失败", new Date("2026-08-27T14:31:10.000Z"));

  assert.equal(diagnostic.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(diagnostic.detail, "Binance 公共行情不可达：请检查服务器出口");
});
