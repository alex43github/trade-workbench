"use client";

import StrategyWizard, { type StrategyWizardPosition } from "./StrategyWizard";

type Props = {
  symbol: string;
  position?: StrategyWizardPosition;
  positionSource?: "binance";
  interval: string;
  accountConnected: boolean;
  liveTradingAvailable: boolean;
  currentLeverage: number | null;
  currentPrice: number;
  maLength: number;
  maValue: number;
  entryAtrUpper: number;
  entryAtrLower: number;
  accountBalance: number;
  onAccountChanged: () => void;
};

export default function AdaptiveStrategyPanel({ symbol, position, interval, accountConnected, liveTradingAvailable, currentLeverage, currentPrice, maValue, onAccountChanged }: Props) {
  return <StrategyWizard
    symbol={symbol}
    position={position}
    accountConnected={accountConnected}
    currentLeverage={currentLeverage}
    currentPrice={currentPrice}
    chartTimeframe={interval}
    chartMa={maValue}
    liveTradingAvailable={liveTradingAvailable}
    onStrategyCreated={onAccountChanged}
  />;
}
