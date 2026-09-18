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


const cRows =
  Array.isArray(
    data?.barkPreview?.C,
  )
    ? data.barkPreview.C
        .slice(
          0,
          10,
        )
    : [];


const dRows =
  Array.isArray(
    data?.barkPreview?.D,
  )
    ? data.barkPreview.D
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
  "【C｜ATR持续 Top10】",

  ...(
    cRows.length
      ? cRows.map(
          (
            row: any,
            index: number,
          ) =>
            `${index + 1}. `
            + `${row.symbol} `
            + `${row.direction} `
            + `C${row.cLevel} `
            + `连续${row.cCount}`,
        )
      : [
          "本小时无C候选",
        ]
  ),

  "",

  "【D｜1H MA30斜率 Top10】",

  ...(
    dRows.length
      ? dRows.map(
          (
            row: any,
            index: number,
          ) =>
            `${index + 1}. `
            + `${row.symbol} `
            + `${row.direction} `
            + `Slope ${n(row.slopePct)}% `
            + `R² ${n(row.r2)}`,
        )
      : [
          "本小时无D候选",
        ]
  ),

  "",

  `后台15m监控：${
    Array.isArray(data?.items)
      ? data.items.length
      : 0
  }个`,

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
