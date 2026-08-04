import type { Metadata } from "next";
import TradingTerminal from "./TradingTerminal";

export const metadata: Metadata = {
  title: "街灯交易台｜自适应策略与操作知识库",
  description: "按持仓状态切换建仓、加仓与退出条件，操作前纪律评分，清仓后持续沉淀复盘记录。",
};

function normalizeSymbol(value: string | undefined) {
  const symbol = (value ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol) ? symbol : "BTCUSDT";
}

export default async function TradePage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const params = await searchParams;
  return <TradingTerminal initialSymbol={normalizeSymbol(params.symbol)} />;
}
