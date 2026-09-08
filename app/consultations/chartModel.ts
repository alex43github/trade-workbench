import type { MarketSnapshot } from "@/lib/advisory/market";
import type { ConsensusDecision, DecisionContract } from "@/lib/advisory/types";
import type { ChartOverlay, MarketBar } from "../trade/TradeChart";

type ChartModel = { bars: MarketBar[]; overlays: ChartOverlay[]; confident: boolean; direction: "LONG" | "SHORT" | "NEUTRAL" };

function majorityDirection(consensus: ConsensusDecision): "LONG" | "SHORT" | null {
  if (consensus.validOpinions < 3 || consensus.disagreement) return null;
  if (consensus.longVotes >= 3 && consensus.longVotes > consensus.shortVotes) return "LONG";
  if (consensus.shortVotes >= 3 && consensus.shortVotes > consensus.longVotes) return "SHORT";
  return null;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildConsultationChartModel(
  snapshot: MarketSnapshot | null | undefined,
  opinions: Array<Pick<DecisionContract, "round" | "direction" | "entryZone" | "stopPrice" | "targets">>,
  consensus: ConsensusDecision,
  timeframe: "1h" | "4h" | "1d",
): ChartModel {
  const bars: MarketBar[] = (snapshot?.timeframes[timeframe] ?? []).filter((bar) => bar.closeTime > 0).map((bar) => ({
    time: Math.floor(bar.openTime / 1000), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, closed: true,
  }));
  const direction = majorityDirection(consensus);
  if (!direction) return { bars, overlays: [], confident: false, direction: "NEUTRAL" };
  const side: "LONG" | "SHORT" = direction;

  const directional = opinions.filter((item) => item.round === "R3" && item.direction === direction);
  const overlays: ChartOverlay[] = [];
  const entryLow = median(directional.map((item) => item.entryZone?.low).filter(finite));
  const entryHigh = median(directional.map((item) => item.entryZone?.high).filter(finite));
  if (entryLow !== null) overlays.push({ id: "consensus-entry-low", price: entryLow, label: "共识入场下沿", kind: "conditional", side });
  if (entryHigh !== null) overlays.push({ id: "consensus-entry-high", price: entryHigh, label: "共识入场上沿", kind: "conditional", side });
  const stop = median(directional.map((item) => item.stopPrice).filter(finite));
  if (stop !== null) overlays.push({ id: "consensus-stop", price: stop, label: "共识止损", kind: "tpsl", side });
  const targets = Array.from({ length: 3 }, (_, index) => median(directional.map((item) => item.targets?.[index]).filter(finite))).filter((price): price is number => price !== null);
  targets.forEach((price, index) => overlays.push({ id: `consensus-target-${index + 1}`, price, label: `共识止盈${index + 1}`, kind: "tpsl", side }));
  return { bars, overlays, confident: true, direction };
}
