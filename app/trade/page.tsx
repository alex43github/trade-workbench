import type { Metadata } from "next";
import TradingTerminal from "./TradingTerminal";
import { normalizeBinanceFuturesSymbol } from "@/lib/trade/symbols";

export const metadata: Metadata = {
  title: "街灯交易台｜自适应策略与操作知识库",
  description: "按持仓状态切换建仓、加仓与退出条件，操作前纪律评分，清仓后持续沉淀复盘记录。",
};

function normalizeSymbol(value: string | undefined) {
  try { return normalizeBinanceFuturesSymbol(value ?? "BTCUSDT"); }
  catch { return "BTCUSDT"; }
}

function normalizeInterval(value: string | undefined) {
  return ["15m", "1h", "4h", "1d"].includes(value ?? "") ? value as "15m" | "1h" | "4h" | "1d" : "1h";
}

export default async function TradePage({ searchParams }: { searchParams: Promise<{ symbol?: string; interval?: string }> }) {
  const params = await searchParams;
  return <TradingTerminal initialSymbol={normalizeSymbol(params.symbol)} initialInterval={normalizeInterval(params.interval)} />;
}
