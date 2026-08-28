import crypto from "node:crypto";
import { applyConversationInput, newConversation, parseCallback, type TelegramConversation } from "./contracts.ts";
import { consumeConfirmation, loadConversation, saveConversation } from "./store.ts";
import { getLiveAccountSnapshot } from "../trade/live-account.ts";
import { STRATEGY_TIMEFRAMES } from "../trade/strategy-contracts.ts";
import { listLiveStrategies, type LiveStrategy } from "../trade/live-strategies.ts";
import { submitLiveStrategy, type LiveStrategySubmitDependencies } from "../trade/live-submit.ts";
import type { LiveStrategyDraft } from "../trade/live-contracts.ts";
import { getAlexManualPositions, type AlexPositionsResult } from "../trade/alex-positions.ts";
import { createProtectionStrategy, listProtectionStrategies, type PersistedProtectionStrategy, type ProtectionCreateInput } from "../trade/protection-strategies.ts";
import type { ProtectionPosition, ProtectionStrategyType } from "../trade/protection-contracts.ts";
import { isBinanceFuturesSymbol, normalizeBinanceFuturesSymbol } from "../trade/symbols.ts";

export type TelegramReply = {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
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
  submitLiveStrategy?: typeof submitLiveStrategy;
  liveStrategyDependencies?: LiveStrategySubmitDependencies;
  listLiveStrategies?: typeof listLiveStrategies;
  getAlexManualPositions?: typeof getAlexManualPositions;
  createProtectionStrategy?: typeof createProtectionStrategy;
  listProtectionStrategies?: typeof listProtectionStrategies;
};

const homeKeyboard = [
  [
    { text: "建立实盘策略", callback_data: "tg:act:home_new_live_01" },
    { text: "实盘持仓", callback_data: "tg:act:home_live_positions_01" },
  ],
  [
    { text: "实盘挂单", callback_data: "tg:act:home_live_orders_01" },
    { text: "实盘策略管理", callback_data: "tg:act:home_live_strategies_01" },
  ],
  [{ text: "挂止盈止损策略单", callback_data: "tg:act:home_protection_01" }],
];

const sideKeyboard = [
  [{ text: "做多", callback_data: "tg:act:side_long_01" }],
  [{ text: "做空", callback_data: "tg:act:side_short_01" }],
];

const timeframeKeyboard = [
  [{ text: "5分钟", callback_data: "tg:act:tf_5m_01" }],
  [{ text: "15分钟", callback_data: "tg:act:tf_15m_01" }],
  [{ text: "1小时", callback_data: "tg:act:tf_1h_01" }],
  [{ text: "4小时", callback_data: "tg:act:tf_4h_01" }],
  [{ text: "1天", callback_data: "tg:act:tf_1d_01" }],
  [{ text: "1周", callback_data: "tg:act:tf_1w_01" }],
  [{ text: "其他", callback_data: "tg:act:tf_other_01" }],
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
  [{ text: "3（默认）", callback_data: "tg:act:legs_3_01" }],
  [{ text: "4", callback_data: "tg:act:legs_4_01" }],
  [{ text: "6", callback_data: "tg:act:legs_6_01" }],
  [{ text: "8", callback_data: "tg:act:legs_8_01" }],
  [{ text: "10", callback_data: "tg:act:legs_10_01" }],
];

const protectionKindKeyboard = [
  [{ text: "止盈策略", callback_data: "tg:act:alex_kind_tp_01" }],
  [{ text: "止损策略", callback_data: "tg:act:alex_kind_sl_01" }],
];

const takeProfitKeyboard = [
  [{ text: "默认止盈", callback_data: "tg:act:alex_tp_default_01" }],
  [{ text: "固定点位止盈", callback_data: "tg:act:alex_tp_fixed_01" }],
];

const stopLossKeyboard = [
  [{ text: "均线止损", callback_data: "tg:act:alex_sl_ma_01" }],
  [{ text: "支撑阻力线止损", callback_data: "tg:act:alex_sl_level_01" }],
];

const protectionTimeframeKeyboard = [
  [{ text: "5分钟", callback_data: "tg:act:alex_tf_5m_01" }],
  [{ text: "15分钟", callback_data: "tg:act:alex_tf_15m_01" }],
  [{ text: "1小时（默认）", callback_data: "tg:act:alex_tf_1h_01" }],
  [{ text: "4小时", callback_data: "tg:act:alex_tf_4h_01" }],
  [{ text: "1天", callback_data: "tg:act:alex_tf_1d_01" }],
];

const cancelKeyboard = [[{ text: "取消", callback_data: "tg:act:cancel_01" }]];
const backKeyboard = [[{ text: "返回上一级", callback_data: "tg:act:back_001" }]];
type TelegramKeyboard = TelegramReply["replyMarkup"]["inline_keyboard"];

function withBack(keyboard: TelegramKeyboard): TelegramKeyboard {
  return [...keyboard, ...backKeyboard];
}

const cancelAndBackKeyboard = withBack(cancelKeyboard);
const liveConfirmationKeyboard = withBack([[{ text: "确认建立实盘策略", callback_data: "tg:act:confirm_live_01" }], ...cancelKeyboard]);
const homeOnlyKeyboard = [[{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]];

function screen(text: string, replyMarkup = homeKeyboard): TelegramReply {
  return { text, replyMarkup: { inline_keyboard: replyMarkup }, tradeRequested: false };
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
    return `实盘持仓\n${snapshot.positions.map((item) => `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · 数量 ${item.quantity} · 未实现 ${item.unrealizedPnl.toFixed(2)} USDT`).join("\n")}`;
  }
  if (!snapshot.orders.length) return "实盘挂单\n当前没有挂单。";
  return `实盘挂单\n${snapshot.orders.map((item) => `${item.websiteOrderId} · ${item.symbol} · ${item.side === "BUY" ? "买入" : "卖出"} · ${item.type} · ${item.quantity} @ ${item.price || item.stopPrice}`).join("\n")}`;
}

function previousStep(session: TelegramConversation): TelegramConversation["step"] | null {
  if (session.step === "SYMBOL" && session.draft.homeEntry === true) return "HOME";
  if (session.step === "ALEX_CONFIRM") {
    const type = session.draft.alexStrategyType;
    if (type === "DEFAULT_TP" || type === "FIXED_TP") return type === "FIXED_TP" ? "ALEX_TP_PRICE" : "ALEX_TP_MODE";
    if (type === "MA_SL") return "ALEX_SL_TIMEFRAME";
    return "ALEX_SL_PRICE";
  }
  const previous: Partial<Record<TelegramConversation["step"], TelegramConversation["step"]>> = {
    SYMBOL: "HOME", SIDE: "SYMBOL", TIMEFRAME: "SIDE", TIMEFRAME_CUSTOM: "TIMEFRAME", METHOD: "TIMEFRAME",
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
    case "SYMBOL": return { text: "建立实盘策略。请输入币种，例如 BTCUSDT 或 BTCUSDC。", keyboard: cancelAndBackKeyboard };
    case "SIDE": return { text: "已记录币种。请选择做多还是做空。", keyboard: withBack(sideKeyboard) };
    case "TIMEFRAME": return { text: "请选择参与周期，默认是1小时。", keyboard: withBack(timeframeKeyboard) };
    case "TIMEFRAME_CUSTOM": return { text: "请输入 Binance 支持的 K 线周期，例如 3m、30m、2h、6h、12h、3d 或 1M。", keyboard: cancelAndBackKeyboard };
    case "METHOD": return { text: "请选择均线策略或关键位策略。", keyboard: withBack(methodKeyboard) };
    case "MA_KIND": return { text: "请选择均线类型。", keyboard: withBack(maKindKeyboard) };
    case "MA_LENGTH": return { text: `已选择${draft.maKind === "EMA" ? "EMA" : "SMA"}。请选择均线长度。`, keyboard: withBack(maLengthKeyboard) };
    case "MA_LENGTH_CUSTOM": return { text: "请输入均线长度（不小于2的整数）。", keyboard: cancelAndBackKeyboard };
    case "ATR_LENGTH": return { text: "均线长度已记录。ATR 周期固定使用默认值14。", keyboard: withBack(atrLengthKeyboard) };
    case "ATR_MULTIPLIER": return { text: "请选择均线上下方的 ATR 倍数。支持小于1的倍数。", keyboard: withBack(atrMultiplierKeyboard) };
    case "MARGIN": return { text: "请输入总保证金（USDT），例如 100。", keyboard: cancelAndBackKeyboard };
    case "LEG_COUNT": return { text: "请选择分几笔下单（默认3笔）。", keyboard: withBack(legCountKeyboard) };
    case "PARAMETERS": return { text: "关键位策略暂需在网站端配置，请返回选择均线策略。", keyboard: withBack(methodKeyboard) };
    case "ALEX_ASSET": return { text: "请选择要挂止盈止损的币安手动持仓。", keyboard: alexCandidateKeyboard(session) };
    case "ALEX_KIND": return { text: "请选择要挂止盈还是止损策略。", keyboard: withBack(protectionKindKeyboard) };
    case "ALEX_TP_MODE": return { text: "请选择止盈方式。默认止盈按 ROI/保证金收益率执行：100% 卖初始仓25%，200% 卖初始仓40%。", keyboard: withBack(takeProfitKeyboard) };
    case "ALEX_TP_PRICE": return { text: "请输入固定止盈触发价格。", keyboard: cancelAndBackKeyboard };
    case "ALEX_SL_MODE": return { text: "请选择止损方式。", keyboard: withBack(stopLossKeyboard) };
    case "ALEX_SL_TIMEFRAME": return { text: "请选择均线止损使用的 K 线周期。", keyboard: withBack(protectionTimeframeKeyboard) };
    case "ALEX_SL_PRICE": return { text: "请输入支撑阻力线触发价格。", keyboard: cancelAndBackKeyboard };
    case "ALEX_CONFIRM": return { text: protectionSummary(session), keyboard: withBack([[{ text: "确认挂策略单", callback_data: "tg:act:confirm_protection_01" }], ...cancelKeyboard]) };
    default: return { text: "请选择当前步骤。", keyboard: homeKeyboard };
  }
}

function liveStrategyDraft(session: TelegramConversation): LiveStrategyDraft & { atr: { length: number; multiplier: number } } {
  const draft = session.draft;
  const symbol = String(draft.symbol ?? "").trim().toUpperCase();
  const side = draft.side === "LONG" || draft.side === "SHORT" ? draft.side : null;
  const timeframe = String(draft.timeframe ?? "");
  const maKind = draft.maKind === "SMA" || draft.maKind === "EMA" ? draft.maKind : null;
  const maLength = Number(draft.maLength);
  const atrLength = Number(draft.atrLength);
  const atrMultiplier = Number(draft.atrMultiplier);
  const totalMarginUsdt = Number(draft.totalMarginUsdt);
  const legCount = Number(draft.legCount);
  if (!isBinanceFuturesSymbol(symbol) || !side || !STRATEGY_TIMEFRAMES.includes(timeframe as typeof STRATEGY_TIMEFRAMES[number])
    || !maKind || !Number.isSafeInteger(maLength) || maLength < 2 || !Number.isSafeInteger(atrLength) || atrLength < 1
    || !Number.isFinite(atrMultiplier) || atrMultiplier <= 0 || !Number.isFinite(totalMarginUsdt) || totalMarginUsdt <= 0
    || !Number.isSafeInteger(legCount) || legCount < 1 || legCount > 10) throw new Error("实盘策略参数不完整，入场单数量必须是1到10笔");
  return {
    symbol, side, timeframe, style: "MA", mode: "LIVE_ARMED", totalMarginUsdt,
    ma: { kind: maKind, length: maLength }, atr: { length: atrLength, multiplier: atrMultiplier },
    legs: evenlySpacedAtrOffsets(legCount, atrMultiplier).map((atrOffset) => ({ atrOffset })),
    execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
    dynamicGuard: { atrMultiplier }, firstGuardExitPct: 50, useDefaultProfitTargets: true,
  };
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
    return `入场策略 ${strategy.id} · ${strategy.config.symbol} · ${strategy.config.side === "LONG" ? "做多" : "做空"} · ${strategy.status}\n有效至 ${strategy.expiresAt}\n${orders}`;
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

function alexCandidateKeyboard(session: TelegramConversation): TelegramKeyboard {
  return withBack(alexCandidates(session).map((item, index) => [{
    text: `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · 数量 ${numberText(item.quantity)} · ${item.sourceOrderIds[0]}`,
    callback_data: `tg:act:alex_asset_${index}_01`,
  }]));
}

function alexCandidateText(session: TelegramConversation) {
  const rows = alexCandidates(session).map((item) => `${item.symbol} · ${item.side === "LONG" ? "做多" : "做空"} · 数量 ${numberText(item.quantity)} · 来源 ${item.sourceOrderIds[0]}`);
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
        ? `均线止损：SMA30 + ATR14 + 1 ATR，周期 ${session.draft.alexTimeframe ?? "1h"}；首根失效 K 线减仓50%，第二根连续失效退出。`
        : `支撑阻力线止损：${session.draft.alexFixedPrice}`;
  return `请确认保护策略\n${candidate.symbol} · ${candidate.side === "LONG" ? "做多" : "做空"} · 当前来源数量 ${numberText(candidate.quantity)}\n来源订单：${candidate.sourceOrderIds[0]}\n${detail}\n点击确认后才会向 Binance 提交 reduce-only 实盘保护单。`;
}

function protectionText(result: Awaited<ReturnType<typeof createProtectionStrategy>>) {
  const strategy = result.strategy;
  const rows = strategy.orders.length
    ? strategy.orders.map((order) => `${order.clientOrderId} · ${order.status}${order.exchangeOrderId ? ` · Binance ${order.exchangeOrderId}` : ""}`).join("\n")
    : "该策略由后台均线监控，不立即创建原生触发单。";
  return `保护策略 ${strategy.id}：${result.ok ? "已提交" : "未全部受理，需要对账"}\n来源 ${strategy.sourceOrderId} · ${strategy.symbol}\n${rows}${result.error ? `\n${result.error}` : ""}`;
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
      await transitionConversation(update.userId, dependencies, { mode: "LIVE_ARMED", homeEntry: true, step: "SYMBOL" }, { reset: true });
      return screen("建立实盘策略。请输入币种，例如 BTCUSDT 或 BTCUSDC。", cancelAndBackKeyboard);
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
      try {
        const findPositions = dependencies.getAlexManualPositions ?? getAlexManualPositions;
        const result: AlexPositionsResult = await findPositions();
        if (!result.connected) return screen(`币安手动持仓查询未连接：${result.reason ?? "未知原因"}。`, homeKeyboard);
        if (!result.positions.length) return screen("当前没有可挂保护策略的币安手动持仓。", homeKeyboard);
        await transitionConversation(update.userId, dependencies, { alexCandidates: result.positions, step: "ALEX_ASSET", confirmNonce: null }, { reset: true });
        const session = await currentConversation(update.userId, dependencies);
        return screen(alexCandidateText(session), alexCandidateKeyboard(session));
      } catch (error) { return screen(`币安手动持仓查询失败：${error instanceof Error ? error.message : "未知错误"}`, homeKeyboard); }
    }

    if (actionId.startsWith("alex_asset_") && actionId.endsWith("_01")) {
      const index = Number(actionId.slice("alex_asset_".length, -3));
      const session = await currentConversation(update.userId, dependencies);
      const candidate = alexCandidates(session)[index];
      if (!candidate || session.step !== "ALEX_ASSET") return screen("持仓候选已失效，请重新打开保护策略入口。", homeOnlyKeyboard);
      await transitionConversation(update.userId, dependencies, { alexSelectedCandidateId: candidate.candidateId, step: "ALEX_KIND" }, { expectedStep: "ALEX_ASSET" });
      return screen("请选择要挂止盈还是止损策略。", withBack(protectionKindKeyboard));
    }

    const session = await currentConversation(update.userId, dependencies);
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
      return screen("请选择均线止损使用的 K 线周期。", withBack(protectionTimeframeKeyboard));
    }
    if (actionId === "alex_sl_level_01") {
      await transitionConversation(update.userId, dependencies, { alexStrategyType: "LEVEL_SL", step: "ALEX_SL_PRICE", confirmNonce: null }, { expectedStep: "ALEX_SL_MODE" });
      return screen("请输入支撑阻力线触发价格。", cancelAndBackKeyboard);
    }
    const alexTimeframes: Record<string, string> = { alex_tf_5m_01: "5m", alex_tf_15m_01: "15m", alex_tf_1h_01: "1h", alex_tf_4h_01: "4h", alex_tf_1d_01: "1d" };
    if (alexTimeframes[actionId]) {
      await transitionConversation(update.userId, dependencies, { alexTimeframe: alexTimeframes[actionId], step: "ALEX_CONFIRM", confirmNonce: crypto.randomUUID() }, { expectedStep: "ALEX_SL_TIMEFRAME" });
      const current = await currentConversation(update.userId, dependencies);
      return screen(protectionSummary(current), renderWizardStep("ALEX_CONFIRM", current).keyboard);
    }

    if (actionId === "confirm_protection_01") {
      const load = dependencies.loadConversation ?? loadConversation;
      const current = await load(update.userId);
      const candidate = current ? selectedAlexCandidate(current) : null;
      const type = current?.draft.alexStrategyType;
      if (!current || current.step !== "ALEX_CONFIRM" || !current.confirmNonce || !candidate || !["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"].includes(String(type))) {
        return screen("当前保护策略确认已失效，请重新选择持仓和策略。", homeOnlyKeyboard);
      }
      const nonce = current.confirmNonce;
      const consume = dependencies.consumeConfirmation ?? consumeConfirmation;
      if (!await consume(update.userId, nonce)) return screen("该保护策略确认已经使用或已过期，没有重复提交。", homeOnlyKeyboard);
      try {
        const create = dependencies.createProtectionStrategy ?? createProtectionStrategy;
        const input: ProtectionCreateInput = {
          origin: "ALEX", source: candidate, strategyType: type as ProtectionStrategyType,
          ...(current.draft.alexFixedPrice === undefined ? {} : { fixedPrice: Number(current.draft.alexFixedPrice) }),
          ...(current.draft.alexTimeframe === undefined ? {} : { timeframe: String(current.draft.alexTimeframe) }),
          idempotencyKey: `telegram:alex:${update.userId}:${nonce}`,
        };
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

    if (actionId === "side_long_01" || actionId === "side_short_01") {
      await transitionConversation(update.userId, dependencies, { side: actionId === "side_long_01" ? "LONG" : "SHORT", step: "TIMEFRAME" }, { expectedStep: "SIDE" });
      return screen("已记录方向。请选择参与周期。", withBack(timeframeKeyboard));
    }
    const timeframes: Record<string, string> = { tf_5m_01: "5m", tf_15m_01: "15m", tf_1h_01: "1h", tf_4h_01: "4h", tf_1d_01: "1d", tf_1w_01: "1w" };
    if (timeframes[actionId]) {
      await transitionConversation(update.userId, dependencies, { timeframe: timeframes[actionId], step: "METHOD" }, { expectedStep: "TIMEFRAME" });
      return screen("已选择周期。请选择策略类型。", withBack(methodKeyboard));
    }
    if (actionId === "tf_other_01") {
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
    const legCounts: Record<string, number> = { legs_1_01: 1, legs_2_01: 2, legs_3_01: 3, legs_4_01: 4, legs_6_01: 6, legs_8_01: 8, legs_10_01: 10 };
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
    const session = await currentConversation(update.userId, dependencies);
    if (session.step === "SYMBOL") {
      try {
        await transitionConversation(update.userId, dependencies, { symbol: normalizeSymbol(update.text), step: "SIDE" }, { expectedStep: "SYMBOL" });
        return screen("已记录币种。请选择做多还是做空。", withBack(sideKeyboard));
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
