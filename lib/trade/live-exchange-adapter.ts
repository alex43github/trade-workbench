import crypto from "node:crypto";
import { normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";
import { resolvePositionMode, type EntryDirection, type PositionMode } from "./position-mode.ts";
import {
  BybitLiveAdapter,
  type BybitLiveAdapterDependencies,
} from "./bybit-live-adapter.ts";

export type RuntimeEnv = Record<string, string | undefined>;

export type BinanceRequest = (path: string, init?: RequestInit) => Promise<Response | unknown>;

export type BinanceLiveAdapterDependencies = {
  request?: BinanceRequest;
  transport?: BinanceRequest;
  fetcher?: BinanceRequest;
  now?: () => number;
  idFactory?: () => string;
};

const LIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function expandLiveExponential(value: string): string {
  if (!/[eE]/.test(value)) return value;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const sign = match[1] === "-" ? "-" : "";
  const digits = `${match[2]}${match[3] ?? ""}`;
  const decimalIndex = match[2].length + Number(match[4]);
  if (decimalIndex <= 0) return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function livePositiveDecimal(value: unknown, label: string): string {
  const raw = expandLiveExponential(value === undefined || value === null ? "" : String(value).trim());
  if (!LIVE_DECIMAL_PATTERN.test(raw) || Number(raw) <= 0 || !Number.isFinite(Number(raw))) throw new Error(`${label}必须是正数`);
  return raw;
}

export type LiveOrderOrigin = "WEB" | "TELEGRAM";
export type LiveOrderSide = "BUY" | "SELL";
export type LiveOrderType = "LIMIT" | "MARKET";
export type LivePositionSide = "BOTH" | "LONG" | "SHORT";
export type LiveOrderStatus = "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN";

export type LiveOrderInput = {
  symbol: string;
  side: LiveOrderSide;
  type: LiveOrderType;
  timeInForce?: string;
  price?: string | number;
  quantity: string | number;
  origin: LiveOrderOrigin;
  newClientOrderId?: string;
  clientOrderId?: string;
  orderLinkId?: string;
  positionIdx?: number | string;
  positionSide?: LivePositionSide;
  reduceOnly?: boolean;
};

export type LiveConditionalOrderStrategy = "TP" | "SL";

/**
 * A native conditional market exit.  The exchange adapter owns the wire
 * representation; callers can only choose the bounded TP/SL intent and the
 * persisted position identity.
 */
export type LiveConditionalOrderInput = Omit<LiveOrderInput, "price" | "timeInForce" | "type" | "reduceOnly"> & {
  type: "MARKET";
  triggerPrice: string | number;
  strategyType: LiveConditionalOrderStrategy;
  positionIdx: number | string;
  reduceOnly?: true;
};

export type LiveFindOrderInput = {
  symbol: string;
  clientOrderId?: string;
  orderLinkId?: string;
};

export type LiveCancelInput = {
  symbol: string;
  orderId?: string | number;
  clientOrderId?: string;
  orderLinkId?: string;
};

export type LiveOrderResult = {
  orderId: string | null;
  clientOrderId: string | null;
  orderLinkId?: string | null;
  symbol?: string;
  side?: LiveOrderSide;
  type?: LiveOrderType;
  status: LiveOrderStatus;
  price?: string | null;
  avgPrice?: string | null;
  quantity?: string | null;
  executedQty?: string | null;
  executedQuantity?: string | null;
  reduceOnly?: boolean;
  positionIdx?: number;
  positionSide?: LivePositionSide;
  error?: string;
};

export type LiveInstrumentFilter = {
  filterType: string;
  tickSize?: string | number;
  stepSize?: string | number;
  minQty?: string | number;
  minNotional?: string | number;
  notional?: string | number;
};

export type LiveInstrument = {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  status?: string;
  contractType?: string;
  filters: LiveInstrumentFilter[];
  tickSize?: string | number;
  stepSize?: string | number;
  minQty?: string | number;
  minNotional?: string | number;
};

export type LiveAccount = {
  availableBalance: string;
  totalWalletBalance?: string;
  accountType?: string;
};

export type LiveContractSettings = { leverage: string; positionMode: PositionMode };

export type LivePosition = {
  symbol: string;
  positionAmt: string;
  positionSide: LivePositionSide;
  positionIdx?: number;
  side?: "Buy" | "Sell" | "None";
  size?: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedPnl?: string;
  leverage?: string;
  positionIM?: string;
};

export type LiveExecution = { symbol: string; realizedPnl: string };

export type LiveOpenOrder = LiveOrderResult & {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: LiveOrderSide;
  type: LiveOrderType;
  status: LiveOrderStatus;
  quantity: string;
};

/**
 * An order-history row may be a native exchange order without a client/order
 * link id.  Keep that distinction explicit so manual-position discovery does
 * not invent a client id or confuse a native order with a Workbench order.
 */
export type LiveHistoricalOrder = LiveOrderResult & {
  orderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: LiveOrderSide;
  type: LiveOrderType;
  status: LiveOrderStatus;
  quantity: string;
  executedQty: string;
  /** Exchange event time used to reconcile native entry and exit fills. */
  updateTime?: string;
  positionIdx?: number;
  positionSide?: LivePositionSide;
};

export type LiveCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LiveExchangeAdapter = {
  readonly exchange: LiveExchange;
  instrument(symbol: string): Promise<LiveInstrument>;
  account(): Promise<LiveAccount>;
  position(symbol: string): Promise<LivePosition[]>;
  /** Reads contract settings even when there is no open position. */
  leverage?(symbol: string): Promise<string | null>;
  positionMode?(): Promise<PositionMode>;
  contractSettings?(input: { symbol: string; direction: EntryDirection }): Promise<LiveContractSettings>;
  allPositions(): Promise<LivePosition[]>;
  openOrders(symbol: string): Promise<LiveOpenOrder[]>;
  allOpenOrders(): Promise<LiveOpenOrder[]>;
  /** Optional because Binance legacy callers use the existing allOrders gateway path. */
  orderHistory?: (symbol: string) => Promise<LiveHistoricalOrder[]>;
  executionHistory?: () => Promise<LiveExecution[]>;
  submitLimit(input: LiveOrderInput): Promise<LiveOrderResult>;
  submitReduceOnlyMarket(input: LiveOrderInput): Promise<LiveOrderResult>;
  submitReduceOnlyConditionalMarket(input: LiveConditionalOrderInput): Promise<LiveOrderResult>;
  cancel(input: LiveCancelInput): Promise<LiveOrderResult>;
  findByClientId(input: LiveFindOrderInput): Promise<LiveOpenOrder | null>;
  closedCandles(symbol: string, timeframe: string, limit?: number): Promise<LiveCandle[]>;
};

export type LiveExchangeAdapterDependencies = {
  request?: BybitLiveAdapterDependencies["request"];
  now?: () => number;
  idFactory?: () => string;
  bybit?: BybitLiveAdapterDependencies;
  binance?: BinanceLiveAdapterDependencies;
};

type BinanceOrderRow = {
  orderId?: unknown;
  clientOrderId?: unknown;
  symbol?: unknown;
  side?: unknown;
  type?: unknown;
  status?: unknown;
  price?: unknown;
  origQty?: unknown;
  executedQty?: unknown;
  reduceOnly?: unknown;
  positionSide?: unknown;
};

function binanceRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function binanceString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function binanceOptionalString(value: unknown): string | null {
  const result = binanceString(value).trim();
  return result ? result : null;
}

function binanceSymbol(value: unknown): string {
  const symbol = binanceString(value).trim().toUpperCase();
  if (!/^[A-Z0-9]{2,24}(?:USDT|USDC)$/.test(symbol)) throw new Error("Binance 合约币种不正确");
  return symbol;
}

function binanceQuery(path: string, params: Record<string, string>) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

function binanceOrderStatus(value: unknown): LiveOrderStatus {
  const status = binanceString(value).toUpperCase();
  if (status === "FILLED") return "FILLED";
  if (["CANCELED", "CANCELLED", "EXPIRED"].includes(status)) return "CANCELED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "PARTIALLY_FILLED") return "PARTIALLY_FILLED";
  if (!status) return "UNKNOWN";
  return "SUBMITTED";
}

function normalizeBinanceOrder(row: BinanceOrderRow, fallback: Partial<LiveOrderResult> = {}): LiveOrderResult {
  const orderId = binanceOptionalString(row.orderId) ?? fallback.orderId ?? null;
  const clientOrderId = binanceOptionalString(row.clientOrderId) ?? fallback.clientOrderId ?? null;
  const executedQty = binanceOptionalString(row.executedQty) ?? fallback.executedQty ?? fallback.executedQuantity ?? null;
  return {
    orderId,
    clientOrderId,
    ...(clientOrderId ? { orderLinkId: clientOrderId } : {}),
    ...(binanceOptionalString(row.symbol) || fallback.symbol ? { symbol: binanceOptionalString(row.symbol) ?? fallback.symbol } : {}),
    ...(row.side === "BUY" || row.side === "SELL" ? { side: row.side } : fallback.side ? { side: fallback.side } : {}),
    ...(row.type === "LIMIT" || row.type === "MARKET" ? { type: row.type } : fallback.type ? { type: fallback.type } : {}),
    status: binanceOrderStatus(row.status ?? fallback.status),
    price: binanceOptionalString(row.price) ?? fallback.price ?? null,
    ...(fallback.avgPrice === undefined ? {} : { avgPrice: fallback.avgPrice }),
    quantity: binanceOptionalString(row.origQty) ?? fallback.quantity ?? null,
    executedQty,
    executedQuantity: executedQty,
    ...(typeof row.reduceOnly === "boolean" ? { reduceOnly: row.reduceOnly } : fallback.reduceOnly === undefined ? {} : { reduceOnly: fallback.reduceOnly }),
  };
}

function binanceResponseResult(payload: unknown, token: string): unknown {
  if (binanceRecord(payload) && ("code" in payload || "msg" in payload) && Number(payload.code ?? 0) !== 0) {
    const message = binanceOptionalString(payload.msg) ?? `HTTP ${String(payload.code)}`;
    throw new Error(message.split(token).join("[redacted]"));
  }
  return payload;
}

function binanceList(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : binanceRecord(payload) && Array.isArray(payload.list) ? payload.list : [];
}

function binanceResponseCandle(row: unknown): LiveCandle | null {
  if (!Array.isArray(row) || row.length < 7) return null;
  const values = row.slice(0, 7).map(Number);
  if (values.some((value) => !Number.isFinite(value)) || values[2] < values[3] || values[4] <= 0) return null;
  return { openTime: values[0], open: values[1], high: values[2], low: values[3], close: values[4], volume: values[5], closeTime: values[6] };
}

export class BinanceLiveAdapter implements LiveExchangeAdapter {
  readonly exchange = "BINANCE" as const;

  private readonly env: RuntimeEnv;
  private readonly requestTransport: BinanceRequest;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(env: RuntimeEnv = process.env, dependencies: BinanceLiveAdapterDependencies = {}) {
    this.env = env;
    const baseUrl = String(env.BINANCE_GATEWAY_BASE_URL ?? "").trim();
    const token = String(env.BINANCE_GATEWAY_TOKEN ?? "").trim();
    if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/.test(baseUrl) || token.length < 16) {
      throw new Error("BINANCE_GATEWAY 必须配置为本机回环 HTTP 地址并提供有效 token");
    }
    this.requestTransport = dependencies.request ?? dependencies.transport ?? dependencies.fetcher ?? ((path, init) => fetch(`${baseUrl.replace(/\/+$/, "")}/api/binance${path}`, {
      ...init,
      cache: "no-store",
      headers: { accept: "application/json", ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
      signal: init?.signal ?? AbortSignal.timeout(8_000),
    }));
    this.now = dependencies.now ?? (() => Date.now());
    this.idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  }

  private tradingEnabled() {
    if (String(this.env.BINANCE_GATEWAY_TRADING ?? "false").toLowerCase() !== "true") throw new Error("Binance 交易通道未开启");
  }

  private async requestJson(path: string, init: RequestInit = {}) {
    const response = await this.requestTransport(path, {
      ...init,
      headers: { accept: "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(8_000),
    });
    if (binanceRecord(response) && typeof response.json === "function") {
      const status = Number((response as { status?: unknown }).status ?? 200);
      const ok = (response as { ok?: unknown }).ok !== false && status >= 200 && status < 300;
      const payload = await (response as { json: () => Promise<unknown> }).json().catch(() => ({}));
      if (!ok) {
        const error = Object.assign(new Error(`Binance 网关请求失败 HTTP ${status}`), {
          gatewayStatus: status,
          gatewayCode: binanceRecord(payload) ? payload.code : undefined,
        });
        throw error;
      }
      return binanceResponseResult(payload, String(this.env.BINANCE_GATEWAY_TOKEN ?? ""));
    }
    return binanceResponseResult(response, String(this.env.BINANCE_GATEWAY_TOKEN ?? ""));
  }

  async instrument(symbolInput: string): Promise<LiveInstrument> {
    const symbol = binanceSymbol(symbolInput);
    const result = await this.requestJson(binanceQuery("/fapi/v1/exchangeInfo", { symbol }));
    const row = binanceList(binanceRecord(result) ? result.symbols : result).find((candidate) => binanceRecord(candidate) && binanceString(candidate.symbol).toUpperCase() === symbol);
    const source = binanceRecord(row) ? row : {};
    const filters = Array.isArray(source.filters) ? source.filters as LiveInstrumentFilter[] : [];
    return { symbol, filters, ...(binanceOptionalString(source.baseAsset) ? { baseAsset: binanceOptionalString(source.baseAsset)! } : {}), ...(binanceOptionalString(source.quoteAsset) ? { quoteAsset: binanceOptionalString(source.quoteAsset)! } : {}), ...(binanceOptionalString(source.status) ? { status: binanceOptionalString(source.status)! } : {}) };
  }

  async account(): Promise<LiveAccount> {
    const result = await this.requestJson("/fapi/v3/account");
    const source = binanceRecord(result) ? result : {};
    return { availableBalance: binanceOptionalString(source.availableBalance) ?? "0", totalWalletBalance: binanceOptionalString(source.totalWalletBalance) ?? undefined };
  }

  async position(symbolInput: string): Promise<LivePosition[]> {
    const symbol = binanceSymbol(symbolInput);
    const result = await this.requestJson(binanceQuery("/fapi/v2/positionRisk", { symbol }));
    return binanceList(result).filter(binanceRecord).map((row) => {
      const amount = binanceOptionalString(row.positionAmt) ?? "0";
      const side: LivePosition["positionSide"] = Number(amount) < 0 ? "SHORT" : Number(amount) > 0 ? "LONG" : "BOTH";
      const positionSide: LivePosition["positionSide"] = row.positionSide === "LONG" || row.positionSide === "SHORT" ? row.positionSide : side;
      return { symbol: binanceString(row.symbol).toUpperCase() || symbol, positionAmt: amount, positionSide, ...(binanceOptionalString(row.entryPrice) ? { entryPrice: binanceOptionalString(row.entryPrice)! } : {}), ...(binanceOptionalString(row.markPrice) ? { markPrice: binanceOptionalString(row.markPrice)! } : {}), ...(binanceOptionalString(row.unRealizedProfit) ? { unrealizedPnl: binanceOptionalString(row.unRealizedProfit)! } : {}), ...(binanceOptionalString(row.leverage) ? { leverage: binanceOptionalString(row.leverage)! } : {}) };
    }).filter((row) => row.positionAmt !== "0");
  }

  async leverage(symbolInput: string): Promise<string | null> {
    const symbol = binanceSymbol(symbolInput);
    const result = await this.requestJson(binanceQuery("/fapi/v2/positionRisk", { symbol }));
    const row = binanceList(result).find((candidate) => binanceRecord(candidate) && binanceString(candidate.symbol).toUpperCase() === symbol);
    return binanceRecord(row) ? binanceOptionalString(row.leverage) : null;
  }

  async positionMode(): Promise<PositionMode> {
    const result = await this.requestJson("/fapi/v2/positionRisk");
    return resolvePositionMode(binanceList(result).filter(binanceRecord));
  }

  async contractSettings(input: { symbol: string; direction: EntryDirection }): Promise<LiveContractSettings> {
    const symbol = binanceSymbol(input.symbol);
    const result = await this.requestJson("/fapi/v2/positionRisk");
    const rows = binanceList(result).filter(binanceRecord);
    const row = rows.find((candidate) => binanceString(candidate.symbol).toUpperCase() === symbol);
    const leverage = binanceRecord(row) ? binanceOptionalString(row.leverage) : null;
    if (!leverage || Number(leverage) <= 0) throw new Error("当前杠杆无效");
    return { leverage, positionMode: resolvePositionMode(rows) };
  }

  async allPositions(): Promise<LivePosition[]> {
    const result = await this.requestJson("/fapi/v2/positionRisk");
    return binanceList(result).filter(binanceRecord).map((row) => {
      const amount = binanceOptionalString(row.positionAmt) ?? "0";
      const side: LivePosition["positionSide"] = Number(amount) < 0 ? "SHORT" : Number(amount) > 0 ? "LONG" : "BOTH";
      const positionSide: LivePosition["positionSide"] = row.positionSide === "LONG" || row.positionSide === "SHORT" ? row.positionSide : side;
      return { symbol: binanceString(row.symbol).toUpperCase(), positionAmt: amount, positionSide, ...(binanceOptionalString(row.entryPrice) ? { entryPrice: binanceOptionalString(row.entryPrice)! } : {}), ...(binanceOptionalString(row.markPrice) ? { markPrice: binanceOptionalString(row.markPrice)! } : {}), ...(binanceOptionalString(row.unRealizedProfit) ? { unrealizedPnl: binanceOptionalString(row.unRealizedProfit)! } : {}), ...(binanceOptionalString(row.leverage) ? { leverage: binanceOptionalString(row.leverage)! } : {}) };
    }).filter((row) => row.symbol.length > 0 && row.positionAmt !== "0");
  }

  async openOrders(symbolInput: string): Promise<LiveOpenOrder[]> {
    const symbol = binanceSymbol(symbolInput);
    const result = await this.requestJson(binanceQuery("/fapi/v1/openOrders", { symbol }));
    return binanceList(result).filter(binanceRecord).map((row) => normalizeBinanceOrder(row as BinanceOrderRow)).filter((row): row is LiveOpenOrder => Boolean(row.orderId && row.clientOrderId && row.symbol && row.side && row.type && row.quantity));
  }

  async allOpenOrders(): Promise<LiveOpenOrder[]> {
    const result = await this.requestJson("/fapi/v1/openOrders");
    return binanceList(result).filter(binanceRecord).map((row) => normalizeBinanceOrder(row as BinanceOrderRow)).filter((row): row is LiveOpenOrder => Boolean(row.orderId && row.clientOrderId && row.symbol && row.side && row.type && row.quantity));
  }

  async findByClientId(input: LiveFindOrderInput): Promise<LiveOpenOrder | null> {
    const symbol = binanceSymbol(input.symbol);
    const clientOrderId = binanceOptionalString(input.clientOrderId ?? input.orderLinkId);
    if (!clientOrderId) throw new Error("Binance client order ID 不正确");
    let result: unknown;
    try {
      result = await this.requestJson(binanceQuery("/fapi/v1/order", { symbol, origClientOrderId: clientOrderId }));
    } catch (error) {
      const gatewayError = error as { gatewayStatus?: unknown; gatewayCode?: unknown };
      if (gatewayError.gatewayStatus === 400 && Number(gatewayError.gatewayCode) === -2013) return null;
      throw error;
    }
    const normalized = normalizeBinanceOrder((binanceRecord(result) ? result : {}) as BinanceOrderRow);
    return normalized.orderId && normalized.clientOrderId ? normalized as LiveOpenOrder : null;
  }

  async submitLimit(input: LiveOrderInput): Promise<LiveOrderResult> {
    this.tradingEnabled();
    const symbol = binanceSymbol(input.symbol);
    if (input.side !== "BUY" && input.side !== "SELL") throw new Error("Binance 订单方向不正确");
    if (input.type !== "LIMIT") throw new Error("Binance submitLimit 只接受 LIMIT");
    if (String(input.timeInForce ?? "GTX").toUpperCase() !== "GTX") throw new Error("Binance 限价单必须使用 GTX");
    const id = binanceOptionalString(input.newClientOrderId ?? input.clientOrderId ?? input.orderLinkId) ?? `${input.origin === "TELEGRAM" ? "teleBN" : "webBN"}${this.idFactory().replaceAll("-", "").slice(0, 24)}`;
    const params = new URLSearchParams({ symbol, side: input.side, positionSide: input.positionSide ?? "BOTH", type: "LIMIT", timeInForce: "GTX", price: String(input.price), quantity: String(input.quantity), newClientOrderId: id });
    const result = await this.requestJson("/fapi/v1/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
    return normalizeBinanceOrder((binanceRecord(result) ? result : {}) as BinanceOrderRow, { symbol, side: input.side, type: "LIMIT", price: String(input.price), quantity: String(input.quantity), clientOrderId: id });
  }

  async submitReduceOnlyMarket(input: LiveOrderInput): Promise<LiveOrderResult> {
    this.tradingEnabled();
    const symbol = binanceSymbol(input.symbol);
    if (input.side !== "BUY" && input.side !== "SELL") throw new Error("Binance 订单方向不正确");
    if (input.type !== "MARKET") throw new Error("Binance submitReduceOnlyMarket 只接受 MARKET");
    const id = binanceOptionalString(input.newClientOrderId ?? input.clientOrderId ?? input.orderLinkId) ?? `${input.origin === "TELEGRAM" ? "teleBN" : "webBN"}${this.idFactory().replaceAll("-", "").slice(0, 24)}`;
    const params = new URLSearchParams({ symbol, side: input.side, type: "MARKET", quantity: String(input.quantity), reduceOnly: "true", newClientOrderId: id });
    const result = await this.requestJson("/fapi/v1/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
    return normalizeBinanceOrder((binanceRecord(result) ? result : {}) as BinanceOrderRow, { symbol, side: input.side, type: "MARKET", quantity: String(input.quantity), clientOrderId: id, reduceOnly: true });
  }

  async submitReduceOnlyConditionalMarket(input: LiveConditionalOrderInput): Promise<LiveOrderResult> {
    this.tradingEnabled();
    const symbol = binanceSymbol(input.symbol);
    if (input.side !== "BUY" && input.side !== "SELL") throw new Error("Binance 订单方向不正确");
    if (input.type !== "MARKET") throw new Error("Binance 条件保护单只接受 MARKET");
    const strategyType = String(input.strategyType ?? "").trim().toUpperCase();
    if (strategyType !== "TP" && strategyType !== "SL") throw new Error("条件保护单类型必须是 TP 或 SL");
    const triggerPrice = livePositiveDecimal(input.triggerPrice, "触发价格");
    const quantity = livePositiveDecimal(input.quantity, "数量");
    const positionIdx = Number(input.positionIdx);
    if (!Number.isInteger(positionIdx) || positionIdx < 0 || positionIdx > 2) throw new Error("Binance 条件保护单 positionIdx 必须为 0、1 或 2");
    const positionSide = input.positionSide === undefined
      ? positionIdx === 1 ? "LONG" : positionIdx === 2 ? "SHORT" : "BOTH"
      : String(input.positionSide).trim().toUpperCase();
    if (!(positionSide === "BOTH" || positionSide === "LONG" || positionSide === "SHORT")) throw new Error("Binance 条件保护单持仓方向不正确");
    if (positionIdx === 1 && positionSide !== "LONG") throw new Error("Binance 条件保护单 positionIdx 与持仓方向不一致");
    if (positionIdx === 2 && positionSide !== "SHORT") throw new Error("Binance 条件保护单 positionIdx 与持仓方向不一致");
    if (positionSide === "LONG" && input.side !== "SELL") throw new Error("Binance 条件保护单方向与持仓方向不一致");
    if (positionSide === "SHORT" && input.side !== "BUY") throw new Error("Binance 条件保护单方向与持仓方向不一致");
    const id = binanceOptionalString(input.newClientOrderId ?? input.clientOrderId ?? input.orderLinkId)
      ?? `${input.origin === "TELEGRAM" ? "teleBN" : "webBN"}${this.idFactory().replaceAll("-", "").slice(0, 24)}`;
    const type = strategyType === "TP" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET";
    const params = new URLSearchParams({
      symbol,
      side: input.side,
      type,
      stopPrice: triggerPrice,
      quantity,
      newClientOrderId: id,
      ...(positionSide === "LONG" || positionSide === "SHORT" ? { positionSide } : { reduceOnly: "true" }),
    });
    const result = await this.requestJson("/fapi/v1/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
    return normalizeBinanceOrder((binanceRecord(result) ? result : {}) as BinanceOrderRow, {
      symbol, side: input.side, type: "MARKET", quantity, clientOrderId: id,
      reduceOnly: positionSide === "BOTH",
    });
  }

  async cancel(input: LiveCancelInput): Promise<LiveOrderResult> {
    this.tradingEnabled();
    const symbol = binanceSymbol(input.symbol);
    const id = binanceOptionalString(input.clientOrderId ?? input.orderLinkId);
    const orderId = binanceOptionalString(input.orderId);
    if (Boolean(id) === Boolean(orderId)) throw new Error("Binance 撤单必须且只能包含 orderId 或 clientOrderId");
    const result = await this.requestJson(binanceQuery("/fapi/v1/order", { symbol, ...(id ? { origClientOrderId: id } : { orderId: orderId! }) }), { method: "DELETE" });
    return normalizeBinanceOrder((binanceRecord(result) ? result : {}) as BinanceOrderRow, { symbol, clientOrderId: id, orderId, status: "CANCELED" });
  }

  async closedCandles(symbolInput: string, timeframe: string, limitInput?: number): Promise<LiveCandle[]> {
    const symbol = binanceSymbol(symbolInput);
    const limit = limitInput === undefined ? 200 : Number(limitInput);
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_500) throw new Error("K线数量不正确");
    const result = await this.requestJson(binanceQuery("/fapi/v1/klines", { symbol, interval: timeframe, limit: String(limit) }));
    return binanceList(result).map(binanceResponseCandle).filter((row): row is LiveCandle => row !== null && row.closeTime <= this.now()).sort((left, right) => left.openTime - right.openTime);
  }
}

/**
 * Resolve one exchange adapter from the persisted/live exchange enum.
 * The optional request dependency is intentionally transport-shaped so tests
 * can exercise normalization without opening a socket or calling an exchange.
 */
export function resolveLiveExchangeAdapter(
  exchange: LiveExchange | string | unknown,
  env: RuntimeEnv = process.env,
  dependencies: LiveExchangeAdapterDependencies | BybitLiveAdapterDependencies["request"] = {},
): LiveExchangeAdapter {
  const normalized = normalizeLiveExchange(exchange);
  const options = typeof dependencies === "function" ? { request: dependencies } : dependencies;
  if (normalized === "BYBIT") {
    const bybitDependencies = options.bybit ?? options;
    return new BybitLiveAdapter(env, bybitDependencies);
  }
  const binanceDependencies = options.binance ?? options;
  return new BinanceLiveAdapter(env, binanceDependencies);
}

export { BybitLiveAdapter };
