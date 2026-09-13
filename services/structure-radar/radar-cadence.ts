export const STRONG_TREND_RADAR_VERSION = "TREND_RADAR_V0.1_RESEARCH";
export const SQUEEZE_RADAR_VERSION = "SQUEEZE_RADAR_V0.1_RESEARCH";
export const HOURLY_RADAR_CADENCE_MS = 60 * 60 * 1_000;

export type BarkMessage = { key: string; title: string; body: string; group: string };
export type StrongTrendCandidate = { symbol: string; score: number; state: string; direction?: "LONG" | "SHORT" | "NEUTRAL" | "UNKNOWN"; stage?: string; action?: string; reasonCodes?: string[] };
export type SqueezeCandidate = { symbol: string; stage: string; direction: string | null; action?: string; score?: number; reasonCodes?: string[] };

type DigestInput = { cycleAt: string; universeDenominator: number; strongTrendCandidates: readonly StrongTrendCandidate[]; squeezeCandidates: readonly SqueezeCandidate[] };

function hourlyBucket(cycleAt: string) { const date = new Date(cycleAt); if (Number.isNaN(date.valueOf())) throw new Error("cycleAt must be an ISO timestamp"); return date.toISOString().slice(0, 13); }
function auditLine(cycleAt: string, version: string, universeDenominator: number) { return `扫描：${cycleAt}｜ModelVersion：${version}｜全量合约：${universeDenominator}`; }
function reasons(values: readonly string[] | undefined) { return values?.length ? `｜原因：${values.join(",")}` : ""; }
function squeezeIdentity(direction: string | null) {
  if (direction === "SHORT_SQUEEZE_LONG_BIAS") return { classification: "SHORT_SQUEEZE", bias: "LONG" };
  if (direction === "LONG_SQUEEZE_SHORT_BIAS") return { classification: "LONG_SQUEEZE", bias: "SHORT" };
  return { classification: "SQUEEZE", bias: "UNKNOWN" };
}
function squeezeAction(item: SqueezeCandidate) {
  if (item.action) return item.action;
  if (item.stage === "EXTENDED_NO_CHASE" || item.stage === "BLOW_OFF") return "NO_CHASE";
  if (["RESET_WATCH", "RECLAIM_PENDING", "SECOND_TEST"].includes(item.stage)) return "WAIT_RESET";
  return "WATCH_ONLY";
}

export function buildHourlyRadarDigests(input: DigestInput): [BarkMessage, BarkMessage] {
  const bucket = hourlyBucket(input.cycleAt);
  const trend = [...input.strongTrendCandidates].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  const squeeze = [...input.squeezeCandidates].sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.symbol.localeCompare(right.symbol));
  return [
    {
      key: `radar:hourly:strong-trend:${bucket}`,
      title: "【每小时强趋势雷达】",
      group: "强势币结构雷达",
      body: trend.length
        ? `${trend.map((item) => `${item.symbol}｜STRONG_TREND｜${item.direction ?? "LONG"}｜${item.score.toFixed(0)}分｜Stage：${item.stage ?? item.state}｜Action：${item.action ?? "WATCH_ONLY"}${reasons(item.reasonCodes)}`).join("\n")}\n${auditLine(input.cycleAt, STRONG_TREND_RADAR_VERSION, input.universeDenominator)}`
        : `本小时无高质量候选\n${auditLine(input.cycleAt, STRONG_TREND_RADAR_VERSION, input.universeDenominator)}`,
    },
    {
      key: `radar:hourly:squeeze:${bucket}`,
      title: "【每小时潜在轧空/轧多雷达】",
      group: "强势币结构雷达",
      body: squeeze.length
        ? `${squeeze.map((item) => { const identity = squeezeIdentity(item.direction); return `${item.symbol}｜${identity.classification}｜${identity.bias}${item.score === undefined ? "" : `｜${item.score.toFixed(0)}分`}｜Stage：${item.stage}｜Action：${squeezeAction(item)}${reasons(item.reasonCodes)}`; }).join("\n")}\n${auditLine(input.cycleAt, SQUEEZE_RADAR_VERSION, input.universeDenominator)}`
        : `本小时无高质量候选\n${auditLine(input.cycleAt, SQUEEZE_RADAR_VERSION, input.universeDenominator)}`,
    },
  ];
}

export type HourlyRadarCycleResult = { status: "completed" | "failed"; routes: ("strong-trend" | "squeeze")[]; checked: number; dataSourceDegraded: number; failure?: { kind: "data_source" | "delivery" | "runtime"; error: string } };

export async function runHourlyRadarCycle(options: {
  cycleAt: string;
  universeDenominator: number;
  scanUniverse: () => Promise<{ checked: number; dataSourceDegraded: number }>;
  strongTrendCandidates: () => Promise<readonly StrongTrendCandidate[]>;
  squeezeCandidates: () => Promise<readonly SqueezeCandidate[]>;
  send: (message: BarkMessage) => Promise<{ status: string; error?: string }>;
}): Promise<HourlyRadarCycleResult> {
  let scan: { checked: number; dataSourceDegraded: number };
  try {
    scan = await options.scanUniverse();
    if (scan.dataSourceDegraded > 0) return { status: "failed", routes: [], ...scan, failure: { kind: "data_source", error: "hourly radar data source is degraded" } };
    const [strongTrendCandidates, squeezeCandidates] = await Promise.all([options.strongTrendCandidates(), options.squeezeCandidates()]);
    const digests = buildHourlyRadarDigests({ ...options, strongTrendCandidates, squeezeCandidates });
    const routes: ("strong-trend" | "squeeze")[] = [];
    for (const [index, message] of digests.entries()) {
      const delivery = await options.send(message);
      if (delivery.status !== "delivered" && delivery.status !== "duplicate") return { status: "failed", routes, ...scan, failure: { kind: "delivery", error: delivery.error ?? `Bark ${delivery.status}` } };
      routes.push(index === 0 ? "strong-trend" : "squeeze");
    }
    return { status: "completed", routes, ...scan };
  } catch (error) {
    return { status: "failed", routes: [], checked: 0, dataSourceDegraded: 0, failure: { kind: "runtime", error: error instanceof Error ? error.message : "hourly radar cycle failed" } };
  }
}
