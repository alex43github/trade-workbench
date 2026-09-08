import crypto from "node:crypto";
import { assertLiveTimeframe } from "./live-exchange.ts";
import type { PositionMode } from "./position-mode.ts";
import type {
  LiveAccount,
  LiveContractSettings,
  LiveCancelInput,
  LiveCandle,
  LiveExecution,
  LiveConditionalOrderInput,
  LiveExchangeAdapter,
  LiveFindOrderInput,
  LiveHistoricalOrder,
  LiveInstrument,
  LiveInstrumentFilter,
  LiveOpenOrder,
  LiveOrderInput,
  LiveOrderResult,
  LivePosition,
  RuntimeEnv,
} from "./live-exchange-adapter.ts";

const BYBIT_SYMBOL_PATTERN = /^[A-Z0-9]{2,24}USDT$/;
const ORDER_LINK_ID_PATTERN = /^(web|tele)BY[A-Za-z0-9_-]{1,31}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const BYBIT_INTERVALS = new Map([
  ["15m", { value: "15", milliseconds: 15 * 60 * 1_000 }],
  ["1h", { value: "60", milliseconds: 60 * 60 * 1_000 }],
  ["4h", { value: "240", milliseconds: 4 * 60 * 60 * 1_000 }],
  ["1d", { value: "D", milliseconds: 24 * 60 * 60 * 1_000 }],
]);
const MAX_KLINE_LIMIT = 1_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type BybitGatewayConfig = {
  baseUrl: string;
  token: string;
  tradingEnabled: boolean;
  configured: boolean;
};

export type BybitRequest = (path: string, init?: RequestInit) => Promise<Response | unknown>;

export type BybitLiveAdapterDependencies = {
  request?: BybitRequest;
  transport?: BybitRequest;
  fetcher?: BybitRequest;
  now?: () => number;
  idFactory?: () => string;
};

type BybitEnvelope = {
  retCode?: unknown;
  retMsg?: unknown;
  result?: unknown;
};

type BybitInstrumentRow = {
  symbol?: unknown;
  status?: unknown;
  baseCoin?: unknown;
  quoteCoin?: unknown;
  settleCoin?: unknown;
  contractType?: unknown;
  minNotionalValue?: unknown;
  priceFilter?: { tickSize?: unknown };
  lotSizeFilter?: { qtyStep?: unknown; minOrderQty?: unknown; maxOrderQty?: unknown; minOrderAmt?: unknown; minNotionalValue?: unknown };
  leverageFilter?: { minLeverage?: unknown; maxLeverage?: unknown; leverageStep?: unknown };
};

type BybitOrderRow = {
  orderId?: unknown;
  orderLinkId?: unknown;
  symbol?: unknown;
  side?: unknown;
  orderType?: unknown;
  orderStatus?: unknown;
  qty?: unknown;
  price?: unknown;
  cumExecQty?: unknown;
  avgPrice?: unknown;
  reduceOnly?: unknown;
  positionIdx?: unknown;
  leavesQty?: unknown;
  rejectReason?: unknown;
  updatedTime?: unknown;
  createdTime?: unknown;
};

type BybitPositionRow = {
  symbol?: unknown;
  side?: unknown;
  size?: unknown;
  positionIdx?: unknown;
  avgPrice?: unknown;
  entryPrice?: unknown;
  markPrice?: unknown;
  unrealisedPnl?: unknown;
  unrealizedPnl?: unknown;
  leverage?: unknown;
  positionIM?: unknown;
};

type BybitCoinRow = {
  coin?: unknown;
  walletBalance?: unknown;
  availableToWithdraw?: unknown;
  availableBalance?: unknown;
  equity?: unknown;
};

type BybitAccountRow = {
  accountType?: unknown;
  totalWalletBalance?: unknown;
  totalEquity?: unknown;
  totalAvailableBalance?: unknown;
  coin?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function optionalString(value: unknown): string | null {
  const normalized = stringValue(value).trim();
  return normalized ? normalized : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown, label: string, fallback: number) {
  const parsed = Number(value);
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}必须是正整数`);
  return parsed;
}

function normalizeSymbol(value: unknown): string {
  const symbol = stringValue(value).trim().toUpperCase();
  if (!BYBIT_SYMBOL_PATTERN.test(symbol)) throw new Error("Bybit 只支持 USDT 结算永续合约");
  return symbol;
}

function expandExponential(value: string): string {
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

function decimalString(value: unknown, label: string): string {
  const raw = expandExponential(stringValue(value).trim());
  if (!DECIMAL_PATTERN.test(raw) || Number(raw) <= 0 || !Number.isFinite(Number(raw))) throw new Error(`${label}必须是正数`);
  return raw;
}

function isLoopbackHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function getBybitGatewayConfig(env: RuntimeEnv = process.env): BybitGatewayConfig {
  const baseUrl = String(env.BYBIT_GATEWAY_BASE_URL ?? "").trim();
  const token = String(env.BYBIT_GATEWAY_TOKEN ?? "").trim();
  const tradingEnabled = String(env.BYBIT_GATEWAY_TRADING ?? "false").toLowerCase() === "true";
  return {
    baseUrl,
    token,
    tradingEnabled,
    configured: isLoopbackHttpUrl(baseUrl) && token.length >= 16,
  };
}

function safeError(error: unknown, token = "") {
  let message = error instanceof Error ? error.message : String(error ?? "未知错误");
  if (token) message = message.split(token).join("[redacted]");
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function sanitizedError(error: unknown, token: string) {
  const output = new Error(safeError(error, token));
  if (error instanceof Error && error.name) output.name = error.name;
  return output;
}

function requestIsAmbiguous(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError" || name === "TimeoutError" || name === "TypeError" || /timeout|timed out|超时|network|fetch failed/i.test(safeError(error));
}

function resultList(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (isRecord(result) && Array.isArray(result.list)) return result.list;
  return [];
}

function responseResult(payload: unknown): unknown {
  if (!isRecord(payload) || !("retCode" in payload) && !("result" in payload)) return payload;
  const envelope = payload as BybitEnvelope;
  const code = Number(envelope.retCode ?? 0);
  if (code !== 0) {
    const reason = optionalString(envelope.retMsg) ?? `retCode ${code}`;
    throw new Error(`Bybit 请求被拒绝：${reason}`);
  }
  return envelope.result ?? {};
}

function mapSide(value: unknown): "BUY" | "SELL" | undefined {
  const side = stringValue(value).trim().toUpperCase();
  if (side === "BUY") return "BUY";
  if (side === "SELL") return "SELL";
  return undefined;
}

function mapType(value: unknown): "LIMIT" | "MARKET" | undefined {
  const type = stringValue(value).trim().toUpperCase();
  if (type === "LIMIT") return "LIMIT";
  if (type === "MARKET") return "MARKET";
  return undefined;
}

function mapStatus(value: unknown): LiveOrderResult["status"] {
  const status = stringValue(value).trim().toUpperCase().replaceAll("_", "");
  if (["FILLED", "TRIGGERED"].includes(status)) return "FILLED";
  if (["CANCELLED", "CANCELED", "DEACTIVATED", "EXPIRED", "PARTIALLYFILLEDCANCELED"].includes(status)) return "CANCELED";
  if (["REJECTED", "REJECT"].includes(status)) return "REJECTED";
  if (["PARTIALLYFILLED", "PARTIALLYFILLED-cancelled".toUpperCase()].includes(status)) return "PARTIALLY_FILLED";
  if (["UNKNOWN", ""].includes(status)) return "UNKNOWN";
  return "SUBMITTED";
}

function positionIndex(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 0;
}

function strictPositionIndex(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) {
    throw new Error("Bybit positionIdx 无效");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) throw new Error("Bybit positionIdx 无效");
  return parsed;
}

function positionSideFromIndex(index: number): LivePosition["positionSide"] {
  if (index === 1) return "LONG";
  if (index === 2) return "SHORT";
  // Bybit's one-way mode uses positionIdx=0 for both Buy and Sell.
  // The side is the order/position direction, not a hedge-side selector.
  return "BOTH";
}

function normalizeOrder(row: BybitOrderRow, fallback: Partial<LiveOrderResult> = {}): LiveOrderResult {
  const orderId = optionalString(row.orderId) ?? fallback.orderId ?? null;
  const orderLinkId = optionalString(row.orderLinkId) ?? fallback.clientOrderId ?? fallback.orderLinkId ?? null;
  const side = mapSide(row.side) ?? fallback.side;
  const type = mapType(row.orderType) ?? fallback.type;
  const quantity = optionalString(row.qty) ?? fallback.quantity ?? null;
  const executedQty = optionalString(row.cumExecQty) ?? fallback.executedQty ?? fallback.executedQuantity ?? null;
  const index = positionIndex(row.positionIdx ?? fallback.positionIdx);
  return {
    orderId,
    clientOrderId: orderLinkId,
    orderLinkId,
    ...(optionalString(row.symbol) || fallback.symbol ? { symbol: optionalString(row.symbol) ?? fallback.symbol } : {}),
    ...(side ? { side } : {}),
    ...(type ? { type } : {}),
    status: mapStatus(row.orderStatus ?? fallback.status),
    price: optionalString(row.price) ?? fallback.price ?? null,
    ...(optionalString(row.avgPrice) ?? fallback.avgPrice ? { avgPrice: optionalString(row.avgPrice) ?? fallback.avgPrice } : {}),
    quantity,
    executedQty,
    executedQuantity: executedQty,
    ...(typeof row.reduceOnly === "boolean" ? { reduceOnly: row.reduceOnly } : fallback.reduceOnly === undefined ? {} : { reduceOnly: fallback.reduceOnly }),
    positionIdx: index,
    positionSide: positionSideFromIndex(index),
  };
}

function historicalOrder(row: BybitOrderRow): LiveHistoricalOrder | null {
  const normalized = normalizeOrder(row);
  const orderId = optionalString(row.orderId);
  const symbol = optionalString(row.symbol)?.toUpperCase();
  const side = mapSide(row.side);
  const type = mapType(row.orderType);
  const quantity = optionalString(row.qty);
  const updateTime = optionalString(row.updatedTime) ?? optionalString(row.createdTime);
  const rawIndex = optionalString(row.positionIdx);
  const orderStatus = optionalString(row.orderStatus);
  const executedQty = optionalString(row.cumExecQty);
  const normalizedStatus = String(orderStatus ?? "").toUpperCase().replaceAll("_", "");
  const knownStatus = ["NEW", "FILLED", "TRIGGERED", "CANCELLED", "CANCELED", "DEACTIVATED", "EXPIRED", "REJECTED", "REJECT"];
  const quantityValue = numberValue(quantity);
  const executedValue = numberValue(executedQty);
  if (!orderId || !symbol || !side || !type || !quantity || !updateTime || !rawIndex || !orderStatus
    || !executedQty || typeof row.reduceOnly !== "boolean"
    || !knownStatus.includes(normalizedStatus)
    || quantityValue === null || quantityValue <= 0
    || executedValue === null || executedValue < 0 || executedValue > quantityValue
    || (executedValue > 0 && executedValue < quantityValue)
    || numberValue(updateTime) === null || numberValue(updateTime)! <= 0) return null;
  let index: number;
  try { index = strictPositionIndex(rawIndex); }
  catch { return null; }
  const orderLinkId = optionalString(row.orderLinkId);
  return {
    ...normalized,
    orderId,
    clientOrderId: orderLinkId,
    ...(orderLinkId ? { orderLinkId } : {}),
    symbol,
    side,
    type,
    quantity,
    executedQty,
    executedQuantity: executedQty,
    ...(updateTime ? { updateTime } : {}),
    positionIdx: index,
    positionSide: index >= 0 ? positionSideFromIndex(index) : "BOTH",
  };
}

function asOpenOrder(result: LiveOrderResult): LiveOpenOrder | null {
  if (!result.orderId || !result.clientOrderId || !result.symbol || !result.side || !result.type || !result.quantity) return null;
  return {
    ...result,
    orderId: result.orderId,
    clientOrderId: result.clientOrderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    quantity: result.quantity,
  };
}

function firstOrder(result: unknown, expectedLinkId?: string): LiveOpenOrder | null {
  const row = resultList(result).find((candidate) => {
    if (!isRecord(candidate)) return false;
    if (!expectedLinkId) return true;
    return stringValue(candidate.orderLinkId) === expectedLinkId;
  });
  if (!isRecord(row)) return null;
  return asOpenOrder(normalizeOrder(row as BybitOrderRow));
}

function toFilter(filterType: string, values: Partial<LiveInstrumentFilter>): LiveInstrumentFilter {
  return { filterType, ...values };
}

function normalizeInstrument(result: unknown, requestedSymbol: string): LiveInstrument {
  const row = resultList(result).find((candidate) => isRecord(candidate) && stringValue(candidate.symbol).toUpperCase() === requestedSymbol)
    ?? resultList(result)[0];
  const source = isRecord(row) ? row as BybitInstrumentRow : {};
  const priceFilter = isRecord(source.priceFilter) ? source.priceFilter : {};
  const lotSizeFilter = isRecord(source.lotSizeFilter) ? source.lotSizeFilter : {};
  const tickSize = optionalString(priceFilter.tickSize);
  const stepSize = optionalString(lotSizeFilter.qtyStep);
  const minQty = optionalString(lotSizeFilter.minOrderQty);
  const minNotional = optionalString(lotSizeFilter.minOrderAmt ?? lotSizeFilter.minNotionalValue ?? source.minNotionalValue);
  const filters: LiveInstrumentFilter[] = [];
  if (tickSize) filters.push(toFilter("PRICE_FILTER", { tickSize }));
  if (stepSize || minQty) filters.push(toFilter("LOT_SIZE", { ...(stepSize ? { stepSize } : {}), ...(minQty ? { minQty } : {}) }));
  if (minNotional) filters.push(toFilter("MIN_NOTIONAL", { minNotional, notional: minNotional }));
  return {
    symbol: optionalString(source.symbol)?.toUpperCase() ?? requestedSymbol,
    ...(optionalString(source.baseCoin) ? { baseAsset: optionalString(source.baseCoin)!.toUpperCase() } : {}),
    ...(optionalString(source.quoteCoin) ? { quoteAsset: optionalString(source.quoteCoin)!.toUpperCase() } : {}),
    ...(optionalString(source.status) ? { status: optionalString(source.status)!.toUpperCase() } : {}),
    ...(optionalString(source.contractType) ? { contractType: optionalString(source.contractType)! } : {}),
    filters,
    ...(tickSize ? { tickSize } : {}),
    ...(stepSize ? { stepSize } : {}),
    ...(minQty ? { minQty } : {}),
    ...(minNotional ? { minNotional } : {}),
  };
}

function normalizePosition(row: BybitPositionRow): LivePosition | null {
  const symbol = optionalString(row.symbol)?.toUpperCase();
  const size = optionalString(row.size) ?? "0";
  const sizeNumber = numberValue(size) ?? 0;
  if (!symbol || sizeNumber === 0) return null;
  const side = stringValue(row.side).toUpperCase();
  // A nonzero Bybit position without an explicit valid index cannot be safely
  // matched to manual-source orders in hedge mode. Fail the read instead of
  // silently treating it as one-way positionIdx=0.
  const index = strictPositionIndex(row.positionIdx);
  const positionSide = positionSideFromIndex(index);
  const signedAmount = side === "SELL" || positionSide === "SHORT" ? `-${size.replace(/^-/, "")}` : size.replace(/^\+/, "");
  return {
    symbol,
    positionAmt: signedAmount,
    positionSide,
    positionIdx: index,
    ...(side === "BUY" ? { side: "Buy" as const } : side === "SELL" ? { side: "Sell" as const } : { side: "None" as const }),
    size,
    ...(optionalString(row.avgPrice ?? row.entryPrice) ? { entryPrice: optionalString(row.avgPrice ?? row.entryPrice)! } : {}),
    ...(optionalString(row.markPrice) ? { markPrice: optionalString(row.markPrice)! } : {}),
    ...(optionalString(row.unrealisedPnl ?? row.unrealizedPnl) ? { unrealizedPnl: optionalString(row.unrealisedPnl ?? row.unrealizedPnl)! } : {}),
    ...(optionalString(row.leverage) ? { leverage: optionalString(row.leverage)! } : {}),
    ...(optionalString(row.positionIM) ? { positionIM: optionalString(row.positionIM)! } : {}),
  };
}

function normalizeAccount(result: unknown): LiveAccount {
  const row = resultList(result)[0];
  const source = isRecord(row) ? row as BybitAccountRow : {};
  const coins = Array.isArray(source.coin) ? source.coin : [];
  const coin = coins.find((candidate) => isRecord(candidate) && stringValue((candidate as BybitCoinRow).coin).toUpperCase() === "USDT");
  const usdt = isRecord(coin) ? coin as BybitCoinRow : {};
  const availableBalance = optionalString(usdt.availableBalance ?? usdt.availableToWithdraw ?? source.totalAvailableBalance ?? usdt.walletBalance ?? usdt.equity) ?? "0";
  const totalWalletBalance = optionalString(source.totalWalletBalance ?? source.totalEquity) ?? availableBalance;
  return {
    availableBalance,
    totalWalletBalance,
    ...(optionalString(source.accountType) ? { accountType: optionalString(source.accountType)! } : {}),
  };
}

function normalizeCandle(row: unknown, intervalMs: number): LiveCandle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const openTime = numberValue(row[0]);
  const open = numberValue(row[1]);
  const high = numberValue(row[2]);
  const low = numberValue(row[3]);
  const close = numberValue(row[4]);
  const volume = numberValue(row[5]);
  if ([openTime, open, high, low, close, volume].some((value) => value === null) || high! < low! || close! <= 0) return null;
  return {
    openTime: openTime!,
    closeTime: openTime! + intervalMs - 1,
    open: open!,
    high: high!,
    low: low!,
    close: close!,
    volume: volume!,
  };
}

function originPrefix(origin: unknown): "web" | "tele" {
  const normalized = stringValue(origin).trim().toUpperCase();
  if (normalized === "WEB") return "web";
  if (normalized === "TELEGRAM" || normalized === "TELE") return "tele";
  throw new Error("Bybit 订单来源不正确");
}

function normalizeOrderLinkId(input: LiveOrderInput, idFactory: () => string): string {
  const prefix = originPrefix(input.origin);
  const supplied = optionalString(input.orderLinkId) ?? optionalString(input.newClientOrderId) ?? optionalString(input.clientOrderId);
  if (supplied && ORDER_LINK_ID_PATTERN.test(supplied)) {
    if (!supplied.startsWith(`${prefix}BY`)) throw new Error("orderLinkId 来源与订单来源不一致");
    return supplied;
  }
  let suffix = supplied ?? "";
  suffix = suffix.replace(/^(?:web|tele)(?:BN|IN|MC|BY)?/i, "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!suffix) suffix = idFactory().replaceAll("-", "");
  if (suffix.length < 1) suffix = crypto.randomUUID().replaceAll("-", "");
  const linkId = `${prefix}BY${suffix.slice(0, 31)}`;
  if (!ORDER_LINK_ID_PATTERN.test(linkId)) throw new Error("Bybit orderLinkId 生成失败");
  return linkId;
}

function normalizePositionIdx(input: LiveOrderInput): number {
  const side = input.positionSide ? String(input.positionSide).trim().toUpperCase() : "";
  if (side && !["BOTH", "LONG", "SHORT"].includes(side)) throw new Error("Bybit 持仓方向不正确");
  const supplied = input.positionIdx === undefined ? undefined : Number(input.positionIdx);
  if (supplied !== undefined && (!Number.isInteger(supplied) || supplied < 0 || supplied > 2)) throw new Error("Bybit positionIdx 必须为 0、1 或 2");
  const mapped = side === "LONG" ? 1 : side === "SHORT" ? 2 : side === "BOTH" ? 0 : undefined;
  if (supplied !== undefined && mapped !== undefined && supplied !== mapped) throw new Error("Bybit positionIdx 与持仓方向不一致");
  return supplied ?? mapped ?? 0;
}

function normalizeConditionalPosition(input: LiveConditionalOrderInput): { positionIdx: number; positionSide: "LONG" | "SHORT" } {
  if (input.positionIdx === undefined || input.positionIdx === null || input.positionIdx === "") {
    throw new Error("Bybit 条件保护单必须包含 positionIdx");
  }
  const suppliedSide = input.positionSide === undefined ? "" : String(input.positionSide).trim().toUpperCase();
  if (suppliedSide && !["BOTH", "LONG", "SHORT"].includes(suppliedSide)) throw new Error("Bybit 条件保护单持仓方向不正确");
  // In one-way mode Bybit requires positionIdx=0, while the caller still
  // needs to tell a conditional exit whether it protects a long or short
  // net position.  Keep that directional hint separate from the wire index.
  const positionIdx = Number(input.positionIdx) === 0
    ? normalizePositionIdx({ ...input, positionSide: "BOTH" })
    : normalizePositionIdx(input);
  if (positionIdx === 1 && suppliedSide && suppliedSide !== "LONG") throw new Error("Bybit 条件保护单 positionIdx 与持仓方向不一致");
  if (positionIdx === 2 && suppliedSide && suppliedSide !== "SHORT") throw new Error("Bybit 条件保护单 positionIdx 与持仓方向不一致");
  const positionSide = positionIdx === 1
    ? "LONG"
    : positionIdx === 2
      ? "SHORT"
      : suppliedSide === "LONG" || suppliedSide === "SHORT"
        ? suppliedSide
        : input.side === "SELL" ? "LONG" : "SHORT";
  if (positionSide === "LONG" && input.side !== "SELL") throw new Error("Bybit 条件保护单方向与持仓方向不一致");
  if (positionSide === "SHORT" && input.side !== "BUY") throw new Error("Bybit 条件保护单方向与持仓方向不一致");
  return { positionIdx, positionSide };
}

function conditionalTriggerDirection(strategyType: LiveConditionalOrderInput["strategyType"], positionSide: "LONG" | "SHORT"): 1 | 2 {
  const kind = String(strategyType ?? "").trim().toUpperCase();
  if (kind !== "TP" && kind !== "SL") throw new Error("Bybit 条件保护单类型必须是 TP 或 SL");
  if (kind === "TP") return positionSide === "LONG" ? 1 : 2;
  return positionSide === "LONG" ? 2 : 1;
}

function withQuery(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `${path}?${query.toString()}`;
}

export class BybitLiveAdapter implements LiveExchangeAdapter {
  readonly exchange = "BYBIT" as const;

  private readonly config: BybitGatewayConfig;
  private readonly requestTransport: BybitRequest;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(env: RuntimeEnv = process.env, dependencies: BybitLiveAdapterDependencies | BybitRequest = {}) {
    const options = typeof dependencies === "function" ? { request: dependencies } : dependencies;
    this.config = getBybitGatewayConfig(env);
    if (!this.config.configured) throw new Error("BYBIT_GATEWAY 必须配置为本机回环 HTTP 地址并提供有效 token");
    this.requestTransport = options.request ?? options.transport ?? options.fetcher ?? ((path, init) => {
      const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/bybit${path}`;
      return fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          accept: "application/json",
          ...(init?.headers ?? {}),
          authorization: `Bearer ${this.config.token}`,
        },
        signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    });
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  private ensureTradingEnabled() {
    if (!this.config.tradingEnabled) throw new Error("Bybit 交易通道未开启");
  }

  private async requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response | unknown;
    try {
      response = await this.requestTransport(path, {
        ...init,
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(init.headers ?? {}),
          authorization: `Bearer ${this.config.token}`,
        },
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      let payload: unknown;
      if (isRecord(response) && typeof response.json === "function") {
        const status = Number((response as { status?: unknown }).status ?? 200);
        const ok = (response as { ok?: unknown }).ok !== false && status >= 200 && status < 300;
        payload = await (response as { json: () => Promise<unknown> }).json().catch(() => ({}));
        if (!ok) {
          const message = isRecord(payload) ? optionalString(payload.message ?? payload.retMsg) : null;
          throw new Error(`Bybit 网关请求失败 HTTP ${status}${message ? `：${message}` : ""}`);
        }
      } else {
        payload = response;
      }
      return responseResult(payload);
    } catch (error) {
      throw sanitizedError(error, this.config.token);
    }
  }

  async instrument(symbolInput: string): Promise<LiveInstrument> {
    const symbol = normalizeSymbol(symbolInput);
    const result = await this.requestJson(withQuery("/v5/market/instruments-info", { category: "linear", symbol }));
    return normalizeInstrument(result, symbol);
  }

  async account(): Promise<LiveAccount> {
    const result = await this.requestJson(withQuery("/v5/account/wallet-balance", { category: "linear", accountType: "UNIFIED", coin: "USDT" }));
    return normalizeAccount(result);
  }

  async position(symbolInput: string): Promise<LivePosition[]> {
    const symbol = normalizeSymbol(symbolInput);
    const result = await this.requestJson(withQuery("/v5/position/list", { category: "linear", symbol }));
    return resultList(result).filter(isRecord).map((row) => normalizePosition(row as BybitPositionRow)).filter((row): row is LivePosition => row !== null);
  }

  async leverage(symbolInput: string): Promise<string | null> {
    const symbol = normalizeSymbol(symbolInput);
    const result = await this.requestJson(withQuery("/v5/position/list", { category: "linear", symbol }));
    const row = resultList(result).find((candidate) => isRecord(candidate) && stringValue(candidate.symbol).toUpperCase() === symbol);
    return isRecord(row) ? optionalString((row as BybitPositionRow).leverage) : null;
  }

  async positionMode(): Promise<PositionMode> {
    return "HEDGE";
  }

  async contractSettings(input: { symbol: string; direction: "LONG" | "SHORT" }): Promise<LiveContractSettings> {
    const symbol = normalizeSymbol(input.symbol);
    const result = await this.requestJson(withQuery("/v5/position/list", { category: "linear", symbol }));
    const rows = resultList(result).filter(isRecord).filter((row) => stringValue(row.symbol).toUpperCase() === symbol);
    const indexes = new Set(rows.map((row) => strictPositionIndex(row.positionIdx)));
    const positionMode: PositionMode = indexes.has(0) && indexes.size === 1 ? "ONE_WAY"
      : !indexes.has(0) && indexes.size > 0 && [...indexes].every((index) => index === 1 || index === 2) ? "HEDGE"
      : (() => { throw new Error("Bybit 持仓模式无法安全识别"); })();
    const requiredIndex = positionMode === "ONE_WAY" ? 0 : input.direction === "LONG" ? 1 : 2;
    const row = rows.find((candidate) => strictPositionIndex(candidate.positionIdx) === requiredIndex);
    const leverage = row ? optionalString((row as BybitPositionRow).leverage) : null;
    if (!leverage || Number(leverage) <= 0) throw new Error("当前杠杆无效");
    return { leverage, positionMode };
  }

  async allPositions(): Promise<LivePosition[]> {
    const result = await this.requestJson(withQuery("/v5/position/list", { category: "linear", settleCoin: "USDT" }));
    return resultList(result).filter(isRecord).map((row) => normalizePosition(row as BybitPositionRow)).filter((row): row is LivePosition => row !== null);
  }

  async openOrders(symbolInput: string): Promise<LiveOpenOrder[]> {
    const symbol = normalizeSymbol(symbolInput);
    const result = await this.requestJson(withQuery("/v5/order/realtime", { category: "linear", symbol }));
    return resultList(result).filter(isRecord).map((row) => asOpenOrder(normalizeOrder(row as BybitOrderRow))).filter((row): row is LiveOpenOrder => row !== null);
  }

  async allOpenOrders(): Promise<LiveOpenOrder[]> {
    const result = await this.requestJson(withQuery("/v5/order/realtime", { category: "linear", settleCoin: "USDT" }));
    return resultList(result).filter(isRecord).map((row) => asOpenOrder(normalizeOrder(row as BybitOrderRow))).filter((row): row is LiveOpenOrder => row !== null);
  }

  async executionHistory(): Promise<LiveExecution[]> {
    const rows: LiveExecution[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.requestJson(withQuery("/v5/execution/list", {
        category: "linear", limit: "100", ...(cursor ? { cursor } : {}),
      }));
      rows.push(...resultList(result).filter(isRecord).flatMap((row) => {
        const symbol = optionalString(row.symbol)?.toUpperCase();
        const realizedPnl = optionalString(row.execPnl);
        return symbol && realizedPnl ? [{ symbol, realizedPnl }] : [];
      }));
      const nextCursor = isRecord(result) ? optionalString(result.nextPageCursor) : null;
      if (!nextCursor) return rows;
      if (nextCursor === cursor) throw new Error("Bybit 成交历史分页游标无效");
      cursor = nextCursor;
    }
    throw new Error("Bybit 成交历史超过安全上限");
  }

  async orderHistory(symbolInput: string): Promise<LiveHistoricalOrder[]> {
    const symbol = normalizeSymbol(symbolInput);
    const rows: LiveHistoricalOrder[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.requestJson(withQuery("/v5/order/history", {
        category: "linear",
        symbol,
        limit: "50",
        ...(cursor ? { cursor } : {}),
      }));
      const pageRows = resultList(result);
      if (pageRows.some((row) => !isRecord(row))) {
        throw new Error("Bybit 订单历史记录不完整，暂不能安全识别手动持仓");
      }
      for (const row of pageRows) {
        const order = historicalOrder(row as BybitOrderRow);
        if (!order || order.positionIdx < 0) {
          throw new Error("Bybit 订单历史记录不完整，暂不能安全识别手动持仓");
        }
        rows.push(order);
      }
      const nextCursor = isRecord(result) ? optionalString(result.nextPageCursor) : null;
      if (!nextCursor) return rows;
      if (nextCursor === cursor) throw new Error("Bybit 订单历史分页游标无效，暂不能安全识别手动持仓");
      cursor = nextCursor;
    }
    throw new Error("Bybit 订单历史超过安全上限，暂不能安全识别手动持仓");
  }

  async findByClientId(input: LiveFindOrderInput): Promise<LiveOpenOrder | null> {
    const symbol = normalizeSymbol(input.symbol);
    const clientOrderId = optionalString(input.orderLinkId) ?? optionalString(input.clientOrderId);
    if (!clientOrderId || !ORDER_LINK_ID_PATTERN.test(clientOrderId)) throw new Error("Bybit orderLinkId 不正确");
    const params = { category: "linear", symbol, orderLinkId: clientOrderId };
    const realtime = await this.requestJson(withQuery("/v5/order/realtime", params));
    const active = firstOrder(realtime, clientOrderId);
    if (active) return active;
    const history = await this.requestJson(withQuery("/v5/order/history", params));
    return firstOrder(history, clientOrderId);
  }

  async submitLimit(input: LiveOrderInput): Promise<LiveOrderResult> {
    this.ensureTradingEnabled();
    const symbol = normalizeSymbol(input.symbol);
    const side = String(input.side ?? "").toUpperCase();
    const type = String(input.type ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") throw new Error("Bybit 订单方向不正确");
    if (type !== "LIMIT") throw new Error("Bybit submitLimit 只接受 LIMIT");
    if (String(input.timeInForce ?? "").toUpperCase() !== "GTX") throw new Error("Bybit 限价单必须使用 GTX");
    const price = decimalString(input.price, "价格");
    const quantity = decimalString(input.quantity, "数量");
    const orderLinkId = normalizeOrderLinkId(input, this.idFactory);
    const positionIdx = normalizePositionIdx(input);
    const body = {
      category: "linear",
      symbol,
      side: side === "BUY" ? "Buy" : "Sell",
      orderType: "Limit",
      qty: quantity,
      price,
      timeInForce: "PostOnly",
      positionIdx,
      orderLinkId,
      ...(input.reduceOnly === true ? { reduceOnly: true } : {}),
    };
    return this.submitCreate(body, { symbol, side: side as "BUY" | "SELL", type: "LIMIT", price, quantity, positionIdx, orderLinkId, reduceOnly: input.reduceOnly, status: "SUBMITTED" });
  }

  async submitReduceOnlyMarket(input: LiveOrderInput): Promise<LiveOrderResult> {
    this.ensureTradingEnabled();
    const symbol = normalizeSymbol(input.symbol);
    const side = String(input.side ?? "").toUpperCase();
    const type = String(input.type ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") throw new Error("Bybit 订单方向不正确");
    if (type !== "MARKET") throw new Error("Bybit submitReduceOnlyMarket 只接受 MARKET");
    const quantity = decimalString(input.quantity, "数量");
    const orderLinkId = normalizeOrderLinkId(input, this.idFactory);
    const positionIdx = normalizePositionIdx(input);
    const body = {
      category: "linear",
      symbol,
      side: side === "BUY" ? "Buy" : "Sell",
      orderType: "Market",
      qty: quantity,
      positionIdx,
      orderLinkId,
      reduceOnly: true,
    };
    return this.submitCreate(body, { symbol, side: side as "BUY" | "SELL", type: "MARKET", quantity, positionIdx, orderLinkId, reduceOnly: true, status: "SUBMITTED" });
  }

  async submitReduceOnlyConditionalMarket(input: LiveConditionalOrderInput): Promise<LiveOrderResult> {
    this.ensureTradingEnabled();
    const symbol = normalizeSymbol(input.symbol);
    const side = String(input.side ?? "").toUpperCase();
    const type = String(input.type ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") throw new Error("Bybit 订单方向不正确");
    if (type !== "MARKET") throw new Error("Bybit 条件保护单只接受 MARKET");
    const triggerPrice = decimalString(input.triggerPrice, "触发价格");
    const quantity = decimalString(input.quantity, "数量");
    const { positionIdx, positionSide } = normalizeConditionalPosition(input);
    const triggerDirection = conditionalTriggerDirection(input.strategyType, positionSide);
    const orderLinkId = normalizeOrderLinkId(input, this.idFactory);
    const body = {
      category: "linear",
      symbol,
      side: side === "BUY" ? "Buy" : "Sell",
      orderType: "Market",
      qty: quantity,
      triggerDirection,
      triggerPrice,
      positionIdx,
      orderLinkId,
      reduceOnly: true,
      closeOnTrigger: true,
    };
    return this.submitCreate(body, {
      symbol,
      side: side as "BUY" | "SELL",
      type: "MARKET",
      quantity,
      positionIdx,
      orderLinkId,
      reduceOnly: true,
      status: "SUBMITTED",
    });
  }

  private async submitCreate(
    body: Record<string, unknown>,
    fallback: Partial<LiveOrderResult> & { orderLinkId: string; symbol: string },
  ): Promise<LiveOrderResult> {
    let ack: LiveOrderResult;
    try {
      const result = await this.requestJson("/v5/order/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const record = isRecord(result) ? result : {};
      ack = normalizeOrder(record as BybitOrderRow, fallback);
    } catch (error) {
      if (!requestIsAmbiguous(error)) throw new Error(safeError(error, this.config.token));
      return this.reconcileUnknown(fallback, error);
    }

    // Bybit acknowledges creates asynchronously. Confirm by the same stable
    // orderLinkId when possible, but retain a successful ack if the read side
    // is temporarily unavailable or the order has not appeared yet.
    try {
      const confirmed = await this.findByClientId({ symbol: fallback.symbol, clientOrderId: fallback.orderLinkId });
      if (confirmed) return confirmed;
    } catch {
      // The create acknowledgement is still useful; reconciliation can retry
      // the read later without ever creating a second order.
    }
    return {
      ...ack,
      status: "UNKNOWN",
      error: "Bybit 下单仅收到异步受理，等待后续对账确认",
    };
  }

  private async reconcileUnknown(fallback: Partial<LiveOrderResult> & { orderLinkId: string; symbol: string }, cause: unknown) {
    try {
      const found = await this.findByClientId({ symbol: fallback.symbol, clientOrderId: fallback.orderLinkId });
      if (found) return found;
    } catch {
      // Keep the outcome unknown when even the deterministic lookup fails.
    }
    return {
      orderId: null,
      clientOrderId: fallback.orderLinkId,
      orderLinkId: fallback.orderLinkId,
      symbol: fallback.symbol,
      ...(fallback.side ? { side: fallback.side } : {}),
      ...(fallback.type ? { type: fallback.type } : {}),
      status: "UNKNOWN" as const,
      ...(fallback.price ? { price: fallback.price } : {}),
      ...(fallback.quantity ? { quantity: fallback.quantity, executedQty: "0", executedQuantity: "0" } : {}),
      ...(fallback.positionIdx === undefined ? {} : { positionIdx: fallback.positionIdx }),
      ...(fallback.reduceOnly === undefined ? {} : { reduceOnly: fallback.reduceOnly }),
      error: `Bybit 下单结果未知：${safeError(cause, this.config.token)}`,
    } satisfies LiveOrderResult;
  }

  async cancel(input: LiveCancelInput): Promise<LiveOrderResult> {
    this.ensureTradingEnabled();
    const symbol = normalizeSymbol(input.symbol);
    const orderLinkId = optionalString(input.orderLinkId) ?? optionalString(input.clientOrderId);
    const orderId = optionalString(input.orderId);
    if (Boolean(orderLinkId) === Boolean(orderId)) throw new Error("Bybit 撤单必须且只能包含 orderId 或 orderLinkId");
    if (orderLinkId && !ORDER_LINK_ID_PATTERN.test(orderLinkId)) throw new Error("Bybit orderLinkId 不正确");
    const body = { category: "linear", symbol, ...(orderLinkId ? { orderLinkId } : { orderId }) };
    const result = await this.requestJson("/v5/order/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const record = isRecord(result) ? result : {};
    return normalizeOrder(record as BybitOrderRow, {
      symbol,
      clientOrderId: orderLinkId,
      orderLinkId,
      orderId,
      status: "CANCELED",
    });
  }

  async closedCandles(symbolInput: string, timeframe: string, limitInput?: number): Promise<LiveCandle[]> {
    const symbol = normalizeSymbol(symbolInput);
    assertLiveTimeframe("BYBIT", timeframe);
    const interval = BYBIT_INTERVALS.get(timeframe);
    if (!interval) throw new Error("Bybit 只支持 15m、1h、4h、1d 周期");
    const limit = positiveInteger(limitInput, "K线数量", 200);
    if (limit > MAX_KLINE_LIMIT) throw new Error("K线数量超出 Bybit 限制");
    const result = await this.requestJson(withQuery("/v5/market/kline", {
      category: "linear",
      symbol,
      interval: interval.value,
      limit: String(limit),
    }));
    const now = this.now();
    return resultList(result)
      .map((row) => normalizeCandle(row, interval.milliseconds))
      .filter((row): row is LiveCandle => row !== null && row.closeTime <= now)
      .sort((left, right) => left.openTime - right.openTime);
  }
}
