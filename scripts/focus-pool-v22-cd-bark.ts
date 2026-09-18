import fs from "node:fs";

import {
  getLocalD1,
} from "../lib/local-d1.ts";

import {
  notifyBark,
} from "../lib/notifications/bark.ts";


const FILE =
  "/var/lib/trade-workbench/structure-radar/hourly-focus-pool-v22.json";


const data =
  JSON.parse(
    fs.readFileSync(
      FILE,
      "utf8",
    ),
  );


const generatedAt =
  typeof data?.generatedAt
  === "string"
    ? data.generatedAt
    : new Date()
        .toISOString();


const bucket =
  generatedAt.slice(
    0,
    13,
  );


const c5Rows =
  Array.isArray(
    data?.barkPreview?.C5,
  )
    ? data.barkPreview.C5
        .slice(
          0,
          10,
        )
    : [];

const c3Rows =
  Array.isArray(
    data?.barkPreview?.C3,
  )
    ? data.barkPreview.C3
        .slice(
          0,
          10,
        )
    : [];

const c1Rows =
  Array.isArray(
    data?.barkPreview?.C1,
  )
    ? data.barkPreview.C1
        .slice(
          0,
          10,
        )
    : [];

const dLongRows =
  Array.isArray(
    data?.barkPreview?.DLong,
  )
    ? data.barkPreview.DLong
        .slice(
          0,
          10,
        )
    : [];

const dShortRows =
  Array.isArray(
    data?.barkPreview?.DShort,
  )
    ? data.barkPreview.DShort
        .slice(
          0,
          10,
        )
    : [];

function n(
  value: unknown,
  digits = 3,
) {
  const x =
    Number(
      value,
    );

  return Number.isFinite(x)
    ? x.toFixed(digits)
    : "-";
}


const body = [
  "【C5｜ATR持续 Top10】",
  ...(c5Rows.length
    ? c5Rows.map(
        (row: any, index: number) =>
          `${index + 1}. `
          + `${row.symbol} `
          + `${row.direction} `
          + `连续${row.cCount}`,
      )
    : ["本小时无C5候选"]),
  "",
  "【C3｜ATR持续 Top10】",
  ...(c3Rows.length
    ? c3Rows.map(
        (row: any, index: number) =>
          `${index + 1}. `
          + `${row.symbol} `
          + `${row.direction} `
          + `连续${row.cCount}`,
      )
    : ["本小时无C3候选"]),
  "",
  "【C1｜ATR持续 Top10】",
  ...(c1Rows.length
    ? c1Rows.map(
        (row: any, index: number) =>
          `${index + 1}. `
          + `${row.symbol} `
          + `${row.direction} `
          + `连续${row.cCount}`,
      )
    : ["本小时无C1候选"]),
  "",
  "【D｜1H MA30斜率 Long Top10】",
  ...(dLongRows.length
    ? dLongRows.map(
        (row: any, index: number) =>
          `${index + 1}. `
          + `${row.symbol} LONG `
          + `Slope ${n(row.slopePct)}% `
          + `R² ${n(row.r2)}`,
      )
    : ["本小时无D Long候选"]),
  "",
  "【D｜1H MA30斜率 Short Top10】",
  ...(dShortRows.length
    ? dShortRows.map(
        (row: any, index: number) =>
          `${index + 1}. `
          + `${row.symbol} SHORT `
          + `Slope ${n(row.slopePct)}% `
          + `R² ${n(row.r2)}`,
      )
    : ["本小时无D Short候选"]),
  "",
  `后台15m监控：${Array.isArray(data?.items) ? data.items.length : 0}个`,
  `扫描：${generatedAt}`,
].join("\n");

const title =
  "【每小时｜ATR持续 + MA30斜率】";


console.log(title);
console.log(body);


if (
  process.env.DRY_RUN
  === "1"
) {
  console.log(
    "DRY_RUN=1",
  );

  process.exit(0);
}


const db =
  getLocalD1();


const delivery =
  await notifyBark({
    db: db as unknown as D1Database,

    key:
      `radar:focus-v22-cd:${bucket}`,

    title,
    body,
  });


console.log(
  `DELIVERY=${
    JSON.stringify(
      delivery,
    )
  }`,
);
