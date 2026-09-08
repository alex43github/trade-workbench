"use client";

import StrategyWizard, { type StrategyWizardPosition } from "./StrategyWizard";
import type { QuickLiveTemplateId } from "@/lib/trade/quick-live-template";
import type { LiveExchange } from "@/lib/trade/live-exchange";

type Props = {
  symbol: string;
  position?: StrategyWizardPosition;
  positionSource?: "binance" | "bybit";
  exchange: LiveExchange;
  interval: string;
  accountConnected: boolean;
  liveTradingAvailable: boolean;
  liveSwitchOn: boolean;
  currentLeverage: number | null;
  currentPrice: number;
  maLength: number;
  maValue: number;
  atrValue: number;
  totalEquityUsdt: number;
  strategySymbol?: string;
  selectedQuickTemplate?: QuickLiveTemplateId | null;
  selectedQuickTotalMarginUsdt?: number | null;
  entryAtrUpper: number;
  entryAtrLower: number;
  accountBalance: number;
  onAccountChanged: () => void;
};

export default function AdaptiveStrategyPanel({ symbol, position, exchange, interval, accountConnected, liveTradingAvailable, liveSwitchOn, currentLeverage, currentPrice, maValue, totalEquityUsdt, strategySymbol, selectedQuickTemplate, selectedQuickTotalMarginUsdt, accountBalance, onAccountChanged }: Props) {
  return <StrategyWizard
    symbol={strategySymbol ?? symbol}
    position={position}
    exchange={exchange}
    liveSwitchOn={liveSwitchOn}
    accountConnected={accountConnected}
    currentLeverage={currentLeverage}
    currentPrice={currentPrice}
    chartTimeframe={interval}
    chartMa={maValue}
    availableBalance={accountBalance}
    totalEquityUsdt={totalEquityUsdt}
    selectedQuickTemplate={selectedQuickTemplate}
    selectedQuickTotalMarginUsdt={selectedQuickTotalMarginUsdt}
    liveTradingAvailable={liveTradingAvailable}
    onStrategyCreated={onAccountChanged}
  />;
}
