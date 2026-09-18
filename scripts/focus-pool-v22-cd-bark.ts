// @ts-nocheck
import fs from "node:fs";

/**
 * @param {unknown} value
 * @param {number} [digits=6]
 * @returns {string}
 */
function numberText(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

/**
 * @param {string} title
 * @param {Array<Record<string, any>>} rows
 * @returns {string[]}
 */
function cBlock(title, rows) {
  return [
    title,
    ...(rows.length
      ? rows.map((row, index) => [
          "Rank " + (index + 1),
          "Symbol " + String(row.symbol),
          "Slope20 " + numberText(row.slope20),
          "Streak " + String(row.cCount ?? row.count ?? row.streak ?? 0),
          "ExtensionATR " + numberText(row.extensionAtr, 3),
        ].join(" | "))
      : ["无"]),
  ];
}

/**
 * @param {string} title
 * @param {Array<Record<string, any>>} rows
 * @returns {string[]}
 */
function dBlock(title, rows) {
  return [
    title,
    ...(rows.length
      ? rows.map((row, index) => [
          "Rank " + (index + 1),
          "Symbol " + String(row.symbol),
          "Direction " + String(row.direction),
          "Slope20 " + numberText(row.slope20 ?? row.metric?.slope20),
        ].join(" | "))
      : ["无"]),
  ];
}

/**
 * @param {Array<Record<string, any>>} c5
 * @param {Array<Record<string, any>>} c3
 * @param {Array<Record<string, any>>} c1
 * @returns {string}
 */
function buildCBarkBody(c5, c3, c1) {
  return [
    ...cBlock("C5 Top10", c5.slice(0, 10)),
    "",
    ...cBlock("C3 Top10", c3.slice(0, 10)),
    "",
    ...cBlock("C1 Top10", c1.slice(0, 10)),
  ].join("\n");
}

/**
 * @param {Array<Record<string, any>>} dLong
 * @param {Array<Record<string, any>>} dShort
 * @returns {string}
 */
function buildDBarkBody(dLong, dShort) {
  return [
    ...dBlock("D-LONG Top10", dLong.slice(0, 10)),
    "",
    ...dBlock("D-SHORT Top10", dShort.slice(0, 10)),
  ].join("\n");
}

const FILE =
  "/var/lib/trade-workbench/structure-radar/hourly-focus-pool-v22.json";

const data =
  JSON.parse(
    fs.readFileSync(FILE, "utf8"),
  );

const generatedAt =
  typeof data?.generatedAt === "string"
    ? data.generatedAt
    : new Date().toISOString();

const bucket =
  generatedAt.slice(0, 13);

const cBody =
  buildCBarkBody(
    Array.isArray(data?.barkPreview?.C5) ? data.barkPreview.C5 : [],
    Array.isArray(data?.barkPreview?.C3) ? data.barkPreview.C3 : [],
    Array.isArray(data?.barkPreview?.C1) ? data.barkPreview.C1 : [],
  );

const dBody =
  buildDBarkBody(
    Array.isArray(data?.barkPreview?.DLong) ? data.barkPreview.DLong : [],
    Array.isArray(data?.barkPreview?.DShort) ? data.barkPreview.DShort : [],
  );

const cTitle =
  "【每小时｜C ATR持续 Top10】";

const dTitle =
  "【每小时｜D MA30斜率】";

console.log(cTitle);
console.log(cBody);
console.log(dTitle);
console.log(dBody);

if (process.env.DRY_RUN === "1") {
  console.log("DRY_RUN=1");
  process.exit(0);
}

const { getLocalD1 } = await import("../lib/local-d1.ts");
const { notifyBark } = await import("../lib/notifications/bark.ts");

const db =
  getLocalD1();

const cDelivery =
  await notifyBark({
    // @ts-expect-error LocalD1 is the runtime-compatible D1 adapter.
    db,
    key: "radar:focus-v22-c:" + bucket,
    title: cTitle,
    body: cBody,
  });

const dDelivery =
  await notifyBark({
    // @ts-expect-error LocalD1 is the runtime-compatible D1 adapter.
    db,
    key: "radar:focus-v22-d:" + bucket,
    title: dTitle,
    body: dBody,
  });

console.log("C_DELIVERY=" + JSON.stringify(cDelivery));
console.log("D_DELIVERY=" + JSON.stringify(dDelivery));
