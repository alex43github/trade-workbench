import { readFile } from "node:fs/promises";

import { getLocalD1 } from "../lib/local-d1.ts";
import { notifyBark } from "../lib/notifications/bark.ts";
import { fetchClosedBars } from "../lib/radar/binance-public.ts";
import { evaluateMa30Reignition } from "../lib/radar/ma30-priority-signals.ts";
import {
  buildPriorityDigest,
  type PriorityDigestRow,
} from "../lib/radar/radar-alert-v2.ts";

import {
  recordReignitionV2Shadow,
} from "../lib/radar/reignition-v2-shadow.ts";

const POOL =
  "/var/lib/trade-workbench/structure-radar/hourly-focus-pool-v22.json";

type PoolItem = {
  symbol: string;
  direction: "LONG" | "SHORT" | "UNRESOLVED";
  sources: string[];
  qualifiedAt: number;
  watch15m?: boolean;
  entryState?: string;
};

function bucket(now: Date) {
  const ms = 15 * 60 * 1000;

  return new Date(
    Math.floor(now.getTime() / ms) * ms,
  )
    .toISOString()
    .slice(0, 16);
}

async function loadPool(): Promise<PoolItem[]> {
  try {
    const raw =
      JSON.parse(
        await readFile(POOL, "utf8"),
      ) as {
        items?: PoolItem[];
      };

    return Array.isArray(raw.items)
      ? raw.items.filter(
          (item) =>
            typeof item.symbol === "string"
            && (
              item.direction === "LONG"
              || item.direction === "SHORT"
            )
            && item.watch15m !== false,
        )
      : [];
  } catch {
    return [];
  }
}

const now = new Date();
const pool = await loadPool();

if (!pool.length) {
  console.log("NO_PRIORITY_POOL=1");
  process.exit(0);
}

const rows: PriorityDigestRow[] = [];

for (const item of pool) {
  try {
    const [bars15m, bars1h] =
      await Promise.all([
        fetchClosedBars(
          item.symbol,
          "15m",
          now,
          80,
        ),

        fetchClosedBars(
          item.symbol,
          "1h",
          now,
          80,
        ),
      ]);

    const result =
      evaluateMa30Reignition({
        bars15m,
        bars1h,
        direction: item.direction,
        watchStartedAt:
          item.qualifiedAt,
        symbol: item.symbol,
      });

    /*
     * User-facing Bark:
     * ONLY real trigger events.
     *
     * PULLBACK / WAITING / FAILED are
     * internal monitoring states and
     * must not generate Bark noise.
     */
    if (!result.signal) {
      continue;
    }

    /*
     * Shadow-only V2 research.
     *
     * Failure here MUST NOT block
     * existing V1 Bark delivery.
     */
    try {
      await recordReignitionV2Shadow({
        symbol:
          item.symbol,

        direction:
          item.direction,

        sources:
          item.sources ?? [],

        qualifiedAt:
          item.qualifiedAt,

        bars15m,

        signal:
          result.signal,
      });

    } catch (error) {
      console.error(
        `V2_SHADOW_ERROR ${item.symbol} ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    rows.push({
      symbol: item.symbol,
      direction: item.direction,
      status: "REIGNITION",
      detail:
        `距MA30 ${
          result.signal.closeVsMa30Pct >= 0
            ? "+"
            : ""
        }${
          result.signal.closeVsMa30Pct.toFixed(1)
        }%`
        + `｜Ext ${
          result.signal.extensionAtr.toFixed(2)
        }ATR`,
    });

  } catch (error) {
    /*
     * Keep failure in journal only.
     * Do NOT pollute Bark.
     */
    console.error(
      `WATCH_ERROR ${item.symbol} ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

if (!rows.length) {
  console.log(
    `NO_REIGNITION_TRIGGER=1 pool=${pool.length}`,
  );

  process.exit(0);
}

const digest =
  buildPriorityDigest(
    rows,
    bucket(now),
  );

const visible =
  rows.slice(0, 24);

const body =
  visible
    .map(
      (row, index) =>
        `${index + 1}.`
        + `${row.symbol}`
        + `｜${
          row.direction === "LONG"
            ? "多"
            : "空"
        }`
        + `｜🔥二次点火触发`
        + `｜${row.detail}`,
    )
    .join("\n")
  + (
    rows.length > visible.length
      ? `\n…另${
          rows.length - visible.length
        }个有效触发`
      : ""
  );

console.log(digest.title);
console.log(body);

if (process.env.DRY_RUN === "1") {
  console.log("DRY_RUN=1");
  process.exit(0);
}

const db =
  getLocalD1();

const delivery =
  await notifyBark({
    db:
      db as unknown as D1Database,

    /*
     * Keep original digest key so
     * 15m bucket dedup semantics stay unchanged.
     */
    key: digest.key,

    title: digest.title,
    body,
  });

console.log(
  `DELIVERY=${
    JSON.stringify(delivery)
  }`,
);
