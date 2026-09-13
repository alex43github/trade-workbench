"use client";

import { useTerminalTheme } from "../themeStore";
import FocusRadarPanel from "./FocusRadarPanel";
import TradingTerminal from "./TradingTerminal";

export default function TradeWorkspace({ initialSymbol, initialInterval }: { initialSymbol: string; initialInterval: "15m" | "1h" | "4h" | "1d" }) {
  const { resolvedTheme } = useTerminalTheme();
  return <>
    <style>{`section[aria-label="顶部策略决策"]{display:none!important}`}</style>
    <FocusRadarPanel theme={resolvedTheme} />
    <TradingTerminal initialSymbol={initialSymbol} initialInterval={initialInterval} />
  </>;
}
