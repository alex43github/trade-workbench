"use client";

import StrategyWizard, { type StrategyWizardPosition } from "./StrategyWizard";

type Props = {
  symbol: string;
  position?: StrategyWizardPosition;
  positionSource?: "binance";
  interval: string;
  accountConnected: boolean;
  liveTradingAvailable: boolean;
  currentPrice: number;
  maLength: number;
  maValue: number;
  entryAtrUpper: number;
  entryAtrLower: number;
  accountBalance: number;
  onAccountChanged: () => void;
};

export default function AdaptiveStrategyPanel({ symbol, position, interval, liveTradingAvailable, currentPrice, maValue, onAccountChanged }: Props) {
  return <StrategyWizard
    symbol={symbol}
    position={position}
    currentPrice={currentPrice}
    chartTimeframe={interval}
    chartMa={maValue}
    liveTradingAvailable={liveTradingAvailable}
    onStrategyCreated={onAccountChanged}
  />;
}
