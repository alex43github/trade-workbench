import { buildFocusDecisionBark, buildFocusStructuralBark, deriveExecutionGuidance, type FocusBarkMessage } from "../../lib/structure-radar/focus-alerts.ts";
import { evaluateFocusDecision, type FocusDecisionInput } from "../../lib/structure-radar/focus-decision.ts";
import { detectFocusMa30Event, ma30Relation, type FocusMa30Timeframe } from "../../lib/structure-radar/focus-ma30.ts";
import { isFocusPoolActive, type FocusPoolRecord } from "../../lib/structure-radar/focus-pool.ts";

type FocusBar = { time: number; open: number; high: number; low: number; close: number; volume: number; closed?: boolean };
type Delivery = { status: string; error?: string };
type Repository = { getFocus(symbol: string): Promise<FocusPoolRecord | null>; saveFocus(record: FocusPoolRecord): Promise<void> };
type Evidence = Omit<FocusDecisionInput, "bias" | "stale" | "reclaimed">;

type Dependencies = {
  repository: Repository;
  readBars(symbol: string, timeframe: FocusMa30Timeframe): readonly FocusBar[];
  evidence(record: FocusPoolRecord): Promise<Evidence>;
  send(message: FocusBarkMessage): Promise<Delivery>;
  now?: () => Date;
};

const STALE_AFTER_SECONDS: Record<FocusMa30Timeframe, number> = { "5m": 10 * 60, "15m": 30 * 60, "1h": 2 * 60 * 60 };
const ALERT_DECISIONS = new Set(["BUY_READY", "ADD_READY", "NO_CHASE", "RISK_OFF", "INVALIDATED"]);

function sma(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ma30Pair(bars: readonly FocusBar[]) {
  if (bars.length < 31) return null;
  const previous = bars.slice(-31, -1);
  const current = bars.slice(-30);
  if (previous.some((bar) => bar.closed === false) || current.some((bar) => bar.closed === false)) return null;
  return { previous: sma(previous.map((bar) => bar.close)), current: sma(current.map((bar) => bar.close)) };
}

function atr(bars: readonly FocusBar[], period = 14) {
  const values = bars.slice(-(period + 1));
  if (values.length < 2) return 0;
  const ranges = values.slice(1).map((bar, index) => {
    const previousClose = values[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function isFresh(bars: readonly FocusBar[], timeframe: FocusMa30Timeframe, nowSeconds: number) {
  const latest = bars.at(-1);
  if (!latest || latest.closed === false) return false;
  const age = nowSeconds - latest.time;
  return age >= -60 && age <= STALE_AFTER_SECONDS[timeframe];
}

function delivered(status: string) {
  return status === "delivered" || status === "duplicate" || status === "disabled";
}

function appendKey(record: FocusPoolRecord, key: string) {
  if (record.lastBarkEventKeys.includes(key)) return;
  record.lastBarkEventKeys = [...record.lastBarkEventKeys, key].slice(-100);
}

export class FocusMonitor {
  readonly #repository: Repository;
  readonly #readBars: Dependencies["readBars"];
  readonly #evidence: Dependencies["evidence"];
  readonly #send: Dependencies["send"];
  readonly #now: () => Date;

  constructor(dependencies: Dependencies) {
    this.#repository = dependencies.repository;
    this.#readBars = dependencies.readBars;
    this.#evidence = dependencies.evidence;
    this.#send = dependencies.send;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async processClosedTimeframe(symbol: string, timeframe: FocusMa30Timeframe) {
    const record = await this.#repository.getFocus(symbol.toUpperCase());
    const now = this.#now();
    const nowIso = now.toISOString();
    if (!record || !isFocusPoolActive(record, nowIso)) return { status: "not_focused" as const };

    const barsByTimeframe = {
      "5m": this.#readBars(record.symbol, "5m"),
      "15m": this.#readBars(record.symbol, "15m"),
      "1h": this.#readBars(record.symbol, "1h"),
    };
    const pairs = {
      "5m": ma30Pair(barsByTimeframe["5m"]),
      "15m": ma30Pair(barsByTimeframe["15m"]),
      "1h": ma30Pair(barsByTimeframe["1h"]),
    };
    const currentPair = pairs[timeframe];
    const currentBars = barsByTimeframe[timeframe];
    if (!currentPair || currentBars.length < 31) return { status: "insufficient_bars" as const };

    const next = structuredClone(record);
    for (const candidate of ["5m", "15m", "1h"] as const) {
      const pair = pairs[candidate];
      const latest = barsByTimeframe[candidate].at(-1);
      if (pair && latest) next.ma30[candidate] = ma30Relation(latest.close, pair.current);
    }
    next.updatedAt = nowIso;

    const current = currentBars.at(-1)!;
    const previous = currentBars.at(-2)!;
    const structuralEvent = detectFocusMa30Event({
      symbol: next.symbol,
      timeframe,
      bias: next.bias,
      previousBar: previous,
      currentBar: current,
      previousMa30: currentPair.previous,
      currentMa30: currentPair.current,
      lastEventKey: timeframe === "15m" || timeframe === "1h" ? next.ma30EventWatermarks[timeframe] : undefined,
    });

    const stale = (["5m", "15m", "1h"] as const).some((candidate) => !isFresh(barsByTimeframe[candidate], candidate, now.valueOf() / 1000));
    const evidence = await this.#evidence(next);
    const decision = evaluateFocusDecision({
      ...evidence,
      bias: next.bias,
      stale,
      reclaimed: next.ma30["15m"] === "ABOVE" && next.ma30["1h"] !== "BELOW" && next.ma30["1h"] !== "UNKNOWN",
    });

    if (structuralEvent) {
      const message = buildFocusStructuralBark(next, structuralEvent, decision);
      const delivery = await this.#send(message);
      if (!delivered(delivery.status)) return { status: "delivery_failed" as const, error: delivery.error ?? delivery.status };
      next.ma30EventWatermarks[structuralEvent.timeframe] = structuralEvent.eventKey;
      next.lastEventAt = nowIso;
      appendKey(next, message.key);
      await this.#repository.saveFocus(next);
    }

    const decisionChanged = decision.state !== record.lastDecision || decision.reasonCodes.join("|") !== record.lastDecisionReasonCodes.join("|");
    if (decisionChanged && ALERT_DECISIONS.has(decision.state)) {
      const latest15m = barsByTimeframe["15m"].at(-1);
      const pair15m = pairs["15m"];
      if (latest15m && pair15m) {
        const recent = barsByTimeframe["15m"].slice(-6);
        const levels = deriveExecutionGuidance({
          price: latest15m.close,
          ma30: pair15m.current,
          atr: atr(barsByTimeframe["15m"]),
          retestLow: Math.min(...recent.map((bar) => bar.low)),
          breakoutHigh: Math.max(...recent.map((bar) => bar.high)),
        });
        const message = buildFocusDecisionBark(next, decision, levels, current.time);
        const delivery = await this.#send(message);
        if (!delivered(delivery.status)) return { status: "delivery_failed" as const, error: delivery.error ?? delivery.status };
        appendKey(next, message.key);
        next.lastEventAt = nowIso;
      }
    }

    next.lastDecision = decision.state;
    next.lastDecisionReasonCodes = [...decision.reasonCodes];
    await this.#repository.saveFocus(next);
    return { status: "processed" as const, decision: decision.state, structuralEvent: structuralEvent?.eventType ?? null };
  }
}
