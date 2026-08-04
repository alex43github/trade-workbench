import type { Metadata } from "next";
import TradingTerminal from "./TradingTerminal";

export const metadata: Metadata = {
  title: "街灯交易台｜MA30模拟策略实验室",
  description: "基于Binance K线与TradingView Lightweight Charts的MA30多周期回撤策略配置、自然语言解析和模拟观察台。",
};

function normalizeSymbol(value: string | undefined) {
  const symbol = (value ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol) ? symbol : "BTCUSDT";
}

export default async function TradePage({ searchParams }: { searchParams: Promise<{ symbol?: string }> }) {
  const params = await searchParams;
  return <TradingTerminal initialSymbol={normalizeSymbol(params.symbol)} />;
}
