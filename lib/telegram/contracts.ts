import { STRATEGY_TIMEFRAMES } from "../trade/strategy-contracts.ts";
import { isBinanceFuturesSymbol } from "../trade/symbols.ts";
import { isProjectClientOrderId } from "../trade/order-source.ts";

export type TelegramConversation = {
  id: string;
  userId: string;
  version: number;
  step: "HOME" | "MODE" | "SYMBOL" | "SIDE" | "TIMEFRAME" | "TIMEFRAME_CUSTOM" | "METHOD"
    | "MA_KIND" | "MA_LENGTH" | "MA_LENGTH_CUSTOM" | "ATR_LENGTH" | "ATR_MULTIPLIER" | "MARGIN" | "LEG_COUNT"
    | "PARAMETERS" | "STOP" | "TAKE_PROFIT" | "CONFIRM"
    | "ALEX_ASSET" | "ALEX_KIND" | "ALEX_TP_MODE" | "ALEX_TP_PRICE" | "ALEX_SL_MODE" | "ALEX_SL_TIMEFRAME" | "ALEX_SL_PRICE" | "ALEX_CONFIRM";
  draft: Record<string, unknown>;
  confirmNonce: string | null;
  expiresAt: string;
};

type TelegramUpdate = {
  updateId: number;
  kind: "MESSAGE" | "CALLBACK";
  userId: string;
  chatId: string;
  text?: string;
  callbackData?: string;
  callbackQueryId?: string;
};

const callbackPattern = /^tg:act:([A-Za-z0-9_-]{8,64})$/;
const steps = new Set<TelegramConversation["step"]>([
  "HOME", "MODE", "SYMBOL", "SIDE", "TIMEFRAME", "TIMEFRAME_CUSTOM", "METHOD", "MA_KIND", "MA_LENGTH",
  "MA_LENGTH_CUSTOM", "ATR_LENGTH", "ATR_MULTIPLIER", "MARGIN", "LEG_COUNT", "PARAMETERS", "STOP", "TAKE_PROFIT", "CONFIRM",
  "ALEX_ASSET", "ALEX_KIND", "ALEX_TP_MODE", "ALEX_TP_PRICE", "ALEX_SL_MODE", "ALEX_SL_TIMEFRAME", "ALEX_SL_PRICE", "ALEX_CONFIRM",
]);

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(message);
  return value as Record<string, unknown>;
}

function id(value: unknown, message: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(message);
  return String(value);
}

function chat(value: unknown): { id: string; type: string } {
  const item = record(value, "Telegram 聊天信息不正确");
  if (item.type !== "private") fail("仅支持 Telegram 私聊");
  return { id: id(item.id, "Telegram 聊天信息不正确"), type: item.type };
}

export function parseTelegramUpdate(input: unknown): TelegramUpdate {
  const update = record(input, "Telegram 更新格式不正确");
  if (typeof update.update_id !== "number" || !Number.isFinite(update.update_id) || update.update_id < 0) {
    fail("Telegram 更新编号不正确");
  }

  if (update.message !== undefined) {
    const message = record(update.message, "Telegram 消息格式不正确");
    const privateChat = chat(message.chat);
    return {
      updateId: update.update_id,
      kind: "MESSAGE",
      userId: id(record(message.from, "Telegram 用户信息不正确").id, "Telegram 用户信息不正确"),
      chatId: privateChat.id,
      ...(typeof message.text === "string" ? { text: message.text } : {}),
    };
  }

  if (update.callback_query !== undefined) {
    const callback = record(update.callback_query, "Telegram 回调格式不正确");
    const privateChat = chat(record(callback.message, "Telegram 回调格式不正确").chat);
    if (typeof callback.id !== "string" || typeof callback.data !== "string") fail("Telegram 回调格式不正确");
    return {
      updateId: update.update_id,
      kind: "CALLBACK",
      userId: id(record(callback.from, "Telegram 用户信息不正确").id, "Telegram 用户信息不正确"),
      chatId: privateChat.id,
      callbackData: callback.data,
      callbackQueryId: callback.id,
    };
  }

  return fail("仅支持 Telegram 私聊消息或回调");
}

export function parseCallback(data: unknown): { actionId: string } {
  if (typeof data !== "string") fail("Telegram 回调格式不正确");
  const match = callbackPattern.exec(data);
  if (!match || /USDT|PRICE|AMOUNT|QUANTITY|MARGIN|STOP|TAKE_PROFIT/i.test(match[1])) {
    fail("Telegram 回调格式不正确");
  }
  return { actionId: match[1] };
}

export function newConversation(userId: string): TelegramConversation {
  if (typeof userId !== "string" || userId.length === 0) fail("Telegram 用户信息不正确");
  return {
    id: `telegram:${userId}`,
    userId,
    version: 0,
    step: "HOME",
    draft: {},
    confirmNonce: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

function validateConversationInput(input: Record<string, unknown>): void {
  const allowed = new Set([
    "symbol", "mode", "side", "timeframe", "method", "maKind", "maLength", "atrLength", "atrMultiplier",
    "totalMarginUsdt", "legCount", "firstGuardExitPct", "useDefaultProfitTargets", "staticEntryPrice", "horizontalGuardPrice",
    "homeEntry", "step", "confirmNonce", "expiresAt", "alexCandidates", "alexSelectedCandidateId", "alexStrategyType", "alexFixedPrice", "alexTimeframe",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("Telegram 会话输入不正确");
  if ("symbol" in input && !isBinanceFuturesSymbol(input.symbol)) fail("交易对不正确");
  if ("mode" in input && input.mode !== "PAPER" && input.mode !== "LIVE_ARMED") fail("模式不正确");
  if ("homeEntry" in input && input.homeEntry !== true) fail("入口标记不正确");
  if ("side" in input && input.side !== "LONG" && input.side !== "SHORT") fail("方向不正确");
  if ("timeframe" in input && !STRATEGY_TIMEFRAMES.includes(input.timeframe as typeof STRATEGY_TIMEFRAMES[number])) fail("周期不正确");
  if ("method" in input && input.method !== "MA" && input.method !== "HORIZONTAL") fail("策略类型不正确");
  if ("maKind" in input && input.maKind !== "SMA" && input.maKind !== "EMA") fail("均线类型不正确");
  if ("useDefaultProfitTargets" in input && typeof input.useDefaultProfitTargets !== "boolean") fail("止盈设置不正确");
  if ("alexCandidates" in input) {
    if (!Array.isArray(input.alexCandidates) || input.alexCandidates.length < 1 || input.alexCandidates.length > 20) fail("手动持仓候选不正确");
    for (const candidate of input.alexCandidates) {
      const item = record(candidate, "手动持仓候选不正确");
      if (typeof item.candidateId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.candidateId)
        || typeof item.symbol !== "string" || !isBinanceFuturesSymbol(item.symbol)
        || (item.side !== "LONG" && item.side !== "SHORT")
        || !Array.isArray(item.sourceOrderIds) || item.sourceOrderIds.length < 1
        || item.sourceOrderIds.some((value) => typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(value) || isProjectClientOrderId(value))) fail("手动持仓候选不正确");
    }
  }
  if ("alexSelectedCandidateId" in input && (typeof input.alexSelectedCandidateId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.alexSelectedCandidateId))) fail("手动持仓候选不正确");
  if ("alexStrategyType" in input && !["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"].includes(String(input.alexStrategyType))) fail("保护策略类型不正确");
  if ("alexTimeframe" in input && !STRATEGY_TIMEFRAMES.includes(input.alexTimeframe as typeof STRATEGY_TIMEFRAMES[number])) fail("保护策略周期不正确");
  if ("step" in input && (typeof input.step !== "string" || !steps.has(input.step as TelegramConversation["step"]))) fail("会话步骤不正确");
  if ("confirmNonce" in input && input.confirmNonce !== null && (typeof input.confirmNonce !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(input.confirmNonce))) fail("确认编号不正确");
  if ("expiresAt" in input && (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt)))) fail("会话过期时间不正确");
  for (const [key, value] of Object.entries(input)) {
    if (["maLength", "atrLength", "legCount"].includes(key) && (!Number.isSafeInteger(value) || Number(value) <= 0)) fail("数值不正确");
    if (["atrMultiplier", "totalMarginUsdt", "firstGuardExitPct", "staticEntryPrice", "horizontalGuardPrice", "alexFixedPrice"].includes(key)
      && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) fail("数值不正确");
  }
}

export function applyConversationInput(session: TelegramConversation, input: Record<string, unknown>): TelegramConversation {
  const current = record(session, "Telegram 会话格式不正确") as TelegramConversation;
  const changes = record(input, "Telegram 会话输入不正确");
  validateConversationInput(changes);
  const { step, confirmNonce, expiresAt, ...draftChanges } = changes;
  return {
    ...current,
    version: current.version + 1,
    step: step === undefined ? current.step : step as TelegramConversation["step"],
    confirmNonce: confirmNonce === undefined ? current.confirmNonce : confirmNonce as string | null,
    expiresAt: expiresAt === undefined ? current.expiresAt : expiresAt as string,
    draft: { ...current.draft, ...draftChanges },
  };
}
