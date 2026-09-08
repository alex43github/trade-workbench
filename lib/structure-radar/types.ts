export type Timeframe = "15m" | "1h" | "4h";

export type SetupKind = "PLATFORM_RECLAIM" | "TRENDLINE_BREAKOUT";

export type SignalState =
  | "WATCHING"
  | "CANDIDATE"
  | "CONFIRMED"
  | "ADD_CANDIDATE"
  | "TAKE_PROFIT_WATCH"
  | "EXPIRED"
  | "INVALIDATED";

export type ClosedBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: true;
};

export type IndexedPrice = {
  index: number;
  time: number;
  price: number;
};

export type PriceLine = {
  start: IndexedPrice;
  end: IndexedPrice;
  slopePerBar: number;
};

export type StructureCandidate = {
  symbol: string;
  timeframe: Timeframe;
  setup: SetupKind;
  state: "CANDIDATE";
  detectedAt: number;
  score: number;
  anchorHash: string;
};
