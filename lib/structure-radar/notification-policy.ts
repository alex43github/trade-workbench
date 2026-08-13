import type { ExpertDecision } from "./expert-types.ts";

type SignalForNotification = {
  id: string;
  symbol: string;
  timeframe: string;
  setup: "PLATFORM_RECLAIM" | "TRENDLINE_BREAKOUT";
  state: "CANDIDATE" | "CONFIRMED" | "ADD_CANDIDATE" | "TAKE_PROFIT_WATCH" | "INVALIDATED";
  stateVersion: number;
  close: number;
  detectedAt: number;
  mode: "live" | "demo" | "fixture";
};

type ConsensusForNotification = {
  grade: string;
  validOpinions: number;
  alertPolicy: string;
  executionExpert: string | null;
  executionPlan: Pick<ExpertDecision, "entry" | "stop" | "targets" | "management"> | null;
  opposingEvidence: readonly ExpertDecision[];
};

type PositionForNotification = {
  state: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
};

const STATE_LABELS = {
  CANDIDATE: "候选",
  CONFIRMED: "确认",
  ADD_CANDIDATE: "加仓候选",
  TAKE_PROFIT_WATCH: "止盈观察",
  INVALIDATED: "失效",
} as const;

const SETUP_LABELS = {
  PLATFORM_RECLAIM: "平台假跌破收回",
  TRENDLINE_BREAKOUT: "下降趋势线放量突破",
} as const;

const POSITION_LABELS: Record<string, string> = {
  NO_POSITION: "无持仓",
  PRE_EXISTING_POSITION: "信号前已有持仓",
  POST_CANDIDATE_POSITION: "候选后持仓",
  POST_CONFIRM_POSITION: "确认后持仓",
  OPPOSITE_POSITION: "反向持仓",
  POSITION_UNKNOWN: "持仓未知",
};

function price(value: number) {
  return Number(value.toPrecision(10)).toString();
}

export function notificationKey(signal: Pick<SignalForNotification, "id" | "stateVersion">, channel: string) {
  return `${signal.id}:${signal.stateVersion}:${channel}`;
}

export function buildNotification(
  signal: SignalForNotification,
  consensus: ConsensusForNotification,
  position: PositionForNotification,
) {
  if (signal.mode !== "live") return null;
  if (signal.state === "ADD_CANDIDATE" && position.side && position.entryPrice) {
    const losing = position.side === "LONG" ? signal.close <= position.entryPrice : signal.close >= position.entryPrice;
    if (losing) return null;
  }
  const label = STATE_LABELS[signal.state];
  const setup = SETUP_LABELS[signal.setup];
  const title = `[${label}] ${signal.symbol} ${setup} · ${signal.timeframe}`;
  const lines = [
    `状态：${label}｜现价：${price(signal.close)}｜共识：${consensus.grade}`,
    `形态：${setup}｜触发：${new Date(signal.detectedAt * 1_000).toISOString()}`,
    `持仓：${POSITION_LABELS[position.state] ?? position.state}${position.entryPrice ? `｜均价 ${price(position.entryPrice)}` : ""}`,
  ];
  if (signal.state === "INVALIDATED") {
    lines.push("结构已经失效：原计划作废，入场、止损、目标与加仓条件全部取消；等待新的独立结构。");
    lines.push("研究预警，不保证上涨；禁止亏损加仓。");
    return { key: notificationKey(signal, "bark"), title, body: lines.join("\n"), group: "强势币结构雷达" };
  }
  const fullPlanAllowed = consensus.validOpinions >= 3 &&
    ["FULL_PLAN", "AGGRESSIVE_CANDIDATE"].includes(consensus.alertPolicy);
  if (fullPlanAllowed && consensus.executionPlan?.entry && consensus.executionPlan.stop !== null) {
    const { entry, stop, targets, management } = consensus.executionPlan;
    lines.push(`执行主案：${consensus.executionExpert ?? "未指定"}`);
    const outsideEntry = signal.close > entry.max * 1.01 || signal.close < entry.min * 0.99;
    if (outsideEntry) {
      lines.push("价格已离开有效入场区，不追；等待回踩或新结构。");
    } else {
      lines.push(`入场区：${price(entry.min)}–${price(entry.max)}`);
      lines.push(`止损：${price(stop)}`);
      lines.push(`目标：${targets.map(price).join(" / ")}`);
    }
    if (management.length > 0) lines.push(`管理：${management.join("；")}`);
  } else {
    const warning = consensus.alertPolicy === "MAJOR_DIVERGENCE"
      ? "专家 2v2 重大分歧：仅观察形态，不提供统一点位。"
      : consensus.validOpinions < 3
        ? "专家会诊不完整：仅机械形态预警，不提供统一点位。"
        : "存在关键反方意见：仅推送形态，不提供统一点位。";
    lines.push(warning);
  }
  if (consensus.opposingEvidence.length > 0) {
    lines.push(`反方：${consensus.opposingEvidence.map((item) => item.thesis).join("；")}`);
  }
  lines.push("研究预警，不保证上涨；以结构失效为准，禁止亏损加仓。");
  return { key: notificationKey(signal, "bark"), title, body: lines.join("\n"), group: "强势币结构雷达" };
}
