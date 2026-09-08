import {
  resolveLiveExchangeAdapter,
  type LiveExchangeAdapter,
  type LiveExchangeAdapterDependencies,
  type LiveOrderResult,
} from "./live-exchange-adapter.ts";
import {
  listLiveEntryProtectionLinks,
  listLiveStrategies,
  recordLiveEntryProtectionLink,
  recordLiveOrder,
  recordLiveOrderAttempt,
  type LiveStrategy,
} from "./live-strategies.ts";
import { createProtectionStrategy, listProtectionStrategiesBySourceOrderId, type ProtectionCreateInput } from "./protection-strategies.ts";
import type { ProtectionPosition } from "./protection-contracts.ts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "./live-exchange.ts";

type BinanceOrder = {
  orderId?: string | number;
  clientOrderId?: string;
  status?: string;
  executedQty?: string | number;
  avgPrice?: string | number;
};
type BinancePosition = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  leverage?: string | number;
};

export type LiveEntryProtectionSyncResult = {
  scanned: number;
  filled: number;
  protected: number;
  reconciliationRequired: number;
  failed: number;
};

export type LiveEntryProtectionSyncDependencies = {
  env?: Record<string, string | undefined>;
  listStrategies?: (limit?: number) => Promise<LiveStrategy[]>;
  findOrder?: (input: { symbol: string; clientOrderId: string }) => Promise<BinanceOrder | null>;
  readPosition?: (symbol: string) => Promise<BinancePosition | null>;
  recordOrder?: typeof recordLiveOrder;
  recordAttempt?: typeof recordLiveOrderAttempt;
  listLinks?: typeof listLiveEntryProtectionLinks;
  recordLink?: typeof recordLiveEntryProtectionLink;
  listProtectionsForSource?: typeof listProtectionStrategiesBySourceOrderId;
  createProtection?: (input: ProtectionCreateInput) => ReturnType<typeof createProtectionStrategy>;
  resolveAdapter?: (exchange: LiveExchange, env: Record<string, string | undefined>, dependencies?: LiveExchangeAdapterDependencies) => LiveExchangeAdapter;
  adapter?: LiveExchangeAdapter;
  adapterDependencies?: LiveExchangeAdapterDependencies;
};

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "未知错误")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sourceFillId(clientOrderId: string, cumulativeQuantity: number) {
  return `${clientOrderId}:${String(Number(cumulativeQuantity.toPrecision(15)))}`;
}

function responseStatus(order: BinanceOrder) {
  const status = String(order.status ?? "").toUpperCase();
  if (status === "FILLED") return "FILLED" as const;
  if (status === "CANCELED" || status === "EXPIRED") return "CANCELED" as const;
  return "SUBMITTED" as const;
}

function strategyMarketConfig(strategy: LiveStrategy) {
  const multiplier = Number(strategy.config.dynamicGuard?.atrMultiplier ?? 1);
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("策略 ATR 倍数无效");
  return { ma: { kind: strategy.config.ma.kind, length: strategy.config.ma.length }, atr: { length: strategy.config.atr.length }, atrMultiplier: multiplier };
}

function sourcePosition(strategy: LiveStrategy, order: { id: string; clientOrderId: string; price: string | null }, exchange: BinanceOrder, position: BinancePosition, quantity: number): ProtectionPosition {
  const entryPrice = finitePositive(exchange.avgPrice) || finitePositive(order.price) || finitePositive(position.entryPrice);
  const markPrice = finitePositive(position.markPrice) || entryPrice;
  const leverage = finitePositive(position.leverage);
  if (!entryPrice || !markPrice || !leverage) throw new Error("成交价格、标记价格或当前杠杆无效，无法建立止损保护");
  return {
    candidateId: `${strategy.id}:${order.id}:${quantity}`,
    sourceFillId: sourceFillId(order.clientOrderId, quantity),
    symbol: strategy.config.symbol,
    side: strategy.config.side,
    quantity,
    entryPrice,
    markPrice,
    leverage,
    sourceOrderIds: [order.clientOrderId],
  };
}

function activeStrategy(strategy: LiveStrategy) {
  return ["WAITING", "ACTIVE", "RECONCILIATION_REQUIRED"].includes(strategy.status)
    && strategy.config.sourceProtectionVersion === "SOURCE_BOUND_V2";
}

function quickProtectionFields(strategy: LiveStrategy): Pick<ProtectionCreateInput, "quickTemplateId" | "quickExitRule" | "quickTemplateSnapshot"> | Record<string, never> {
  const { quickTemplateId, quickExitRule, quickTemplateSnapshot } = strategy.config;
  if (!quickTemplateId || !quickExitRule || !quickTemplateSnapshot) return {};
  return { quickTemplateId, quickExitRule, quickTemplateSnapshot };
}

function adapterClientOrderId(exchange: LiveExchange, clientOrderId: string) {
  if (exchange !== "BYBIT" || /^(web|tele)BY[A-Za-z0-9_-]{1,31}$/i.test(clientOrderId)) return clientOrderId;
  const entry = /^(web|tele)IN(.*)$/i.exec(clientOrderId);
  if (entry) return `${entry[1].toLowerCase()}BY${entry[2]}`;
  const prefix = /^tele/i.test(clientOrderId) ? "tele" : "web";
  return `${prefix}BY${clientOrderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 31)}`;
}

function adapterOrderResult(result: LiveOrderResult): BinanceOrder {
  return { orderId: result.orderId ?? undefined, clientOrderId: result.clientOrderId ?? undefined, status: result.status,
    executedQty: result.executedQty ?? result.executedQuantity ?? undefined, avgPrice: result.avgPrice ?? result.price ?? undefined };
}

async function adapterPosition(adapter: LiveExchangeAdapter, symbol: string, side: "LONG" | "SHORT"): Promise<BinancePosition | null> {
  const rows = await adapter.position(symbol);
  const position = rows.find((row) => row.symbol.toUpperCase() === symbol.toUpperCase() && (side === "LONG" ? Number(row.positionAmt) > 0 : Number(row.positionAmt) < 0));
  if (!position) return null;
  return { symbol: position.symbol, positionAmt: position.positionAmt, entryPrice: position.entryPrice, markPrice: position.markPrice, leverage: position.leverage };
}

function resolveAdapter(exchange: LiveExchange, dependencies: LiveEntryProtectionSyncDependencies) {
  const adapter = dependencies.adapter ?? dependencies.resolveAdapter?.(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies)
    ?? resolveLiveExchangeAdapter(exchange, dependencies.env ?? process.env, dependencies.adapterDependencies);
  if (adapter.exchange !== exchange) throw new Error("实盘交易所适配器不匹配");
  return adapter;
}

export async function syncLiveEntryProtections(dependencies: LiveEntryProtectionSyncDependencies = {}): Promise<LiveEntryProtectionSyncResult> {
  const listStrategies = dependencies.listStrategies ?? listLiveStrategies;
  const recordOrder = dependencies.recordOrder ?? recordLiveOrder;
  const recordAttempt = dependencies.recordAttempt ?? recordLiveOrderAttempt;
  const listLinks = dependencies.listLinks ?? listLiveEntryProtectionLinks;
  const recordLink = dependencies.recordLink ?? recordLiveEntryProtectionLink;
  const listProtectionsForSource = dependencies.listProtectionsForSource ?? listProtectionStrategiesBySourceOrderId;
  const createProtection = dependencies.createProtection ?? createProtectionStrategy;
  const result: LiveEntryProtectionSyncResult = { scanned: 0, filled: 0, protected: 0, reconciliationRequired: 0, failed: 0 };
  const strategies = (await listStrategies(100)).filter(activeStrategy);

  for (const strategy of strategies) {
    const strategyExchange = normalizeLiveExchange(strategy.exchange);
    assertLiveTimeframe(strategyExchange, String(strategy.config.timeframe));
    let adapter: LiveExchangeAdapter | undefined;
    const currentAdapter = () => adapter ?? (adapter = resolveAdapter(strategyExchange, dependencies));
    const findOrder = dependencies.findOrder ?? ((input: { symbol: string; clientOrderId: string }) => currentAdapter().findByClientId({
      symbol: input.symbol, clientOrderId: adapterClientOrderId(strategyExchange, input.clientOrderId),
    }).then((result) => result ? { ...adapterOrderResult(result), clientOrderId: input.clientOrderId } : null));
    const readPosition = dependencies.readPosition ?? ((symbol: string) => adapterPosition(currentAdapter(), symbol, strategy.config.side));
    const entries = (strategy.attempts?.length ?? 0)
      ? strategy.attempts.filter((candidate) => candidate.intent === "ENTRY" && candidate.clientOrderId)
      : strategy.orders.filter((candidate) => candidate.intent === "ENTRY" && candidate.symbol && candidate.clientOrderId);
    for (const order of entries) {
      result.scanned += 1;
      if (normalizeLiveExchange((order as typeof order & { exchange?: unknown }).exchange ?? strategyExchange) !== strategyExchange) { result.failed += 1; continue; }
      const symbol = "symbol" in order && order.symbol ? order.symbol : strategy.config.symbol;
      let exchange: BinanceOrder | null;
      try {
        exchange = await findOrder({ symbol, clientOrderId: order.clientOrderId });
      } catch {
        result.failed += 1;
        continue;
      }
      if (!exchange) continue;
      const cumulativeQuantity = finitePositive(exchange.executedQty);
      const status = responseStatus(exchange);
      const exchangeOrderId = exchange.orderId == null ? order.exchangeOrderId : String(exchange.orderId);
      if (exchangeOrderId && (order.status !== status || String(order.executedQuantity) !== String(exchange.executedQty ?? "0"))) {
        try {
          const update = cumulativeQuantity > 0 ? { executedQuantity: cumulativeQuantity, averageFillPrice: exchange.avgPrice } : {};
          if ("generation" in order) await recordAttempt(order.id, exchangeOrderId, status, update);
          else await recordOrder(order.id, exchangeOrderId, status, cumulativeQuantity > 0 ? { executedQuantity: cumulativeQuantity } : {});
        } catch {
          result.failed += 1;
          continue;
        }
      }
      if (!cumulativeQuantity) continue;
      result.filled += 1;

      const [links, protections] = await Promise.all([listLinks(order.id), listProtectionsForSource(order.clientOrderId)]);
      const exchangeLinks = links.filter((link) => normalizeLiveExchange((link as typeof link & { exchange?: unknown }).exchange ?? strategyExchange) === strategyExchange);
      const exchangeProtections = protections.filter((protection) => protection.exchange === strategyExchange);
      const knownQuantity = Math.max(
        exchangeLinks.reduce((sum, link) => sum + finitePositive(link.quantity), 0),
        exchangeProtections.filter((protection) => protection.strategyType === "MA_SL")
          .reduce((sum, protection) => sum + finitePositive(protection.initialQuantity), 0),
      );
      const remainingToProtect = cumulativeQuantity - knownQuantity;
      if (remainingToProtect <= 1e-12) continue;
      const source = sourcePosition(strategy, order, exchange, await readPosition(strategy.config.symbol).catch(() => null) ?? {}, cumulativeQuantity);
      const fillId = source.sourceFillId!;
      if (exchangeLinks.some((link) => link.sourceFillId === fillId && ["ERROR", "RECONCILIATION_REQUIRED"].includes(link.status))) {
        result.reconciliationRequired += 1;
        continue;
      }
      source.quantity = remainingToProtect;
      try {
        const submission = await createProtection({
          exchange: strategyExchange,
          origin: strategy.origin,
          source,
          strategyType: "MA_SL",
          timeframe: strategy.config.timeframe,
          marketConfig: strategyMarketConfig(strategy),
          ...quickProtectionFields(strategy),
          idempotencyKey: `live-ma-${order.clientOrderId}-${String(Number(cumulativeQuantity.toPrecision(15)))}`,
        });
        if (!submission.ok) throw new Error(submission.error ?? "止损保护未生效");
        if (submission.strategy.exchange !== strategyExchange) throw new Error("保护策略交易所与来源实盘策略不一致");
        await recordLink({ exchange: strategyExchange, liveOrderId: order.id, sourceFillId: fillId, quantity: remainingToProtect, protectionStrategyId: submission.strategy.id, status: "ACTIVE" });
        result.protected += 1;
      } catch (error) {
        try {
          await recordLink({ exchange: strategyExchange, liveOrderId: order.id, sourceFillId: fillId, quantity: remainingToProtect, status: "ERROR", error: safeError(error) });
          result.reconciliationRequired += 1;
        } catch {
          result.failed += 1;
        }
      }
    }
  }
  return result;
}
