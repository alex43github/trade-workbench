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


function rows(value: unknown) {
  return Array.isArray(value)
    ? value.slice(0, 10)
    : [];
}


const cByLevel = {
  C5: rows(
    data?.barkPreview?.CByLevel?.C5,
  ),
  C3: rows(
    data?.barkPreview?.CByLevel?.C3,
  ),
  C1: rows(
    data?.barkPreview?.CByLevel?.C1,
  ),
};


const dByDirection = {
  LONG: rows(
    data?.barkPreview?.DByDirection?.LONG,
  ),
  SHORT: rows(
    data?.barkPreview?.DByDirection?.SHORT,
  ),
};


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


function signed(
  value: unknown,
  digits = 3,
) {
  const x =
    Number(
      value,
    );

  if (!Number.isFinite(x)) {
    return "-";
  }

  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`;
}


function cSection(
  label: "C5" | "C3" | "C1",
  sectionRows: any[],
) {
  return [
    `【${label}｜ATR持续 Top10】`,
    ...(
      sectionRows.length
        ? sectionRows.map(
            (
              row: any,
              index: number,
            ) =>
              `${index + 1}. `
              + `${row.symbol} `
              + `${row.direction} `
              + `连续${row.cCount} `
              + `Slope ${signed(row.slopePct)}%`,
          )
        : [
            `本小时无${label}候选`,
          ]
    ),
  ];
}


function dSection(
  direction: "LONG" | "SHORT",
  sectionRows: any[],
) {
  const zh =
    direction === "LONG"
      ? "多头"
      : "空头";

  return [
    `【D｜1H MA30斜率 ${zh} Top10】`,
    ...(
      sectionRows.length
        ? sectionRows.map(
            (
              row: any,
              index: number,
            ) =>
              `${index + 1}. `
              + `${row.symbol} `
              + `Slope ${signed(row.slopePct)}% `
              + `R² ${n(row.r2)}`,
          )
        : [
            `本小时无D ${direction}候选`,
          ]
    ),
  ];
}


const body = [
  ...cSection(
    "C5",
    cByLevel.C5,
  ),

  "",

  ...cSection(
    "C3",
    cByLevel.C3,
  ),

  "",

  ...cSection(
    "C1",
    cByLevel.C1,
  ),

  "",

  ...dSection(
    "LONG",
    dByDirection.LONG,
  ),

  "",

  ...dSection(
    "SHORT",
    dByDirection.SHORT,
  ),

  "",

  `后台15m监控：${
    Array.isArray(data?.items)
      ? data.items.length
      : 0
  }个`,

  `C Focus：C5 ${
    data?.counts?.C5Focus ?? 0
  }｜C3 ${
    data?.counts?.C3Focus ?? 0
  }｜C1 ${
    data?.counts?.C1Focus ?? 0
  }`,

  `D Focus：多 ${
    data?.counts?.DLongFocus ?? 0
  }｜空 ${
    data?.counts?.DShortFocus ?? 0
  }`,

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
