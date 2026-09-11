import crypto from "node:crypto";
import { applyConversationInput, newConversation, parseCallback, type TelegramConversation } from "./contracts.ts";
import type { TelegramReplyMarkup } from "./client.ts";
import { consumeConfirmation, loadConversation, saveConversation } from "./store.ts";
import { getLiveAccountSnapshot, getLiveSymbolLeverage, type LiveSymbolLeverage } from "../trade/live-account.ts";
import { STRATEGY_TIMEFRAMES } from "../trade/strategy-contracts.ts";
import { listLiveStrategies, type LiveStrategy } from "../trade/live-strategies.ts";
import { submitLiveStrategy, type LiveStrategySubmitDependencies } from "../trade/live-submit.ts";
import type { LiveStrategyDraft } from "../trade/live-contracts.ts";
import { getAlexManualPositions, type AlexPositionsResult } from "../trade/alex-positions.ts";
import { createProtectionStrategy, listProtectionStrategies, type PersistedProtectionStrategy, type ProtectionCreateInput } from "../trade/protection-strategies.ts";
import type { ProtectionPosition, ProtectionStrategyType } from "../trade/protection-contracts.ts";
import { isBinanceFuturesSymbol, normalizeBinanceFuturesSymbol } from "../trade/symbols.ts";
import { allowedLiveTimeframes, normalizeLiveExchange, type LiveExchange } from "../trade/live-exchange.ts";

export type TelegramReply = {
  text: string;
  replyMarkup: TelegramReplyMarkup;
  tradeRequested: false;
};

type AuthorizedUpdate = {
  updateId: number;
  kind: "MESSAGE" | "CALLBACK";
  userId: string;
  chatId: string;
  text?: string;
  callbackData?: string;
};

export type TelegramHandlerDependencies = {
  loadConversation?: typeof loadConversation;
  saveConversation?: typeof saveConversation;
  consumeConfirmation?: typeof consumeConfirmation;
  getLiveAccountSnapshot?: typeof getLiveAccountSnapshot;
  getLiveSymbolLeverage?: typeof getLiveSymbolLeverage;
  submitLiveStrategy?: typeof submitLiveStrategy;
  liveStrategyDependencies?: LiveStrategySubmitDependencies;
  listLiveStrategies?: typeof listLiveStrategies;
  getAlexManualPositions?: typeof getAlexManualPositions;
  createProtectionStrategy?: typeof createProtectionStrategy;
  listProtectionStrategies?: typeof listProtectionStrategies;
};

export type LiveStrategyNotificationEvent = "REPLACED" | "TARGET_COMPLETE" | "ENTRY_FROZEN" | "RECONCILIATION_REQUIRED" | "LIFECYCLE_CLOSED";

type LiveStrategyNotificationInput = Pick<LiveStrategy, "id" | "attempts"> & {
  currentGeneration?: { generation?: number } | null;
};

export function formatLiveStrategyNotification(strategy: LiveStrategyNotificationInput, event: LiveStrategyNotificationEvent) {
  const sourceIds = strategy.attempts
    .filter((attempt) => attempt.intent === "ENTRY")
    .map((attempt) => attempt.clientOrderId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 8);
  const sources = sourceIds.length ? sourceIds.join("，") : "暂无可展示来源编号";
  const generation = strategy.currentGeneration?.generation;
  const label: Record<LiveStrategyNotificationEvent, string> = {
    REPLACED: "替换成功",
    TARGET_COMPLETE: "目标已全部成交（仍按止盈/止损管理，非仓位已平）",
    ENTRY_FROZEN: "止损冻结并撤余单",
    RECONCILIATION_REQUIRED: "需要对账",
    LIFECYCLE_CLOSED: "策略生命周期已关闭",
  };
  return `实盘策略通知\n策略组：${strategy.id}${generation ? ` · 第 ${generation} 轮` : ""}\n状态：${label[event]}\n来源ID：${sources}`;
}

const homeKeyboard = {
  keyboard: [
    [{ text: "⚡ 默认下单" }, { text: "⚙️ 完整策略" }],
    [{ text: "📊 实盘持仓" }, { text: "📋 实盘挂单" }],
    [{ text: "🛡️ 手动持仓保护" }, { text: "🗂️ 策略管理" }],
    [{ text: "❌ 取消/主菜单" }],
  ],
  is_persistent: true,
  resize_keyboard: true,
  input_field_placeholder: "选择操作或输入参数",
} satisfies TelegramReplyMarkup;

const QUICK_ORDER_BUTTON = "⚡ 默认下单";
const QUICK_FULL_STRATEGY_BUTTON = "⚙️ 完整策略";
const QUICK_POSITIONS_BUTTON = "📊 实盘持仓";
const QUICK_ORDERS_BUTTON = "📋 实盘挂单";
const QUICK_PROTECTION_BUTTON = "🛡️ 手动持仓保护";
const QUICK_STRATEGIES_BUTTON = "🗂️ 策略管理";
const QUICK_CANCEL_BUTTON = "❌ 取消/主菜单";
const QUICK_DEFAULT_LEG_COUNT = 5;
const QUICK_DEFAULT_MARGIN_USDT = 25;

const sideKeyboard = [
  [{ text: "做多", callback_data: "tg:act:side_long_01" }],
  [{ text: "做空", callback_data: "tg:act:side_short_01" }],
];

const quickSideKeyboard = [
  [{ text: "做多", callback_data: "tg:act:quick_side_long_01" }],
  [{ text: "做空", callback_data: "tg:act:quick_side_short_01" }],
];

const exchangeKeyboard = [
  [{ text: "Binance", callback_data: "tg:act:exchange_binance_01" }],
  [{ text: "Bybit（仅 1h / 4h / 1d）", callback_data: "tg:act:exchange_bybit_01" }],
];

const quickTimeframeKeyboard = [
  [{ text: "15分钟", callback_data: "tg:act:quick_tf_15m_01" }],
  [{ text: "1小时", callback_data: "tg:act:quick_tf_1h_01" }],
  [{ text: "4小时", callback_data: "tg:act:quick_tf_4h_01" }],
  [{ text: "日线", callback_data: "tg:act:quick_tf_1d_01" }],
];

const quickMarginKeyboard = [
  [{ text: "25 USDT（默认）", callback_data: "tg:act:qk_default_01" }],
  [{ text: "30 USDT", callback_data: "tg:act:qk_a1_01" }],
  [{ text: "50 USDT", callback_data: "tg:act:qk_b2_01" }],
  [{ text: "70 USDT", callback_data: "tg:act:qk_c3_01" }],
  [{ text: "其他", callback_data: "tg:act:qk_d4_01" }],
];

const methodKeyboard = [
  [{ text: "均线策略", callback_data: "tg:act:method_ma_01" }],
  [{ text: "关键位策略", callback_data: "tg:act:method_horizontal_01" }],
];

const maKindKeyboard = [
  [{ text: "SMA", callback_data: "tg:act:ma_sma_01" }],
  [{ text: "EMA", callback_data: "tg:act:ma_ema_01" }],
];

const maLengthKeyboard = [
  [{ text: "30", callback_data: "tg:act:ma_len_30_01" }],
  [{ text: "60", callback_data: "tg:act:ma_len_60_01" }],
  [{ text: "90", callback_data: "tg:act:ma_len_90_01" }],
  [{ text: "200", callback_data: "tg:act:ma_len_200_01" }],
  [{ text: "其他", callback_data: "tg:act:ma_len_other_01" }],
];

const atrLengthKeyboard = [[{ text: "ATR 14（默认）", callback_data: "tg:act:atr_14_01" }]];

const atrMultiplierKeyboard = [
  [{ text: "0.1", callback_data: "tg:act:mult_0_1_01" }],
  [{ text: "0.5", callback_data: "tg:act:mult_0_5_01" }],
  [{ text: "1", callback_data: "tg:act:mult_1_01" }],
  [{ text: "1.5", callback_data: "tg:act:mult_1_5_01" }],
  [{ text: "2", callback_data: "tg:act:mult_2_01" }],
  [{ text: "2.5", callback_data: "tg:act:mult_2_5_01" }],
  [{ text: "5", callback_data: "tg:act:mult_5_01" }],
];

const legCountKeyboard = [
  [{ text: "1", callback_data: "tg:act:legs_1_01" }],
  [{ text: "2", callback_data: "tg:act:legs_2_01" }],
  [{ text: "3", callback_data: "tg:act:legs_3_01" }],
  [{ text: "4", callback_data: "tg:act:legs_4_01" }],
  [{ text: "5（默认）", callback_data: "tg:act:legs_5_01" }],
  [{ text: "6", callback_data: "tg:act:legs_6_01" }],
  [{ text: "8", callback_data: "tg:act:legs_8_01" }],
  [{ text: "10", callback_data: "tg:act:legs_10_01" }],
];

const protectionKindKeyboard = [
  [{ text: "止盈策略", callback_data: "tg:act:alex_kind_tp_01" }],
  [{ text: "止损策略", callback_data: "tg:act:alex_kind_sl_01" }],
];
const protectionPercentKeyboard = [
  [{ text: "25%", callback_data: "tg:act:alex_pct_25_01" }, { text: "50%", callback_data: "tg:act:alex_pct_50_01" }],
  [{ text: "75%", callback_data: "tg:act:alex_pct_75_01" }, { text: "100%（默认）", callback_data: "tg:act:alex_pct_100_01" }],
];

const takeProfitKeyboard = [
  [{ text: "默认止盈", callback_data: "tg:act:alex_tp_default_01" }],
  [{ text: "固定点位止盈", callback_data: "tg:act:alex_tp_fixed_01" }],
];

const stopLossKeyboard = [
  [{ text: "均线止损", callback_data: "tg:act:alex_sl_ma_01" }],
  [{ text: "支撑阻力线止损", callback_data: "tg:act:alex_sl_level_01" }],
];


const cancelKeyboard = [[{ text: "取消", callback_data: "tg:act:cancel_01" }]];
const backKeyboard = [[{ text: "返回上一级", callback_data: "tg:act:back_001" }]];

function withBack(keyboard: TelegramKeyboard): TelegramKeyboard {
  return [...keyboard, ...backKeyboard];
}

const cancelAndBackKeyboard = withBack(cancelKeyboard);
const liveConfirmationKeyboard = withBack([[{ text: "确认建立实盘策略", callback_data: "tg:act:confirm_live_01" }], ...cancelKeyboard]);
const quickConfirmationKeyboard = withBack([[{ text: "确认快速下单", callback_data: "tg:act:confirm_quick_01" }], ...cancelKeyboard]);
const homeOnlyKeyboard = [[{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]];

type TelegramKeyboard = Array<Array<{ text: string; callback_data: string }>>;

function exchangeOf(session: TelegramConversation): LiveExchange { return normalizeLiveExchange(session.draft.exchange); }
function requiredExchange(session: TelegramConversation): LiveExchange {
  if (session.draft.exchange === undefined) throw new Error("请先选择实盘交易所");
  return normalizeLiveExchange(session.draft.exchange);
}
function timeframeKeyboardFor(exchange: LiveExchange): TelegramKeyboard {
  const labels: Record<string, string> = { "5m": "5分钟", "15m": "15分钟", "1h": "1小时", "4h": "4小时", "1d": "1天", "1w": "1周" };
  const buttons = allowedLiveTimeframes(exchange).map((timeframe) => [{ text: labels[timeframe] ?? timeframe, callback_data: `tg:act:tf_${timeframe}_01` }]);
  return exchange === "BINANCE" ? [...buttons, [{ text: "其他", callback_data: "tg:act:tf_other_01" }]] : buttons;
}
function protectionTimeframeKeyboardFor(exchange: LiveExchange): TelegramKeyboard {
  const labels: Record<string, string> = { "5m": "5分钟", "15m": "15分钟", "1h": "1小时（默认）", "4h": "4小时", "1d": "1天" };
  return allowedLiveTimeframes(exchange).map((timeframe) => [{ text: labels[timeframe] ?? timeframe, callback_data: `tg:act:alex_tf_${timeframe}_01` }]);
}

function screen(text: string, replyMarkup: TelegramReplyMarkup | TelegramKeyboard = homeKeyboard): TelegramReply {
  return {
    text,
    replyMarkup: Array.isArray(replyMarkup) ? { inline_keyboard: replyMarkup } : replyMarkup,
    tradeRequested: false,
  };
}

async function transitionConversation(
  userId: string,
  dependencies: TelegramHandlerDependencies,
  changes: Record<string, unknown>,
  options: { reset?: boolean; expectedStep?: TelegramConversation["step"] } = {},
) {
  const load = dependencies.loadConversation ?? loadConversation;
  const save = dependencies.saveConversation ?? saveConversation;
  const current = await load(userId);
  if (options.expectedStep && (!current || current.step !== options.expectedStep)) throw new Error("请按顺序完成当前向导步骤");
  const base: TelegramConversation = options.reset || !current
    ? { ...newConversation(userId), version: current?.version ?? 0 }
    : current;
  const next = applyConversationInput(base, changes);
  return save({ ...next, version: base.version }, base.version);
}

async function currentConversation(userId: string, dependencies: TelegramHandlerDependencies) {
  const load = dependencies.loadConversation ?? loadConversation;
  return (await load(userId)) ?? newConversation(userId);
}

function normalizeSymbol(text: string | undefined) {
  return normalizeBinanceFuturesSymbol(text, "币种格式不正确");
}

function normalizeTimeframe(text: string | undefined) {
  const timeframe = text?.trim() ?? "";
  if (!STRATEGY_TIMEFRAMES.includes(timeframe as typeof STRATEGY_TIMEFRAMES[number])) throw new Error("周期不正确");
  return timeframe;
}

function normalizePositiveInteger(text: string | undefined, label: string) {
  const value = Number(text?.trim() ?? "");
  if (!Number.isSafeInteger(value) || value < 2) throw new Error(`${label}必须是不小于2的整数`);
  return value;
}

function normalizePositiveNumber(text: string | undefined, label: string) {
  const value = Number(text?.trim() ?? "");
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于0`);
  return value;
}

function evenlySpacedAtrOffsets(count: number, multiplier: number) {
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => Math.round((-multiplier + (2 * multiplier * index) / (count - 1)) * 1e8) / 1e8);
}

function numberText(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}

function accountText(label: "持仓" | "挂单", snapshot: Awaited<ReturnType<typeof getLiveAccountSnapshot>>) {
  if (!snapshot.connected) return `实盘${label}查询未连接：${snapshot.reason ?? "未知原因"}。`;
  if (label === "持仓") {
    if (!snapshot.positions.length) return "实盘持仓\n当前没有持仓。";
    return `实盘持仓\n${snapshot.positions.map((item) => `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · ✖️${item.leverage && item.leverage > 0 ? numberText(item.leverage) : "—"} · 数量 ${item.quantity} · 未实现 ${item.unrealizedPnl.toFixed(2)} USDT`).join("\n")}`;
  }
  if (!snapshot.orders.length) return "实盘挂单\n当前没有挂单。";
  return `实盘挂单\n${snapshot.orders.map((item) => `${item.websiteOrderId} · ${item.symbol} · ${item.side === "BUY" ? "买入" : "卖出"} · ${item.type} · ${item.quantity} @ ${item.price || item.stopPrice}`).join("\n")}`;
}

async function readSymbolLeverage(symbol: string, dependencies: TelegramHandlerDependencies, exchange?: LiveExchange): Promise<LiveSymbolLeverage> {
  const read = dependencies.getLiveSymbolLeverage ?? getLiveSymbolLeverage;
  try {
    return await (read as (item: string, options?: { exchange: LiveExchange }) => Promise<LiveSymbolLeverage>)(symbol, exchange === undefined ? undefined : { exchange });
  } catch {
    return { connected: false, symbol, leverage: null, reason: "币安当前杠杆查询暂时不可用" };
  }
}

function symbolDirectionPrompt(result: LiveSymbolLeverage, sideKeyboard: TelegramKeyboard) {
  const leverage = result.leverage === null ? "—" : numberText(result.leverage);
  const status = result.leverage === null ? `（${result.reason ?? "未读取到当前杠杆"}）` : "";
  return screen(`已记录币种 ${result.symbol} · 当前杠杆：✖️${leverage}${status}。请选择做多还是做空。`, withBack(sideKeyboard));
}

function previousStep(session: TelegramConversation): TelegramConversation["step"] | null {
  if (session.step === "EXCHANGE") return "HOME";
  if (session.step === "SYMBOL" && session.draft.homeEntry === true) return "EXCHANGE";
  const quickPrevious: Partial<Record<TelegramConversation["step"], TelegramConversation["step"]>> = {
    QUICK_SYMBOL: "HOME", QUICK_SIDE: "QUICK_SYMBOL", QUICK_TIMEFRAME: "QUICK_SIDE", QUICK_MARGIN: "QUICK_TIMEFRAME",
    QUICK_MARGIN_CUSTOM: "QUICK_MARGIN", QUICK_CONFIRM: "QUICK_MARGIN",
  };
  if (quickPrevious[session.step]) return quickPrevious[session.step] ?? null;
  if (session.step === "ALEX_CONFIRM") {
    const type = session.draft.alexStrategyType;
    if (type === "DEFAULT_TP" || type === "FIXED_TP") return type === "FIXED_TP" ? "ALEX_TP_PRICE" : "ALEX_TP_MODE";
    if (type === "MA_SL") return "ALEX_SL_TIMEFRAME";
    return "ALEX_SL_PRICE";
  }
  const previous: Partial<Record<TelegramConversation["step"], TelegramConversation["step"]>> = {
    SYMBOL: "EXCHANGE", SIDE: "SYMBOL", TIMEFRAME: "SIDE", TIMEFRAME_CUSTOM: "TIMEFRAME", METHOD: "TIMEFRAME",
    MA_KIND: "METHOD", MA_LENGTH: "MA_KIND", MA_LENGTH_CUSTOM: "MA_LENGTH", ATR_LENGTH: "MA_LENGTH",
    ATR_MULTIPLIER: "ATR_LENGTH", MARGIN: "ATR_MULTIPLIER", LEG_COUNT: "MARGIN", PARAMETERS: "METHOD", CONFIRM: "LEG_COUNT",
    ALEX_ASSET: "HOME", ALEX_KIND: "ALEX_ASSET", ALEX_TP_MODE: "ALEX_KIND", ALEX_TP_PRICE: "ALEX_TP_MODE",
    ALEX_SL_MODE: "ALEX_KIND", ALEX_SL_TIMEFRAME: "ALEX_SL_MODE", ALEX_SL_PRICE: "ALEX_SL_TIMEFRAME",
  };
  return previous[session.step] ?? null;
}

function renderWizardStep(step: TelegramConversation["step"], session: TelegramConversation) {
  const draft = session.draft;
  switch (step) {
    case "QUICK_SYMBOL": return { text: "默认快速下单。请输入币种，例如 BTCUSDT 或 BTCUSDC。", keyboard: cancelAndBackKeyboard };
    case "QUICK_SIDE": return { text: "已记录币种。请选择做多还是做空。", keyboard: withBack(quickSideKeyboard) };
    case "QUICK_TIMEFRAME": return { text: "已记录方向。请选择 K 线周期。", keyboard: withBack(quickTimeframeKeyboard) };
    case "QUICK_MARGIN": return { text: "请选择总保证金金额。金额按总保证金计算，系统会读取 Binance 当前杠杆后换算名义金额。", keyboard: withBack(quickMarginKeyboard) };
    case "QUICK_MARGIN_CUSTOM": return { text: "请输入其他总保证金金额（USDT）。", keyboard: cancelAndBackKeyboard };
    case "QUICK_CONFIRM": return { text: quickOrderSummary(session), keyboard: quickConfirmationKeyboard };
    case "EXCHANGE": return { text: "请选择本次实盘操作使用的交易所。", keyboard: withBack(exchangeKeyboard) };
    case "SYMBOL": return { text: `建立 ${exchangeOf(session)} 实盘策略。请输入币种，例如 BTCUSDT 或 BTCUSDC。`, keyboard: cancelAndBackKeyboard };
    case "SIDE": return { text: "已记录币种。请选择做多还是做空。", keyboard: withBack(sideKeyboard) };
    case "TIMEFRAME": return { text: "请选择参与周期，默认是1小时。", keyboard: withBack(timeframeKeyboardFor(exchangeOf(session))) };
    case "TIMEFRAME_CUSTOM": return { text: "请输入 Binance 支持的 K 线周期，例如 3m、30m、2h、6h、12h、3d 或 1M。", keyboard: cancelAndBackKeyboard };
    case "METHOD": return { text: "请选择均线策略或关键位策略。", keyboard: withBack(methodKeyboard) };
    case "MA_KIND": return { text: "请选择均线类型。", keyboard: withBack(maKindKeyboard) };
    case "MA_LENGTH": return { text: `已选择${draft.maKind === "EMA" ? "EMA" : "SMA"}。请选择均线长度。`, keyboard: withBack(maLengthKeyboard) };
    case "MA_LENGTH_CUSTOM": return { text: "请输入均线长度（不小于2的整数）。", keyboard: cancelAndBackKeyboard };
    case "ATR_LENGTH": return { text: "均线长度已记录。ATR 周期固定使用默认值14。", keyboard: withBack(atrLengthKeyboard) };
    case "ATR_MULTIPLIER": return { text: "请选择均线上下方的 ATR 倍数。支持小于1的倍数。", keyboard: withBack(atrMultiplierKeyboard) };
    case "MARGIN": return { text: "请输入总保证金（USDT），例如 100。", keyboard: cancelAndBackKeyboard };
    case "LEG_COUNT": return { text: "请选择分几笔下单（默认5笔）。", keyboard: withBack(legCountKeyboard) };
    case "PARAMETERS": return { text: "关键位策略暂需在网站端配置，请返回选择均线策略。", keyboard: withBack(methodKeyboard) };
    case "ALEX_ASSET": return { text: `请选择要挂止盈止损的${exchangeOf(session) === "BYBIT" ? "Bybit" : "币安"}手动持仓。`, keyboard: alexCandidateKeyboard(session) };
    case "ALEX_PERCENT": return { text: "请选择本次保护的手动持仓比例（默认 100%）。", keyboard: withBack(protectionPercentKeyboard) };
    case "ALEX_KIND": return { text: "请选择要挂止盈还是止损策略。", keyboard: withBack(protectionKindKeyboard) };
    case "ALEX_TP_MODE": return { text: "请选择止盈方式。默认止盈按 ROI/保证金收益率执行：100% 卖初始仓25%，200% 卖初始仓40%。", keyboard: withBack(takeProfitKeyboard) };
    case "ALEX_TP_PRICE": return { text: "请输入固定止盈触发价格。", keyboard: cancelAndBackKeyboard };
    case "ALEX_SL_MODE": return { text: "请选择止损方式。", keyboard: withBack(stopLossKeyboard) };
    case "ALEX_SL_TIMEFRAME": return { text: "请选择均线止损使用的 K 线周期。", keyboard: withBack(protectionTimeframeKeyboardFor(exchangeOf(session))) };
    case "ALEX_SL_PRICE": return { text: "请输入支撑阻力线触发价格。", keyboard: cancelAndBackKeyboard };
    case "ALEX_CONFIRM": return { text: protectionSummary(session), keyboard: withBack([[{ text: "确认挂策略单", callback_data: "tg:act:confirm_protection_01" }], ...cancelKeyboard]) };
    default: return { text: "请选择当前步骤。", keyboard: homeKeyboard };
  }
}

function liveStrategyDraft(session: TelegramConversation): LiveStrategyDraft & { atr: { length: number; multiplier: number } } {
  const draft = session.draft;
  const exchange = requiredExchange(session);
  const symbol = String(draft.symbol ?? "").trim().toUpperCase();
  const side = draft.side === "LONG" || draft.side === "SHORT" ? draft.side : null;
  const timeframe = String(draft.timeframe ?? "");
  const maKind = draft.maKind === "SMA" || draft.maKind === "EMA" ? draft.maKind : null;
  const maLength = Number(draft.maLength);
  const atrLength = Number(draft.atrLength);
  const atrMultiplier = Number(draft.atrMultiplier);
  const totalMarginUsdt = Number(draft.totalMarginUsdt);
  const legCount = Number(draft.legCount);
  if (!isBinanceFuturesSymbol(symbol) || !side || !allowedLiveTimeframes(exchange).includes(timeframe as typeof STRATEGY_TIMEFRAMES[number])
    || !maKind || !Number.isSafeInteger(maLength) || maLength < 2 || !Number.isSafeInteger(atrLength) || atrLength < 1
    || !Number.isFinite(atrMultiplier) || atrMultiplier <= 0 || !Number.isFinite(totalMarginUsdt) || totalMarginUsdt <= 0
    || !Number.isSafeInteger(legCount) || legCount < 1 || legCount > 10) throw new Error("实盘策略参数不完整，入场单数量必须是1到10笔");
  const marginPerLeg = totalMarginUsdt / legCount;
  return {
    exchange, symbol, side, timeframe, style: "MA", mode: "LIVE_ARMED", totalMarginUsdt,
    ma: { kind: maKind, length: maLength }, atr: { length: atrLength, multiplier: atrMultiplier },
    legs: evenlySpacedAtrOffsets(legCount, atrMultiplier).map((atrOffset, index) => ({
      atrOffset,
      marginUsdt: index === legCount - 1 ? totalMarginUsdt - marginPerLeg * (legCount - 1) : marginPerLeg,
    })),
    execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
    dynamicGuard: { atrMultiplier }, firstGuardExitPct: 50, useDefaultProfitTargets: true,
  } as LiveStrategyDraft & { atr: { length: number; multiplier: number } };
}

function quickOrderSummary(session: TelegramConversation) {
  const draft = session.draft;
  const totalMargin = Number(draft.totalMarginUsdt ?? 0);
  const marginPerLeg = totalMargin / QUICK_DEFAULT_LEG_COUNT;
  const timeframe = String(draft.timeframe ?? "");
  const side = draft.side === "LONG" ? "做多" : "做空";
  const leverage = Number(draft.currentLeverage);
  const leverageText = Number.isFinite(leverage) && leverage > 0 ? `✖️${numberText(leverage)}` : "✖️—";
  return `默认下单确认\n${String(draft.symbol ?? "")} · ${side} · 周期 ${timeframe}\n当前杠杆：${leverageText}\n默认参数：SMA30 · ATR14 × 1 · 5笔等额 Post Only 限价单\n总保证金：${numberText(totalMargin)} USDT · 每笔保证金：${numberText(marginPerLeg)} USDT\n目标总名义金额：总保证金 × Binance 当前默认杠杆（点击确认时实时读取）\n默认止盈：ROI/保证金收益率达到100%卖初始仓25%，达到200%卖初始仓40%，余下仓位跟随守卫。\n动态止损：首根失效 K 线减仓50%，第二根连续失效退出剩余仓位。\n点击确认后才会执行余额、精度、最小名义金额和当前杠杆检查。`;
}

function liveExecutionText(result: Awaited<ReturnType<typeof submitLiveStrategy>>) {
  if (!result.strategy) return `实盘策略建立失败：${result.error ?? "没有创建真实订单"}`;
  const strategy = result.strategy as LiveStrategy;
  const orders = result.orders ?? strategy.orders ?? [];
  const legNames = new Map((strategy.legs ?? []).map((leg) => [leg.id, leg.websiteOrderId]));
  const rows = orders.length
    ? orders.map((order) => `${legNames.get(order.legId) ?? order.legId} · ${order.clientOrderId} · ${order.status}${order.exchangeOrderId ? ` · Binance ${order.exchangeOrderId}` : ""}`).join("\n")
    : "尚未生成可确认的实盘订单";
  return `实盘策略 ${strategy.id}：${result.ok ? "真实限价单已提交" : "真实限价单未全部受理，需要对账"}\n${rows}${result.error ? `\n${result.error}` : ""}\n请在实盘挂单和持仓中核对，系统不会自动重试或市价兜底。`;
}

function liveStrategyText(strategies: LiveStrategy[], protections: PersistedProtectionStrategy[]) {
  const liveRows = strategies.map((strategy) => {
    const orders = strategy.orders.length
      ? strategy.orders.map((order) => `${order.clientOrderId} · ${order.status}${order.exchangeOrderId ? ` · Binance ${order.exchangeOrderId}` : ""}`).join("，")
      : "暂无订单记录";
    const generation = strategy.currentGeneration;
    const lifecycle = strategy.lifecycle;
    const entryQuantity = Number(lifecycle?.entryQuantity ?? 0);
    const exitQuantity = Number(lifecycle?.exitQuantity ?? 0);
    const closed = entryQuantity > 0 && exitQuantity >= entryQuantity;
    const lifecycleStatus = lifecycle?.entryFreezeReason === "ENTRY_FROZEN_BY_STOP"
      ? "止损冻结并撤余单"
      : strategy.status === "RECONCILIATION_REQUIRED"
        ? "需要对账"
        : closed
          ? "已完整退出"
          : lifecycle?.targetStatus === "TARGET_COMPLETE"
            ? "目标已全部成交（非仓位已平）"
            : strategy.status === "CLOSED" ? "策略已关闭（退出结果待对账）" : null;
    const attempts = strategy.attempts?.length
      ? strategy.attempts.map((attempt) => `第 ${attempt.generation} 轮 ${attempt.clientOrderId} · 创建${Number(attempt.executedQuantity) > 0 ? `→成交 ${attempt.executedQuantity}` : ""}${attempt.status === "CANCELED" || attempt.cancellationResult ? "→撤销" : ""}${generation && attempt.generation < generation.generation ? "→替换" : ""}${attempt.status === "UNKNOWN" ? "→待对账" : ""}`).join("；")
      : "历史订单尝试待上游写入";
    return `入场策略 ${strategy.id} · ${strategy.config.symbol} · ${strategy.config.side === "LONG" ? "做多" : "做空"} · ${strategy.status}\n第 ${generation?.generation ?? "—"} 轮 · 锚定已收盘K线 ${generation?.anchorCandleId ?? "待上游写入"} · 下一次刷新 ${generation?.nextRefreshAt ?? "待上游计算"}\n已成交 / 待补齐：累计数量 ${lifecycle?.entryQuantity ?? "0"} / 当前轮 ${strategy.attempts?.filter((attempt) => attempt.generation === generation?.generation && attempt.intent === "ENTRY").reduce((total, attempt) => total + Math.max(0, Number(attempt.quantity) - Number(attempt.executedQuantity)), 0) ?? "—"}${lifecycleStatus ? `\n${lifecycleStatus}` : ""}\n历史订单尝试（只读）：${attempts}\n${orders}`;
  });
  const protectionRows = protections.map((strategy) => {
    const orders = strategy.orders.length ? strategy.orders.map((order) => `${order.clientOrderId} · ${order.status}${order.exchangeOrderId ? ` · Binance ${order.exchangeOrderId}` : ""}`).join("，") : "暂无保护单记录";
    return `保护策略 ${strategy.id} · ${strategy.symbol} · ${strategy.side === "LONG" ? "做多" : "做空"} · 来源 ${strategy.sourceOrderId} · ${strategy.status}\n${orders}`;
  });
  const rows = [...liveRows, ...protectionRows];
  return rows.length ? `实盘策略管理\n${rows.join("\n\n")}` : "实盘策略管理\n当前没有实盘策略。";
}

function alexCandidates(session: TelegramConversation): ProtectionPosition[] {
  return Array.isArray(session.draft.alexCandidates) ? session.draft.alexCandidates as ProtectionPosition[] : [];
}

function selectedAlexCandidate(session: TelegramConversation) {
  return alexCandidates(session).find((item) => item.candidateId === session.draft.alexSelectedCandidateId) ?? null;
}

function candidateManualNotional(candidate: ProtectionPosition) {
  return candidate.manualNotional ?? candidate.quantity * candidate.markPrice;
}

function candidateOtherNotional(candidate: ProtectionPosition) {
  return candidate.otherNotional ?? 0;
}

function candidateTotalNotional(candidate: ProtectionPosition) {
  return candidate.totalNotional ?? candidateManualNotional(candidate) + candidateOtherNotional(candidate);
}

function candidateSourceText(candidate: ProtectionPosition) {
  const sourceIds = candidate.sourceOrderIds.slice(0, 8).join("，");
  const suffix = candidate.sourceOrderIds.length > 8 ? ` … 共${candidate.sourceOrderIds.length}笔` : "";
  return `原始 Binance clientOrderId（保持不变）：${sourceIds}${suffix}`;
}

function alexCandidateKeyboard(session: TelegramConversation): TelegramKeyboard {
  return withBack(alexCandidates(session).map((item, index) => [{
    text: `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · 手动 ${numberText(item.quantity)} / ${numberText(candidateManualNotional(item))} USDT · 其他 ${numberText(item.otherQuantity ?? 0)}`,
    callback_data: `tg:act:alex_asset_${index}_01`,
  }]));
}

function alexCandidateText(session: TelegramConversation) {
  const rows = alexCandidates(session).map((item) => `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · 手动数量 ${numberText(item.quantity)} · 手动名义 ${numberText(candidateManualNotional(item))} USDT · 其他来源 ${numberText(item.otherQuantity ?? 0)} / ${numberText(candidateOtherNotional(item))} USDT · 总仓 ${numberText(item.totalQuantity ?? item.quantity)} / ${numberText(candidateTotalNotional(item))} USDT`);
  return `请选择要挂止盈止损的币安手动持仓。\n${rows.join("\n")}`;
}

function protectionSummary(session: TelegramConversation) {
  const candidate = selectedAlexCandidate(session);
  if (!candidate) return "当前保护策略来源已失效，请返回重新选择持仓。";
  const type = session.draft.alexStrategyType as ProtectionStrategyType | undefined;
  const detail = type === "DEFAULT_TP"
    ? "默认止盈：ROI/保证金收益率达到100%卖初始仓25%，达到200%卖初始仓40%，余下仓位保留。"
    : type === "FIXED_TP"
      ? `固定点位止盈：${session.draft.alexFixedPrice}`
      : type === "MA_SL"
        ? candidate.side === "LONG"
          ? `均线止损：多单收盘跌破 SMA30 - ATR14 × 1 ATR，周期 ${session.draft.alexTimeframe ?? "1h"}；首根失效 K 线减仓50%，第二根连续失效退出。`
          : `均线止损：空单收盘突破 SMA30 + ATR14 × 1 ATR，周期 ${session.draft.alexTimeframe ?? "1h"}；首根失效 K 线减仓50%，第二根连续失效退出。`
        : `支撑阻力线止损：${session.draft.alexFixedPrice}`;
  return `请确认保护策略\n${candidate.symbol} · ${candidate.side === "LONG" ? "做多" : "做空"}\n手动保护数量：${numberText(candidate.quantity)} · 名义 ${numberText(candidateManualNotional(candidate))} USDT · 估算保证金 ${numberText(candidate.manualMargin ?? candidateManualNotional(candidate) / Math.max(candidate.leverage, 1))} USDT\n其他来源数量：${numberText(candidate.otherQuantity ?? 0)} · 名义 ${numberText(candidateOtherNotional(candidate))} USDT\n总持仓：${numberText(candidate.totalQuantity ?? candidate.quantity)} · 名义 ${numberText(candidateTotalNotional(candidate))} USDT\n${candidateSourceText(candidate)}\n${candidate.reconciliationRequired ? "⚠️ 手动来源数量与当前持仓无法安全对账，本次不可提交。\n" : ""}${detail}\n点击确认后才会向 Binance 提交只减仓实盘保护单。`;
}

function protectionText(result: Awaited<ReturnType<typeof createProtectionStrategy>>) {
  const strategy = result.strategy;
  const config = strategy.config ?? {};
  const rows = strategy.orders.length
    ? strategy.orders.map((order) => `${order.clientOrderId} · ${order.status}${order.exchangeOrderId ? ` · Binance ${order.exchangeOrderId}` : ""}`).join("\n")
    : "该策略由后台均线监控，不立即创建原生触发单。";
  const aliases = Array.isArray(config.manualAliasIds) && config.manualAliasIds.length
    ? `\nios归属：${config.manualAliasIds.join("，")}` : "";
  const sources = Array.isArray(config.sourceOrderIds) && config.sourceOrderIds.length
    ? `\n原始订单：${config.sourceOrderIds.join("，")}` : "";
  return `保护策略 ${strategy.id}：${result.ok ? "已提交" : "未全部受理，需要对账"}\n来源 ${strategy.sourceOrderId} · ${strategy.symbol}${aliases}${sources}\n${rows}${result.error ? `\n${result.error}` : ""}`;
}

export async function handleAuthorizedTelegramUpdate(update: AuthorizedUpdate, dependencies: TelegramHandlerDependencies = {}): Promise<TelegramReply> {
  const isStart = update.kind === "MESSAGE" && (update.text === "/start" || update.text === "/menu");
  if (isStart) {
    await transitionConversation(update.userId, dependencies, { step: "HOME" }, { reset: true });
    return screen("交易机器人已连接。当前仅显示实盘交易功能。", homeKeyboard);
  }

  if (update.kind === "CALLBACK") {
    let actionId: string;
    try { actionId = parseCallback(update.callbackData).actionId; } catch { return screen("无效操作，请重新打开主菜单。", homeKeyboard); }

    if (actionId === "back_001") {
      const current = await currentConversation(update.userId, dependencies);
      const target = previousStep(current);
      if (!target || target === "HOME") {
        await transitionConversation(update.userId, dependencies, { step: "HOME" }, { reset: true });
        return screen("已返回主菜单。", homeKeyboard);
      }
      await transitionConversation(update.userId, dependencies, { step: target, confirmNonce: null }, { expectedStep: current.step });
      const view = renderWizardStep(target, current);
      return screen(view.text, view.keyboard);
    }

    if (actionId === "home_menu_01" || actionId === "cancel_01") {
      await transitionConversation(update.userId, dependencies, { step: "HOME" }, { reset: true });
      return screen(actionId === "cancel_01" ? "已取消当前操作。" : "请选择操作。", homeKeyboard);
    }

    if (actionId === "home_new_live_01" || actionId === "home_new_01") {
      await transitionConversation(update.userId, dependencies, { mode: "LIVE_ARMED", homeEntry: true, step: "EXCHANGE" }, { reset: true });
      return screen("建立实盘策略前，请先选择交易所。", withBack(exchangeKeyboard));
    }

    if (actionId === "quick_order_01") {
      await transitionConversation(update.userId, dependencies, {
        mode: "LIVE_ARMED", quickOrder: true, maKind: "SMA", maLength: 30, atrLength: 14, atrMultiplier: 1, legCount: QUICK_DEFAULT_LEG_COUNT,
        step: "EXCHANGE", confirmNonce: null,
      }, { reset: true });
      return screen("默认快速下单前，请先选择交易所。", withBack(exchangeKeyboard));
    }

    if (["home_positions_01", "home_live_positions_01"].includes(actionId)) {
      try {
        const getSnapshot = dependencies.getLiveAccountSnapshot ?? getLiveAccountSnapshot;
        return screen(accountText("持仓", await getSnapshot()), homeKeyboard);
      } catch { return screen("实盘持仓查询暂时不可用，请稍后重试。", homeKeyboard); }
    }

    if (["home_orders_01", "home_live_orders_01"].includes(actionId)) {
      try {
        const getSnapshot = dependencies.getLiveAccountSnapshot ?? getLiveAccountSnapshot;
        return screen(accountText("挂单", await getSnapshot()), homeKeyboard);
      } catch { return screen("实盘挂单查询暂时不可用，请稍后重试。", homeKeyboard); }
    }

    if (["home_strategies_01", "home_live_strategies_01"].includes(actionId)) {
      try {
        const liveList = dependencies.listLiveStrategies ?? listLiveStrategies;
        const protectionList = dependencies.listProtectionStrategies ?? listProtectionStrategies;
        return screen(liveStrategyText(await liveList(20), await protectionList(50)), homeKeyboard);
      } catch { return screen("实盘策略管理暂时不可用，请稍后重试。", homeKeyboard); }
    }

    if (actionId === "home_protection_01") {
      await transitionConversation(update.userId, dependencies, { homeEntry: "PROTECTION", step: "EXCHANGE" }, { reset: true });
      return screen("挂止盈止损策略前，请先选择交易所。", withBack(exchangeKeyboard));
    }

    const session = await currentConversation(update.userId, dependencies);
    if (actionId === "exchange_binance_01" || actionId === "exchange_bybit_01") {
      if (session.step !== "EXCHANGE") return screen("交易所选择已失效，请从主菜单重新开始。", homeOnlyKeyboard);
      const exchange: LiveExchange = actionId === "exchange_bybit_01" ? "BYBIT" : "BINANCE";
      if (session.draft.homeEntry === "PROTECTION") {
        try {
          const findPositions = dependencies.getAlexManualPositions ?? getAlexManualPositions;
          const result: AlexPositionsResult = await findPositions({ exchange } as never);
          const name = exchange === "BYBIT" ? "Bybit" : "币安";
          if (!result.connected) return screen(`${name}手动持仓查询未连接：${result.reason ?? "未知原因"}。`, homeKeyboard);
          if (!result.positions.length) return screen(`当前没有可挂保护策略的${name}手动持仓。`, homeKeyboard);
          await transitionConversation(update.userId, dependencies, { exchange, alexCandidates: result.positions, step: "ALEX_ASSET", confirmNonce: null }, { expectedStep: "EXCHANGE" });
          const current = await currentConversation(update.userId, dependencies);
          return screen(alexCandidateText(current), alexCandidateKeyboard(current));
        } catch (error) { return screen(`手动持仓查询失败：${error instanceof Error ? error.message : "未知错误"}`, homeKeyboard); }
      }
      const quick = session.draft.quickOrder === true;
      await transitionConversation(update.userId, dependencies, { exchange, step: quick ? "QUICK_SYMBOL" : "SYMBOL" }, { expectedStep: "EXCHANGE" });
      return screen(`已选择 ${exchange}。请输入币种，例如 BTCUSDT。`, cancelAndBackKeyboard);
    }

    if (actionId.startsWith("alex_asset_") && actionId.endsWith("_01")) {
      const index = Number(actionId.slice("alex_asset_".length, -3));
      const session = await currentConversation(update.userId, dependencies);
      const candidate = alexCandidates(session)[index];
      if (!candidate || session.step !== "ALEX_ASSET") return screen("持仓候选已失效，请重新打开保护策略入口。", homeOnlyKeyboard);
      await transitionConversation(update.userId, dependencies, { alexSelectedCandidateId: candidate.candidateId, alexProtectionPercent: 100, step: "ALEX_PERCENT" }, { expectedStep: "ALEX_ASSET" });
      return screen("请选择本次保护的手动持仓比例（默认 100%）。", withBack(protectionPercentKeyboard));
    }

    const percentMatch = /^alex_pct_(25|50|75|100)_01$/.exec(actionId);
    if (percentMatch) {
      if (session.step !== "ALEX_PERCENT" || !selectedAlexCandidate(session)) return screen("保护比例选择已失效，请重新选择持仓。", homeOnlyKeyboard);
      await transitionConversation(update.userId, dependencies, { alexProtectionPercent: Number(percentMatch[1]), step: "ALEX_KIND" }, { expectedStep: "ALEX_PERCENT" });
      return screen("请选择要挂止盈还是止损策略。", withBack(protectionKindKeyboard));
    }

    if (actionId === "alex_kind_tp_01" || actionId === "alex_kind_sl_01") {
      if (session.step !== "ALEX_KIND" || !selectedAlexCandidate(session)) return screen("保护策略来源已失效，请重新选择持仓。", homeOnlyKeyboard);
      await transitionConversation(update.userId, dependencies, { step: actionId.endsWith("tp_01") ? "ALEX_TP_MODE" : "ALEX_SL_MODE" }, { expectedStep: "ALEX_KIND" });
      return screen(actionId.endsWith("tp_01") ? "请选择止盈方式。" : "请选择止损方式。", withBack(actionId.endsWith("tp_01") ? takeProfitKeyboard : stopLossKeyboard));
    }

    if (actionId === "alex_tp_default_01") {
      await transitionConversation(update.userId, dependencies, { alexStrategyType: "DEFAULT_TP", step: "ALEX_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: "ALEX_TP_MODE" });
      const current = await currentConversation(update.userId, dependencies);
      return screen(protectionSummary(current), renderWizardStep("ALEX_CONFIRM", current).keyboard);
    }
    if (actionId === "alex_tp_fixed_01") {
      await transitionConversation(update.userId, dependencies, { alexStrategyType: "FIXED_TP", step: "ALEX_TP_PRICE", confirmNonce: null }, { expectedStep: "ALEX_TP_MODE" });
      return screen("请输入固定止盈触发价格。", cancelAndBackKeyboard);
    }
    if (actionId === "alex_sl_ma_01") {
      await transitionConversation(update.userId, dependencies, { alexStrategyType: "MA_SL", step: "ALEX_SL_TIMEFRAME" }, { expectedStep: "ALEX_SL_MODE" });
      return screen("请选择均线止损使用的 K 线周期。", withBack(protectionTimeframeKeyboardFor(exchangeOf(session))));
    }
    if (actionId === "alex_sl_level_01") {
      await transitionConversation(update.userId, dependencies, { alexStrategyType: "LEVEL_SL", step: "ALEX_SL_PRICE", confirmNonce: null }, { expectedStep: "ALEX_SL_MODE" });
      return screen("请输入支撑阻力线触发价格。", cancelAndBackKeyboard);
    }
    const alexTimeframes: Record<string, string> = { alex_tf_5m_01: "5m", alex_tf_15m_01: "15m", alex_tf_1h_01: "1h", alex_tf_4h_01: "4h", alex_tf_1d_01: "1d" };
    if (alexTimeframes[actionId]) {
      const exchange = exchangeOf(session);
      if (!allowedLiveTimeframes(exchange).includes(alexTimeframes[actionId] as typeof STRATEGY_TIMEFRAMES[number])) {
        return screen("Bybit 只支持 1h、4h、1d 周期。", withBack(protectionTimeframeKeyboardFor(exchange)));
      }
      await transitionConversation(update.userId, dependencies, { alexTimeframe: alexTimeframes[actionId], step: "ALEX_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: "ALEX_SL_TIMEFRAME" });
      const current = await currentConversation(update.userId, dependencies);
      return screen(protectionSummary(current), renderWizardStep("ALEX_CONFIRM", current).keyboard);
    }

    if (actionId === "confirm_protection_01") {
      const load = dependencies.loadConversation ?? loadConversation;
      const current = await load(update.userId);
      const selectedCandidate = current ? selectedAlexCandidate(current) : null;
      const type = current?.draft.alexStrategyType;
      if (!current || current.step !== "ALEX_CONFIRM" || !current.confirmNonce || !selectedCandidate || !["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"].includes(String(type))) {
        return screen("当前保护策略确认已失效，请重新选择持仓和策略。", homeOnlyKeyboard);
      }
      const findPositions = dependencies.getAlexManualPositions ?? getAlexManualPositions;
      let candidate: ProtectionPosition;
      let exchange: LiveExchange;
      try { exchange = requiredExchange(current); }
      catch { return screen("当前保护策略缺少交易所，请重新选择交易所和持仓。", homeOnlyKeyboard); }
      try {
        const latest = await findPositions({ exchange } as never);
        const refreshedCandidate = latest.positions.find((item) => item.candidateId === selectedCandidate.candidateId);
        if (!latest.connected || !refreshedCandidate) return screen("持仓来源在确认前已经变化，请返回重新读取并选择。", homeOnlyKeyboard);
        const protectionPercent = Number(current.draft.alexProtectionPercent ?? 100);
        if (![25, 50, 75, 100].includes(protectionPercent)) return screen("保护比例无效，请重新选择。", homeOnlyKeyboard);
        candidate = { ...refreshedCandidate, quantity: refreshedCandidate.quantity * protectionPercent / 100 };
      } catch { return screen("确认前重新读取手动持仓失败，请稍后重试。", homeOnlyKeyboard); }
      const nonce = current.confirmNonce;
      const consume = dependencies.consumeConfirmation ?? consumeConfirmation;
      if (!await consume(update.userId, nonce)) return screen("该保护策略确认已经使用或已过期，没有重复提交。", homeOnlyKeyboard);
      try {
        const create = dependencies.createProtectionStrategy ?? createProtectionStrategy;
        const input = {
          exchange, origin: "ALEX", source: candidate, strategyType: type as ProtectionStrategyType,
          ...(current.draft.alexFixedPrice === undefined ? {} : { fixedPrice: Number(current.draft.alexFixedPrice) }),
          ...(current.draft.alexTimeframe === undefined ? {} : { timeframe: String(current.draft.alexTimeframe) }),
          idempotencyKey: `telegram:alex:${update.userId}:${nonce}`,
        } as unknown as ProtectionCreateInput;
        const result = await create(input);
        return screen(protectionText(result), homeOnlyKeyboard);
      } catch (error) {
        return screen(`保护策略提交失败：${error instanceof Error ? error.message : "未知错误"}。请先核对实盘持仓和挂单，不要重复提交。`, homeOnlyKeyboard);
      }
    }

    if (actionId === "confirm_live_01") {
      const load = dependencies.loadConversation ?? loadConversation;
      const current = await load(update.userId);
      if (!current || current.step !== "CONFIRM" || !current.confirmNonce || current.draft.mode !== "LIVE_ARMED") return screen("当前实盘确认已失效，请重新建立策略。没有创建真实订单。", homeOnlyKeyboard);
      const nonce = current.confirmNonce;
      let draft: LiveStrategyDraft;
      try { draft = liveStrategyDraft(current); } catch (error) { return screen(error instanceof Error ? error.message : "实盘策略参数不完整，请重新建立策略。", liveConfirmationKeyboard); }
      const consume = dependencies.consumeConfirmation ?? consumeConfirmation;
      if (!await consume(update.userId, nonce)) return screen("该实盘确认已经使用或已过期，没有重复创建订单。", homeOnlyKeyboard);
      try {
        const submit = dependencies.submitLiveStrategy ?? submitLiveStrategy;
        const result = await submit({ origin: "TELEGRAM", draft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: nonce, liveSwitchOn: true }, dependencies.liveStrategyDependencies);
        return screen(liveExecutionText(result), homeOnlyKeyboard);
      } catch (error) { return screen(`实盘策略提交失败：${error instanceof Error ? error.message : "未知错误"}。请先核对实盘挂单和持仓，不要重复提交。`, homeOnlyKeyboard); }
    }

    if (actionId === "confirm_quick_01") {
      const load = dependencies.loadConversation ?? loadConversation;
      const current = await load(update.userId);
      if (!current || current.step !== "QUICK_CONFIRM" || !current.confirmNonce || current.draft.mode !== "LIVE_ARMED" || current.draft.quickOrder !== true) {
        return screen("当前快捷下单确认已失效，请重新开始默认下单。没有创建真实订单。", homeOnlyKeyboard);
      }
      const nonce = current.confirmNonce;
      let draft: LiveStrategyDraft;
      try { draft = liveStrategyDraft(current); } catch (error) { return screen(error instanceof Error ? error.message : "快捷下单参数不完整，请重新开始。", quickConfirmationKeyboard); }
      const consume = dependencies.consumeConfirmation ?? consumeConfirmation;
      if (!await consume(update.userId, nonce)) return screen("该快捷下单确认已经使用或已过期，没有重复创建订单。", homeOnlyKeyboard);
      try {
        const submit = dependencies.submitLiveStrategy ?? submitLiveStrategy;
        const result = await submit({ origin: "TELEGRAM", draft, confirmation: "CREATE_LIVE_STRATEGY", confirmationNonce: nonce, liveSwitchOn: true }, dependencies.liveStrategyDependencies);
        return screen(liveExecutionText(result), homeOnlyKeyboard);
      } catch (error) { return screen(`快捷下单失败：${error instanceof Error ? error.message : "未知错误"}。请先核对实盘挂单和持仓，不要重复提交。`, homeKeyboard); }
    }

    if (actionId === "quick_side_long_01" || actionId === "quick_side_short_01") {
      await transitionConversation(update.userId, dependencies, { side: actionId === "quick_side_long_01" ? "LONG" : "SHORT", step: "QUICK_TIMEFRAME" }, { expectedStep: "QUICK_SIDE" });
      const selected = await currentConversation(update.userId, dependencies);
      return screen("已记录方向。请选择 K 线周期。", withBack(timeframeKeyboardFor(exchangeOf(selected)).filter((row) => row[0].callback_data !== "tg:act:tf_5m_01" && row[0].callback_data !== "tg:act:tf_other_01").map((row) => [{ ...row[0], callback_data: row[0].callback_data.replace("tg:act:tf_", "tg:act:quick_tf_") }])));
    }
    const quickTimeframes: Record<string, string> = { quick_tf_15m_01: "15m", quick_tf_1h_01: "1h", quick_tf_4h_01: "4h", quick_tf_1d_01: "1d", quick_tf_1w_01: "1w" };
    if (quickTimeframes[actionId]) {
      const exchange = exchangeOf(session);
      if (!allowedLiveTimeframes(exchange).includes(quickTimeframes[actionId] as typeof STRATEGY_TIMEFRAMES[number])) return screen("Bybit 只支持 1h、4h、1d 周期。", withBack(timeframeKeyboardFor(exchange)));
      await transitionConversation(update.userId, dependencies, { timeframe: quickTimeframes[actionId], step: "QUICK_MARGIN" }, { expectedStep: "QUICK_TIMEFRAME" });
      return screen("已记录周期。请选择总保证金金额。", withBack(quickMarginKeyboard));
    }
    const quickMargins: Record<string, number> = { qk_default_01: QUICK_DEFAULT_MARGIN_USDT, qk_a1_01: 30, qk_b2_01: 50, qk_c3_01: 70 };
    if (quickMargins[actionId] !== undefined) {
      await transitionConversation(update.userId, dependencies, { totalMarginUsdt: quickMargins[actionId], step: "QUICK_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: "QUICK_MARGIN" });
      const current = await currentConversation(update.userId, dependencies);
      return screen(quickOrderSummary(current), quickConfirmationKeyboard);
    }
    if (actionId === "qk_d4_01") {
      await transitionConversation(update.userId, dependencies, { step: "QUICK_MARGIN_CUSTOM", confirmNonce: null }, { expectedStep: "QUICK_MARGIN" });
      return screen("请输入其他总保证金金额（USDT）。", cancelAndBackKeyboard);
    }

    if (actionId === "side_long_01" || actionId === "side_short_01") {
      await transitionConversation(update.userId, dependencies, { side: actionId === "side_long_01" ? "LONG" : "SHORT", step: "TIMEFRAME" }, { expectedStep: "SIDE" });
      const selected = await currentConversation(update.userId, dependencies);
      return screen("已记录方向。请选择参与周期。", withBack(timeframeKeyboardFor(exchangeOf(selected))));
    }
    const timeframes: Record<string, string> = { tf_5m_01: "5m", tf_15m_01: "15m", tf_1h_01: "1h", tf_4h_01: "4h", tf_1d_01: "1d", tf_1w_01: "1w" };
    if (timeframes[actionId]) {
      const exchange = exchangeOf(session);
      if (!allowedLiveTimeframes(exchange).includes(timeframes[actionId] as typeof STRATEGY_TIMEFRAMES[number])) return screen("Bybit 只支持 1h、4h、1d 周期。", withBack(timeframeKeyboardFor(exchange)));
      await transitionConversation(update.userId, dependencies, { timeframe: timeframes[actionId], step: "METHOD" }, { expectedStep: "TIMEFRAME" });
      return screen("已选择周期。请选择策略类型。", withBack(methodKeyboard));
    }
    if (actionId === "tf_other_01") {
      if (exchangeOf(session) === "BYBIT") return screen("Bybit 只支持 1h、4h、1d 周期。", withBack(timeframeKeyboardFor("BYBIT")));
      await transitionConversation(update.userId, dependencies, { step: "TIMEFRAME_CUSTOM" }, { expectedStep: "TIMEFRAME" });
      return screen("请输入其他 Binance K 线周期。", cancelAndBackKeyboard);
    }
    if (actionId === "method_ma_01") {
      await transitionConversation(update.userId, dependencies, { method: "MA", step: "MA_KIND" }, { expectedStep: "METHOD" });
      return screen("请选择均线类型。", withBack(maKindKeyboard));
    }
    if (actionId === "method_horizontal_01") {
      await transitionConversation(update.userId, dependencies, { method: "HORIZONTAL", step: "PARAMETERS" }, { expectedStep: "METHOD" });
      return screen("关键位策略暂需在网站端配置，请返回选择均线策略。", withBack(methodKeyboard));
    }
    if (actionId === "ma_sma_01" || actionId === "ma_ema_01") {
      await transitionConversation(update.userId, dependencies, { maKind: actionId === "ma_sma_01" ? "SMA" : "EMA", step: "MA_LENGTH" }, { expectedStep: "MA_KIND" });
      return screen("请选择均线长度。", withBack(maLengthKeyboard));
    }
    const maLengths: Record<string, number> = { ma_len_30_01: 30, ma_len_60_01: 60, ma_len_90_01: 90, ma_len_200_01: 200 };
    if (maLengths[actionId] !== undefined) {
      await transitionConversation(update.userId, dependencies, { maLength: maLengths[actionId], step: "ATR_LENGTH" }, { expectedStep: "MA_LENGTH" });
      return screen("均线长度已记录。ATR 周期固定使用默认值14。", withBack(atrLengthKeyboard));
    }
    if (actionId === "ma_len_other_01") {
      await transitionConversation(update.userId, dependencies, { step: "MA_LENGTH_CUSTOM" }, { expectedStep: "MA_LENGTH" });
      return screen("请输入均线长度（不小于2的整数）。", cancelAndBackKeyboard);
    }
    if (actionId === "atr_14_01") {
      await transitionConversation(update.userId, dependencies, { atrLength: 14, step: "ATR_MULTIPLIER" }, { expectedStep: "ATR_LENGTH" });
      return screen("请选择 ATR 倍数。支持小于1的倍数。", withBack(atrMultiplierKeyboard));
    }
    const multipliers: Record<string, number> = { mult_0_1_01: 0.1, mult_0_5_01: 0.5, mult_1_01: 1, mult_1_5_01: 1.5, mult_2_01: 2, mult_2_5_01: 2.5, mult_5_01: 5 };
    if (multipliers[actionId] !== undefined) {
      await transitionConversation(update.userId, dependencies, { atrMultiplier: multipliers[actionId], step: "MARGIN" }, { expectedStep: "ATR_MULTIPLIER" });
      return screen("请输入总保证金（USDT）。", cancelAndBackKeyboard);
    }
    const legCounts: Record<string, number> = { legs_1_01: 1, legs_2_01: 2, legs_3_01: 3, legs_4_01: 4, legs_5_01: 5, legs_6_01: 6, legs_8_01: 8, legs_10_01: 10 };
    if (legCounts[actionId] !== undefined) {
      const current = await currentConversation(update.userId, dependencies);
      const count = legCounts[actionId];
      const multiplier = Number(current.draft.atrMultiplier ?? 1);
      const offsets = evenlySpacedAtrOffsets(count, multiplier).map((value) => `${numberText(value)} ATR`).join("、");
      const nonce = crypto.randomUUID();
      await transitionConversation(update.userId, dependencies, { legCount: count, step: "CONFIRM", confirmNonce: nonce }, { expectedStep: "LEG_COUNT" });
      const maKind = String(current.draft.maKind ?? "SMA");
      const maLength = Number(current.draft.maLength ?? 30);
      const atrLength = Number(current.draft.atrLength ?? 14);
      const totalMargin = Number(current.draft.totalMarginUsdt ?? 0);
      return screen(`均线参数已完成：${maKind}${maLength} · ATR${atrLength} · ${numberText(multiplier)} ATR\n总保证金：${numberText(totalMargin)} USDT\n${count}笔实盘限价单，区间位置：${offsets}\n默认止盈：ROI/保证金收益率达到100%卖初始仓25%，达到200%卖初始仓40%，余下仓位跟随守卫。\n动态止损：首根失效 K 线减仓50%，第二根连续失效退出剩余仓位。\n点击最终确认后才会预检查并提交实盘订单。`, liveConfirmationKeyboard);
    }
  }

  if (update.kind === "MESSAGE") {
    const command = update.text?.trim();
    if (command === QUICK_CANCEL_BUTTON) {
      await transitionConversation(update.userId, dependencies, { step: "HOME" }, { reset: true });
      return screen("已取消当前操作。", homeKeyboard);
    }
    if (command === QUICK_ORDER_BUTTON) {
      await transitionConversation(update.userId, dependencies, {
        mode: "LIVE_ARMED", quickOrder: true, maKind: "SMA", maLength: 30, atrLength: 14, atrMultiplier: 1, legCount: QUICK_DEFAULT_LEG_COUNT,
        step: "EXCHANGE", confirmNonce: null,
      }, { reset: true });
      return screen("默认快速下单前，请先选择交易所。", withBack(exchangeKeyboard));
    }
    if (command === QUICK_FULL_STRATEGY_BUTTON) {
      await transitionConversation(update.userId, dependencies, { mode: "LIVE_ARMED", homeEntry: true, step: "EXCHANGE" }, { reset: true });
      return screen("建立实盘策略前，请先选择交易所。", withBack(exchangeKeyboard));
    }
    if (command === QUICK_POSITIONS_BUTTON) {
      try {
        const getSnapshot = dependencies.getLiveAccountSnapshot ?? getLiveAccountSnapshot;
        return screen(accountText("持仓", await getSnapshot()), homeKeyboard);
      } catch { return screen("实盘持仓查询暂时不可用，请稍后重试。", homeKeyboard); }
    }
    if (command === QUICK_ORDERS_BUTTON) {
      try {
        const getSnapshot = dependencies.getLiveAccountSnapshot ?? getLiveAccountSnapshot;
        return screen(accountText("挂单", await getSnapshot()), homeKeyboard);
      } catch { return screen("实盘挂单查询暂时不可用，请稍后重试。", homeKeyboard); }
    }
    if (command === QUICK_STRATEGIES_BUTTON) {
      try {
        const liveList = dependencies.listLiveStrategies ?? listLiveStrategies;
        const protectionList = dependencies.listProtectionStrategies ?? listProtectionStrategies;
        return screen(liveStrategyText(await liveList(20), await protectionList(50)), homeKeyboard);
      } catch { return screen("实盘策略管理暂时不可用，请稍后重试。", homeKeyboard); }
    }
    if (command === QUICK_PROTECTION_BUTTON) {
      await transitionConversation(update.userId, dependencies, { homeEntry: "PROTECTION", step: "EXCHANGE", confirmNonce: null }, { reset: true });
      return screen("挂止盈止损策略前，请先选择交易所。", withBack(exchangeKeyboard));
    }
    const session = await currentConversation(update.userId, dependencies);
    if (session.step === "QUICK_SYMBOL") {
      try {
        const symbol = normalizeSymbol(update.text);
        const leverage = await readSymbolLeverage(symbol, dependencies, exchangeOf(session));
        await transitionConversation(update.userId, dependencies, {
          symbol,
          currentLeverage: leverage.leverage,
          step: "QUICK_SIDE",
        }, { expectedStep: "QUICK_SYMBOL" });
        return symbolDirectionPrompt(leverage, quickSideKeyboard);
      } catch { return screen("币种格式不正确，请输入类似 BTCUSDT 的合约代码。", cancelAndBackKeyboard); }
    }
    if (session.step === "QUICK_MARGIN_CUSTOM") {
      try {
        await transitionConversation(update.userId, dependencies, { totalMarginUsdt: normalizePositiveNumber(update.text, "总保证金"), step: "QUICK_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: "QUICK_MARGIN_CUSTOM" });
        const current = await currentConversation(update.userId, dependencies);
        return screen(quickOrderSummary(current), quickConfirmationKeyboard);
      } catch { return screen("总保证金必须是大于0的数字，请重新输入。", cancelAndBackKeyboard); }
    }
    if (session.step === "SYMBOL") {
      try {
        const symbol = normalizeSymbol(update.text);
        const leverage = await readSymbolLeverage(symbol, dependencies, exchangeOf(session));
        await transitionConversation(update.userId, dependencies, {
          symbol,
          currentLeverage: leverage.leverage,
          step: "SIDE",
        }, { expectedStep: "SYMBOL" });
        return symbolDirectionPrompt(leverage, sideKeyboard);
      } catch { return screen("币种格式不正确，请输入类似 BTCUSDT 的合约代码。", cancelAndBackKeyboard); }
    }
    if (session.step === "TIMEFRAME_CUSTOM") {
      try {
        await transitionConversation(update.userId, dependencies, { timeframe: normalizeTimeframe(update.text), step: "METHOD" }, { expectedStep: "TIMEFRAME_CUSTOM" });
        return screen("已记录周期。请选择策略类型。", withBack(methodKeyboard));
      } catch { return screen("周期不正确，请输入 Binance 支持的周期。", cancelAndBackKeyboard); }
    }
    if (session.step === "MA_LENGTH_CUSTOM") {
      try {
        await transitionConversation(update.userId, dependencies, { maLength: normalizePositiveInteger(update.text, "均线长度"), step: "ATR_LENGTH" }, { expectedStep: "MA_LENGTH_CUSTOM" });
        return screen("均线长度已记录。ATR 周期固定使用默认值14。", withBack(atrLengthKeyboard));
      } catch { return screen("均线长度必须是不小于2的整数。", cancelAndBackKeyboard); }
    }
    if (session.step === "MARGIN") {
      try {
        await transitionConversation(update.userId, dependencies, { totalMarginUsdt: normalizePositiveNumber(update.text, "总保证金"), step: "LEG_COUNT" }, { expectedStep: "MARGIN" });
        return screen("总保证金已记录。请选择分几笔下单。", withBack(legCountKeyboard));
      } catch { return screen("总保证金必须是大于0的数字，请重新输入。", cancelAndBackKeyboard); }
    }
    if (session.step === "ALEX_TP_PRICE" || session.step === "ALEX_SL_PRICE") {
      try {
        const price = normalizePositiveNumber(update.text, "触发价格");
        await transitionConversation(update.userId, dependencies, { alexFixedPrice: price, step: "ALEX_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: session.step });
        const current = await currentConversation(update.userId, dependencies);
        return screen(protectionSummary(current), renderWizardStep("ALEX_CONFIRM", current).keyboard);
      } catch { return screen("价格必须是大于0的数字，请重新输入。", cancelAndBackKeyboard); }
    }
    return screen("请按照当前步骤选择按钮或发送数值；未知指令不会创建订单。", homeKeyboard);
  }

  return screen("请选择实盘操作。", homeKeyboard);
}
