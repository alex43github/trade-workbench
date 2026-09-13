"use client";

import FocusRadarPanel from "./FocusRadarPanel";
import TradingTerminal from "./TradingTerminal";

export default function TradeWorkspace({ initialSymbol, initialInterval }: { initialSymbol: string; initialInterval: "15m" | "1h" | "4h" | "1d" }) {
  return <>
    <FocusRadarPanel />
    <TradingTerminal initialSymbol={initialSymbol} initialInterval={initialInterval} />
  </>;
}
