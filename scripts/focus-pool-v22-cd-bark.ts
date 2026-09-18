import fs from "node:fs";

import {
  getLocalD1,
} from "../lib/local-d1.ts";
import {
  notifyBark,
} from "../lib/notifications/bark.ts";
import {
  buildCBarkBody,
  buildDBarkBody,
} from "../lib/radar/focus-pool-v22-bark.ts";

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

const db =
  getLocalD1();

const cDelivery =
  await notifyBark({
    db: db as unknown as D1Database,
    key: "radar:focus-v22-c:" + bucket,
    title: cTitle,
    body: cBody,
  });

const dDelivery =
  await notifyBark({
    db: db as unknown as D1Database,
    key: "radar:focus-v22-d:" + bucket,
    title: dTitle,
    body: dBody,
  });

console.log("C_DELIVERY=" + JSON.stringify(cDelivery));
console.log("D_DELIVERY=" + JSON.stringify(dDelivery));
