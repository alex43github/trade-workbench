import assert from "node:assert/strict";
import test from "node:test";
import { detectFocusMa30Event } from "../lib/structure-radar/focus-ma30.ts";

test("LONG 15m close crossing from at/below MA30 to above emits reclaim", () => {
  const event = detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "15m", bias: "LONG",
    previousBar: { close: 99, time: 1000 }, currentBar: { close: 101, time: 1900 }, previousMa30: 100, currentMa30: 100,
  });
  assert.equal(event?.eventType, "15M_MA30_RECLAIM");
  assert.equal(event?.eventKey, "ma30:ENAUSDT:15m:1900:15M_MA30_RECLAIM");
});

test("LONG 1h close crossing from at/above MA30 to below emits loss", () => {
  const event = detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "1h", bias: "LONG",
    previousBar: { close: 101, time: 3600 }, currentBar: { close: 98, time: 7200 }, previousMa30: 100, currentMa30: 100,
  });
  assert.equal(event?.eventType, "1H_MA30_LOSS");
});

test("5m raw MA30 cross never emits mandatory event", () => {
  assert.equal(detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "5m", bias: "LONG",
    previousBar: { close: 99, time: 300 }, currentBar: { close: 101, time: 600 }, previousMa30: 100, currentMa30: 100,
  }), null);
});

test("same event key is suppressed after restart watermark reload", () => {
  const input = { symbol: "ENAUSDT", timeframe: "15m", bias: "LONG", previousBar: { close: 99, time: 1000 }, currentBar: { close: 101, time: 1900 }, previousMa30: 100, currentMa30: 100 };
  const first = detectFocusMa30Event(input);
  assert.ok(first);
  assert.equal(detectFocusMa30Event({ ...input, lastEventKey: first.eventKey }), null);
});

test("non-LONG focus symbol does not emit mandatory MA30 alert in v1", () => {
  assert.equal(detectFocusMa30Event({ symbol: "ENAUSDT", timeframe: "15m", bias: "UNKNOWN",
    previousBar: { close: 99, time: 1000 }, currentBar: { close: 101, time: 1900 }, previousMa30: 100, currentMa30: 100,
  }), null);
});
