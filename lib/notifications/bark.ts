import { createD1DeliveryStore, sendBarkOnce } from "../advisory/notifications.ts";
import { getServerCredential, type CredentialKey } from "../server-credentials.ts";

export type TradeEventKind = "BUY" | "SELL" | "TAKE_PROFIT" | "STOP_LOSS" | "POSITION_OPENED" | "POSITION_CLOSED";

export type TradeNotificationEvent = {
  source: "paper" | "binance";
  eventId: string;
  kind: TradeEventKind;
  symbol: string;
  side?: string;
  price?: number;
  quantity?: number;
  reason?: string;
  pnl?: number;
};

export type PaperStrategyEventKind = "ENTRY_FILLED" | "PROFIT_EXIT" | "GUARD_STOP" | "EXPIRED" | "FINAL_CANCEL";

export type PaperStrategyNotificationEvent = {
  eventId: string;
  kind: PaperStrategyEventKind;
  strategyId: string;
  websiteOrderId?: string;
  symbol: string;
  side?: string;
  price?: number;
  quantity?: number;
  pnl?: number;
  reason?: string;
};

type BarkEnv = {
  BARK_BASE_URL?: string;
  BARK_API_KEY?: string;
  BARK_SERVER_URL?: string;
};

type BarkCredentialKey = Extract<CredentialKey, "BARK_BASE_URL" | "BARK_API_KEY">;
type ServerBarkResolverOptions = {
  env?: BarkEnv;
  getCredential?: (key: BarkCredentialKey) => Promise<string | undefined>;
};

export function resolveBarkBaseUrl(env: BarkEnv = process.env as BarkEnv) {
  const configured = env.BARK_BASE_URL?.trim();
  if (configured) return configured;
  const apiKey = env.BARK_API_KEY?.trim();
  if (!apiKey) return undefined;
  const server = (env.BARK_SERVER_URL?.trim() || "https://api.day.app").replace(/\/$/, "");
  return `${server}/${apiKey}`;
}

export async function resolveServerBarkBaseUrl(options: ServerBarkResolverOptions = {}) {
  const env = options.env ?? process.env as BarkEnv;
  const getCredential = options.getCredential ?? getServerCredential;
  const configured = (await getCredential("BARK_BASE_URL"))?.trim();
  if (configured) return configured;
  const apiKey = (await getCredential("BARK_API_KEY"))?.trim();
  if (!apiKey) return undefined;
  const server = (env.BARK_SERVER_URL?.trim() || "https://api.day.app").replace(/\/$/, "");
  return `${server}/${apiKey}`;
}

function eventLabel(kind: TradeEventKind) {
  switch (kind) {
    case "BUY": return "买入提醒";
    case "SELL": return "卖出提醒";
    case "TAKE_PROFIT": return "止盈提醒";
    case "STOP_LOSS": return "止损提醒";
    case "POSITION_OPENED": return "持仓新增提醒";
    case "POSITION_CLOSED": return "持仓关闭提醒";
  }
}

function paperStrategyEventLabel(kind: PaperStrategyEventKind) {
  switch (kind) {
    case "ENTRY_FILLED": return "策略限价成交";
    case "PROFIT_EXIT": return "策略分批止盈";
    case "GUARD_STOP": return "策略止损";
    case "EXPIRED": return "策略已到期";
    case "FINAL_CANCEL": return "策略已完成，撤销余单";
  }
}

export function buildTradeEventNotification(event: TradeNotificationEvent) {
  const symbol = event.symbol.replace(/USDT$/, "");
  const detail = [
    `${symbol} ${eventLabel(event.kind)}`,
    event.side ? `方向 ${event.side}` : "",
    Number.isFinite(event.price) ? `价格 ${event.price}` : "",
    Number.isFinite(event.quantity) ? `数量 ${event.quantity}` : "",
    Number.isFinite(event.pnl) ? `已实现盈亏 ${event.pnl}` : "",
    event.reason ? `原因 ${event.reason}` : "",
    event.source === "paper" ? "模拟盘" : "币安只读账户",
  ].filter(Boolean).join(" · ");
  return {
    key: `trade:${event.source}:${event.eventId}`,
    title: `${eventLabel(event.kind)} · ${symbol}`,
    body: `${detail}。仅作提醒，不会自动下单。`,
  };
}

export function buildPaperStrategyEventNotification(event: PaperStrategyNotificationEvent) {
  const symbol = event.symbol.replace(/USDT$/, "");
  const label = paperStrategyEventLabel(event.kind);
  const detail = [
    `${symbol} ${label}`,
    `网站策略 ${event.strategyId}`,
    event.websiteOrderId ? `网站订单 ${event.websiteOrderId}` : "",
    event.side ? `方向 ${event.side}` : "",
    Number.isFinite(event.price) ? `价格 ${event.price}` : "",
    Number.isFinite(event.quantity) ? `数量 ${event.quantity}` : "",
    Number.isFinite(event.pnl) ? `毛盈亏 ${event.pnl}` : "",
    event.reason ? `原因 ${event.reason}` : "",
    "模拟盘策略提醒",
  ].filter(Boolean).join(" · ");
  return {
    key: `strategy:paper:${event.eventId}`,
    title: `${label} · ${symbol}`,
    body: `${detail}。仅作提醒，不会自动下单。`,
  };
}

export async function notifyTradeEvent(options: { db: D1Database; event: TradeNotificationEvent; fetcher?: typeof fetch }) {
  const notification = buildTradeEventNotification(options.event);
  return sendBarkOnce({
    ...notification,
    barkBaseUrl: await resolveServerBarkBaseUrl(),
    store: createD1DeliveryStore(options.db),
    fetcher: options.fetcher,
  });
}

export async function notifyPaperStrategyEvent(options: { db: D1Database; event: PaperStrategyNotificationEvent; fetcher?: typeof fetch }) {
  const barkBaseUrl = await resolveServerBarkBaseUrl();
  if (!barkBaseUrl) return { status: "SKIPPED" as const, reason: "Bark is not configured" };
  const notification = buildPaperStrategyEventNotification(options.event);
  return sendBarkOnce({
    ...notification,
    barkBaseUrl,
    store: createD1DeliveryStore(options.db),
    fetcher: options.fetcher,
  });
}

export async function notifyBark(options: { db: D1Database; key: string; title: string; body: string; fetcher?: typeof fetch }) {
  return sendBarkOnce({
    key: options.key,
    title: options.title,
    body: options.body,
    barkBaseUrl: await resolveServerBarkBaseUrl(),
    store: createD1DeliveryStore(options.db),
    fetcher: options.fetcher,
  });
}
