import type { EquityPoint } from "./EquityChart";

export type PaperPosition = {
  id: string; symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; markPrice: number;
  unrealizedPnl: number; leverage: number; entries: number; stopPrice: number | null; targetPrice: number | null;
  strategyScore: number; openedAt: string; quoteLive?: boolean;
};

export type PaperOrder = {
  id: string; symbol: string; side: "BUY" | "SELL"; intent: string; type: string; triggerPrice: number | null;
  quantity: number; status: string; score: number; createdAt: string;
};

export type PaperTrade = {
  id: string; orderId: string; symbol: string; side: "BUY" | "SELL"; intent: string; price: number;
  quantity: number; fee: number; realizedPnl: number; reason: string; createdAt: string;
};

export type PaperSnapshot = {
  mode: "paper"; updatedAt: string;
  account: { initialBalance: number; cashBalance: number; equity: number; availableBalance: number; unrealizedPnl: number; realizedPnl: number; totalFees: number; usedMargin: number; currency: string };
  positions: PaperPosition[]; orders: PaperOrder[]; trades: PaperTrade[]; equityPoints: EquityPoint[];
  execution: { feeRate: number; leverage: number; triggerMode: string; slippageModel: string };
};

export const emptyPaper: PaperSnapshot = {
  mode: "paper", updatedAt: "",
  account: { initialBalance: 10_000, cashBalance: 10_000, equity: 10_000, availableBalance: 10_000, unrealizedPnl: 0, realizedPnl: 0, totalFees: 0, usedMargin: 0, currency: "USDT" },
  positions: [], orders: [], trades: [], equityPoints: [],
  execution: { feeRate: 0.0004, leverage: 3, triggerMode: "页面轮询撮合", slippageModel: "当前标记价格" },
};
