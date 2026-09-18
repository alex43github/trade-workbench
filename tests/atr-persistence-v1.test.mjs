import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBandRows,
  calculateWilderRma,
  calculateSlopeMetrics,
  countConsecutivePersistence,
  qualifiedLevels,
  scanExtremeTouches,
} from "../lib/radar/atr-persistence-v1.ts";


function row({
  time,
  closeExt = 0,
  highExt = closeExt,
  lowExt = closeExt,
}) {
  const ma30 = 100;
  const atr14 = 1;

  return {
    time,
    open: 100,
    high:
      ma30 + highExt * atr14,
    low:
      ma30 + lowExt * atr14,
    close:
      ma30 + closeExt * atr14,
    volume: 1,

    ma30,
    atr14,

    closeExtensionAtr:
      closeExt,

    highExtensionAtr:
      highExt,

    lowExtensionAtr:
      lowExt,
  };
}


test(
  "LONG C1 needs at least 3 consecutive closed candles",
  () => {
    const two = [
      row({
        time: 1,
        closeExt: 1.2,
      }),
      row({
        time: 2,
        closeExt: 1.4,
      }),
    ];

    assert.equal(
      countConsecutivePersistence(
        two,
        "LONG",
        1,
      ),
      2,
    );

    assert.deepEqual(
      qualifiedLevels({
        c1: 2,
        c3: 0,
        c5: 0,
      }),
      [],
    );

    const three = [
      ...two,
      row({
        time: 3,
        closeExt: 1.1,
      }),
    ];

    assert.equal(
      countConsecutivePersistence(
        three,
        "LONG",
        1,
      ),
      3,
    );

    assert.deepEqual(
      qualifiedLevels({
        c1: 3,
        c3: 0,
        c5: 0,
      }),
      [1],
    );
  },
);


test(
  "latest closed candle below +3ATR immediately removes C3 while C1 may remain",
  () => {
    const rows = [
      row({
        time: 1,
        closeExt: 3.4,
      }),
      row({
        time: 2,
        closeExt: 3.6,
      }),
      row({
        time: 3,
        closeExt: 3.2,
      }),
      row({
        time: 4,
        closeExt: 1.8,
      }),
    ];

    assert.equal(
      countConsecutivePersistence(
        rows,
        "LONG",
        3,
      ),
      0,
    );

    assert.equal(
      countConsecutivePersistence(
        rows,
        "LONG",
        1,
      ),
      4,
    );
  },
);


test(
  "SHORT side is exact mirror",
  () => {
    const rows = [
      row({
        time: 1,
        closeExt: -5.4,
      }),
      row({
        time: 2,
        closeExt: -5.2,
      }),
      row({
        time: 3,
        closeExt: -5.1,
      }),
    ];

    assert.equal(
      countConsecutivePersistence(
        rows,
        "SHORT",
        1,
      ),
      3,
    );

    assert.equal(
      countConsecutivePersistence(
        rows,
        "SHORT",
        3,
      ),
      3,
    );

    assert.equal(
      countConsecutivePersistence(
        rows,
        "SHORT",
        5,
      ),
      3,
    );
  },
);


test(
  "historical wick touch of 3ATR/5ATR is recorded separately from close persistence",
  () => {
    const rows = [
      row({
        time: 1,
        closeExt: 1,
        highExt: 3.2,
      }),

      row({
        time: 2,
        closeExt: 1.2,
        highExt: 5.4,
      }),

      row({
        time: 3,
        closeExt: 0.3,
        highExt: 0.8,
      }),
    ];

    const touch =
      scanExtremeTouches(
        rows,
        "LONG",
      );

    assert.equal(
      touch.touched3,
      true,
    );

    assert.equal(
      touch.touched5,
      true,
    );

    assert.equal(
      touch.firstTouched3At,
      1,
    );

    assert.equal(
      touch.lastTouched5At,
      2,
    );

    assert.equal(
      touch.extremeAtr,
      5.4,
    );
  },
);

test("ATR14 uses Wilder/RMA rather than recalculating a simple rolling average", () => {
  assert.deepEqual(
    calculateWilderRma([1, 2, 3, 4], 3),
    [null, null, 2, (2 * 2 + 4) / 3],
  );
});

test("each band row has its own MA30/ATR14 and the latest row exposes log-normalized Slope20", () => {
  const bars = Array.from({ length: 55 }, (_, index) => ({
    time: index,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1,
  }));
  const rows = buildBandRows(bars);
  assert.equal(rows.length, 26);
  assert.equal(rows[0].ma30, 114.5);
  assert.equal(rows[0].atr14, 2);
  assert.equal(rows.at(-1).slope20, (Math.log(139.5) - Math.log(119.5)) / 20);
});

test("ATR analysis exposes the D metrics needed by the shared universe cache", () => {
  const bars = Array.from({ length: 80 }, (_, index) => ({
    time: index,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1,
  }));
  const rows = buildBandRows(bars);
  const metrics = calculateSlopeMetrics(rows);
  assert.ok(metrics);
  assert.equal(metrics.slopePct, rows.at(-1).slope20 * 100);
  assert.equal(Number.isFinite(metrics.slopeAtr), true);
  assert.equal(Number.isFinite(metrics.r2), true);
  assert.equal(Number.isFinite(metrics.acceleration), true);
});
