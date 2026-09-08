import type { AtrBandLifecycle } from "./atr-band-lifecycle.ts";

export type AtrLifecycleExportRange = "24h" | "7d" | "30d";

export function normalizeAtrLifecycleExportRange(value: string | null | undefined): AtrLifecycleExportRange {
  if (value === "week" || value === "7d") return "7d";
  if (value === "month" || value === "30d") return "30d";
  return "24h";
}

function rangeHours(range: AtrLifecycleExportRange) { return range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30; }
function rangeLabel(range: AtrLifecycleExportRange) { return range === "24h" ? "最近 24 小时" : range === "7d" ? "最近一周" : "最近一个月"; }
function symbol(value: string) { return value.replace(/USDT$/, ""); }
function number(value: unknown, fallback = 0) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

export function filterCompletedAtrLifecycles<T extends Partial<AtrBandLifecycle>>(rows: readonly T[], range: AtrLifecycleExportRange, now = new Date()): T[] {
  const cutoff = now.getTime() - rangeHours(range) * 60 * 60 * 1_000;
  return rows.filter((row) => row.status === "HISTORY" && typeof row.endTime === "number" && row.endTime >= cutoff)
    .sort((left, right) => number(right.endTime) - number(left.endTime));
}

export function buildAtrLifecycleMarkdown(rows: readonly Partial<AtrBandLifecycle>[], range: AtrLifecycleExportRange, now = new Date()) {
  const generatedAt = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const header = `# ATR 生命周期历史导出（${rangeLabel(range)}）\n\n生成时间：${generatedAt}（Asia/Shanghai）\n\n`;
  if (!rows.length) return `${header}该时间段没有已结束的 ATR 生命周期。\n`;
  const table = rows.map((row) => {
    const direction = row.direction === "SHORT" ? "空头" : "多头";
    const end = typeof row.endTime === "number" ? new Date(row.endTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
    return `| ${symbol(String(row.symbol ?? ""))} | ${direction} | ${end} | ${number(row.entryOpenPrice ?? row.entryPrice).toFixed(6)} | ${number(row.endOpenPrice ?? row.currentPrice).toFixed(6)} | ${number(row.lifecycleReturnPct).toFixed(2)}% | ${number(row.outsideBandBars)} | ${number(row.lifecycleBars)} | ${number(row.maxFavorablePct).toFixed(2)}% | ${number(row.maxAtrMultiple).toFixed(2)} ATR |`;
  }).join("\n");
  return `${header}| 币种 | 方向 | 结束时间 | 入池开盘价 | 结束开盘价 | 入池→结束 | 阈值外持续 K | 生命周期 K | 最高有利幅度 | 最大 ATR |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${table}\n`;
}
