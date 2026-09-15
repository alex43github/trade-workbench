import { newConversation, type TelegramConversation } from "./contracts.ts";
import type { TelegramReplyMarkup } from "./client.ts";
import {
  handleAuthorizedTelegramUpdate as handleLegacyTelegramUpdate,
  type TelegramHandlerDependencies,
  type TelegramReply,
} from "./handler.ts";
import { loadConversation, saveConversation } from "./store.ts";
import type { PersistedProtectionStrategy } from "../trade/protection-strategies.ts";
import {
  editManagedStopStrategy,
  listManagedStopStrategies,
  managedStopStrategyCanEdit,
  readProtectionPositionQuantity,
  stopManagedStopStrategy,
} from "../trade/protection-management.ts";

export type TelegramHandlerV2Dependencies = TelegramHandlerDependencies & {
  listManagedStopStrategies?: typeof listManagedStopStrategies;
  editManagedStopStrategy?: typeof editManagedStopStrategy;
  stopManagedStopStrategy?: typeof stopManagedStopStrategy;
  readProtectionPositionQuantity?: (strategy: PersistedProtectionStrategy) => Promise<number | null>;
};

type AuthorizedUpdate = {
  updateId: number;
  kind: "MESSAGE" | "CALLBACK";
  userId: string;
  chatId: string;
  text?: string;
  callbackData?: string;
};

type PmState = {
  ids: string[];
  selectedId?: string;
  selectedRevision?: number;
  currentQuantity?: number | null;
  mode?: "DETAIL" | "LEVEL_PRICE" | "EDIT_CONFIRM" | "STOP_CONFIRM";
  pendingTimeframe?: string;
  pendingFixedPrice?: number;
  pendingTargetQuantity?: number;
};

const MANAGER_BUTTON = "🛡️ 止损保护管理";
const READ_ONLY_MENU_BUTTONS = new Set(["📊 实盘持仓", "📋 实盘挂单", "🗂️ 策略管理"]);
const ROOT_CALLBACKS = new Set([
  "home_new_live_01",
  "home_quick_order_01",
  "home_positions_01",
  "home_orders_01",
  "home_strategies_01",
  "home_alex_protection_01",
  "home_menu_01",
  "cancel_01",
]);

function screen(text: string, inline?: Array<Array<{ text: string; callback_data: string }>>): TelegramReply {
  const replyMarkup: TelegramReplyMarkup = inline
    ? { inline_keyboard: inline }
    : { keyboard: [[{ text: MANAGER_BUTTON }], [{ text: "❌ 取消/主菜单" }]], resize_keyboard: true, is_persistent: true };
  return { text, replyMarkup, tradeRequested: false };
}

function homeAugmented(reply: TelegramReply): TelegramReply {
  if (!("keyboard" in reply.replyMarkup) || !Array.isArray(reply.replyMarkup.keyboard)) return reply;
  const rows = reply.replyMarkup.keyboard.map((row) => [...row]);
  if (!rows.flat().some((button) => button.text === MANAGER_BUTTON)) {
    const protectionRow = rows.findIndex((row) => row.some((button) => button.text === "🛡️ 手动持仓保护"));
    if (protectionRow >= 0) rows.splice(protectionRow + 1, 0, [{ text: MANAGER_BUTTON }]);
    else rows.splice(Math.max(0, rows.length - 1), 0, [{ text: MANAGER_BUTTON }]);
  }
  return { ...reply, replyMarkup: { ...reply.replyMarkup, keyboard: rows } };
}

function pmState(session: TelegramConversation | null): PmState | null {
  const value = session?.draft?.pm;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.ids) || raw.ids.some((id) => typeof id !== "string")) return null;
  return raw as unknown as PmState;
}

function withPm(session: TelegramConversation, pm: PmState): TelegramConversation {
  return { ...session, step: "HOME", draft: { pm }, confirmNonce: null };
}

async function load(dependencies: TelegramHandlerV2Dependencies, userId: string) {
  return (dependencies.loadConversation ?? loadConversation)(userId);
}

async function save(
  dependencies: TelegramHandlerV2Dependencies,
  session: TelegramConversation,
) {
  return (dependencies.saveConversation ?? saveConversation)(session, session.version);
}

async function resetHome(dependencies: TelegramHandlerV2Dependencies, userId: string, draft: Record<string, unknown> = {}) {
  const current = await load(dependencies, userId);
  const base = current ?? newConversation(userId);
  const next: TelegramConversation = {
    ...base,
    step: "HOME",
    draft,
    confirmNonce: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  return save(dependencies, next);
}

function displaySymbol(symbol: string) {
  return symbol.replace(/USDT$/, "");
}

function exchangeLabel(exchange: string) {
  return exchange === "BYBIT" ? "Bybit" : "Binance";
}

function sideLabel(side: string) {
  return side === "SHORT" ? "空" : "多";
}

function timeframeLabel(value: unknown) {
  const timeframe = String(value ?? "1h");
  return ({ "15m": "15分钟", "1h": "1小时", "4h": "4小时", "1d": "1天" } as Record<string, string>)[timeframe] ?? timeframe;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: "保护中",
    PARTIALLY_PROTECTED: "已触发第一次止损",
    TRIGGERING: "正在执行",
    RECONCILIATION_REQUIRED: "需要对账",
  };
  return labels[status] ?? status;
}

function marketConfig(strategy: PersistedProtectionStrategy) {
  const raw = strategy.config.marketConfig;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const ma = source.ma && typeof source.ma === "object" && !Array.isArray(source.ma) ? source.ma as Record<string, unknown> : {};
  const atr = source.atr && typeof source.atr === "object" && !Array.isArray(source.atr) ? source.atr as Record<string, unknown> : {};
  return {
    maKind: String(ma.kind ?? "SMA").toUpperCase(),
    maLength: Number(ma.length ?? 30),
    atrLength: Number(atr.length ?? 14),
    atrMultiplier: Number(source.atrMultiplier ?? strategy.config.atrMultiplier ?? 1),
  };
}

function conditionLabel(strategy: PersistedProtectionStrategy) {
  if (strategy.strategyType === "LEVEL_SL") {
    return `${timeframeLabel(strategy.config.timeframe ?? "1h")}收盘${strategy.side === "LONG" ? "跌破" : "突破"} ${Number(strategy.config.fixedPrice).toPrecision(8).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  const config = marketConfig(strategy);
  const sign = strategy.side === "LONG" ? "-" : "+";
  const verb = strategy.side === "LONG" ? "跌破" : "突破";
  return `${timeframeLabel(strategy.config.timeframe ?? "1h")}收盘${verb} ${config.maKind}${config.maLength} ${sign} ATR${config.atrLength} ×${config.atrMultiplier}`;
}

function coverage(strategy: PersistedProtectionStrategy, currentQuantity: number | null) {
  if (!currentQuantity || !Number.isFinite(currentQuantity) || currentQuantity <= 0) return null;
  return strategy.remainingQuantity / currentQuantity * 100;
}

function qty(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未知";
  return Number(value.toPrecision(10)).toString();
}

function pct(value: number | null) {
  return value === null || !Number.isFinite(value) ? "未知" : `${value.toFixed(1)}%`;
}

async function managedStrategies(dependencies: TelegramHandlerV2Dependencies) {
  return (dependencies.listManagedStopStrategies ?? listManagedStopStrategies)();
}

async function currentQuantity(dependencies: TelegramHandlerV2Dependencies, strategy: PersistedProtectionStrategy) {
  return (dependencies.readProtectionPositionQuantity ?? readProtectionPositionQuantity)(strategy);
}

async function storePm(
  dependencies: TelegramHandlerV2Dependencies,
  userId: string,
  pm: PmState,
) {
  const current = await load(dependencies, userId);
  const base = current ?? newConversation(userId);
  return save(dependencies, withPm(base, pm));
}

async function showManagerList(dependencies: TelegramHandlerV2Dependencies, userId: string): Promise<TelegramReply> {
  const strategies = await managedStrategies(dependencies);
  const rows: string[] = [];
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const [index, strategy] of strategies.entries()) {
    const current = await currentQuantity(dependencies, strategy);
    const actualCoverage = coverage(strategy, current);
    rows.push(
      `${index + 1}. ${displaySymbol(strategy.symbol)} · ${exchangeLabel(strategy.exchange)} · ${sideLabel(strategy.side)}`,
      `保护 ${pct(actualCoverage)}（剩余绑定 ${qty(strategy.remainingQuantity)} / 当前仓位 ${qty(current)}）`,
      `条件：${conditionLabel(strategy)} · ${statusLabel(strategy.status)}`,
    );
    buttons.push([{ text: `${index + 1}. ${displaySymbol(strategy.symbol)} · ${statusLabel(strategy.status)}`, callback_data: `tg:act:pm_item_${index}_01` }]);
  }
  const pm: PmState = { ids: strategies.map((strategy) => strategy.id) };
  await resetHome(dependencies, userId, { pm });
  if (!strategies.length) return screen("当前没有正在生效的止损保护。", [[{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]]);
  buttons.push([{ text: "🔄 刷新", callback_data: "tg:act:pm_refresh_01" }]);
  buttons.push([{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]);
  return screen(`当前止损保护\n\n${rows.join("\n")}`, buttons);
}

async function selectedStrategy(
  dependencies: TelegramHandlerV2Dependencies,
  userId: string,
): Promise<{ session: TelegramConversation; pm: PmState; strategy: PersistedProtectionStrategy }> {
  const session = await load(dependencies, userId);
  const pm = pmState(session);
  if (!session || !pm?.selectedId) throw new Error("保护管理菜单已失效，请重新打开止损保护管理");
  const strategy = (await managedStrategies(dependencies)).find((item) => item.id === pm.selectedId);
  if (!strategy) throw new Error("该止损保护已变化，请刷新列表");
  return { session, pm, strategy };
}

function detailText(strategy: PersistedProtectionStrategy, current: number | null) {
  const actualCoverage = coverage(strategy, current);
  const editable = managedStopStrategyCanEdit(strategy);
  return [
    `${displaySymbol(strategy.symbol)} · ${exchangeLabel(strategy.exchange)} · ${sideLabel(strategy.side)}`,
    "",
    `当前持仓：${qty(current)}`,
    `最初绑定保护量：${qty(strategy.initialQuantity)}`,
    `当前剩余保护量：${qty(strategy.remainingQuantity)}`,
    `当前实际覆盖率：${pct(actualCoverage)}`,
    "",
    `止损条件：${conditionLabel(strategy)}`,
    `状态：${statusLabel(strategy.status)}`,
    `已确认失效次数：${strategy.invalidCandleCount}`,
    editable ? "可修改：尚未发生第一次止损执行。" : "已触发/进入执行状态：不可原地修改条件或比例；如需更换，请停止旧策略后重新建立。",
  ].join("\n");
}

function detailKeyboard(strategy: PersistedProtectionStrategy) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (managedStopStrategyCanEdit(strategy)) {
    rows.push([{ text: "✏️ 修改条件", callback_data: "tg:act:pm_edit_condition_01" }]);
    rows.push([{ text: "📐 修改保护比例", callback_data: "tg:act:pm_edit_ratio_01" }]);
  }
  if (strategy.status === "ACTIVE" || strategy.status === "PARTIALLY_PROTECTED") {
    rows.push([{ text: "🗑️ 停止保护", callback_data: "tg:act:pm_stop_01" }]);
  }
  rows.push([{ text: "↩️ 返回保护列表", callback_data: "tg:act:pm_refresh_01" }]);
  rows.push([{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]);
  return rows;
}

async function showDetail(
  dependencies: TelegramHandlerV2Dependencies,
  userId: string,
  strategy: PersistedProtectionStrategy,
  current: number | null,
): Promise<TelegramReply> {
  const session = await load(dependencies, userId) ?? newConversation(userId);
  const existing = pmState(session) ?? { ids: [strategy.id] };
  await save(dependencies, withPm(session, {
    ...existing,
    selectedId: strategy.id,
    selectedRevision: strategy.revision,
    currentQuantity: current,
    mode: "DETAIL",
    pendingTimeframe: undefined,
    pendingFixedPrice: undefined,
    pendingTargetQuantity: undefined,
  }));
  return screen(detailText(strategy, current), detailKeyboard(strategy));
}

function pmAction(data: string | undefined) {
  const match = /^tg:act:(pm_[A-Za-z0-9_]{3,55})$/.exec(String(data ?? ""));
  return match?.[1] ?? null;
}

async function handlePmCallback(
  action: string,
  update: AuthorizedUpdate,
  dependencies: TelegramHandlerV2Dependencies,
): Promise<TelegramReply> {
  if (action === "pm_refresh_01") return showManagerList(dependencies, update.userId);

  if (/^pm_item_\d+_01$/.test(action)) {
    const session = await load(dependencies, update.userId);
    const pm = pmState(session);
    const index = Number(action.match(/^pm_item_(\d+)_01$/)?.[1]);
    const id = pm?.ids[index];
    if (!session || !id) return screen("此保护管理菜单已失效，请重新打开。", [[{ text: "🔄 重新打开", callback_data: "tg:act:pm_refresh_01" }]]);
    const strategy = (await managedStrategies(dependencies)).find((item) => item.id === id);
    if (!strategy) return showManagerList(dependencies, update.userId);
    return showDetail(dependencies, update.userId, strategy, await currentQuantity(dependencies, strategy));
  }

  const { session, pm, strategy } = await selectedStrategy(dependencies, update.userId);
  const current = pm.currentQuantity ?? await currentQuantity(dependencies, strategy);

  if (action === "pm_edit_condition_01") {
    if (!managedStopStrategyCanEdit(strategy)) return screen("该保护已经触发，不能原地修改。请停止旧策略后重新建立。", detailKeyboard(strategy));
    if (strategy.strategyType === "LEVEL_SL") {
      await save(dependencies, withPm(session, { ...pm, mode: "LEVEL_PRICE" }));
      return screen(`当前条件：${conditionLabel(strategy)}\n\n请输入新的固定止损价格。\n只会修改本地闭K保护条件，不会立即向交易所下止损单。`, [[{ text: "↩️ 返回详情", callback_data: "tg:act:pm_item_0_01" }]]);
    }
    return screen(`当前条件：${conditionLabel(strategy)}\n请选择新的闭K周期：`, [
      [{ text: "15分钟", callback_data: "tg:act:pm_tf_15m_01" }],
      [{ text: "1小时", callback_data: "tg:act:pm_tf_1h_01" }],
      [{ text: "4小时", callback_data: "tg:act:pm_tf_4h_01" }],
      [{ text: "1天", callback_data: "tg:act:pm_tf_1d_01" }],
      [{ text: "↩️ 返回保护列表", callback_data: "tg:act:pm_refresh_01" }],
    ]);
  }

  if (/^pm_tf_(15m|1h|4h|1d)_01$/.test(action)) {
    if (!managedStopStrategyCanEdit(strategy) || strategy.strategyType !== "MA_SL") return screen("当前保护不能修改条件。", detailKeyboard(strategy));
    const timeframe = action.match(/^pm_tf_(15m|1h|4h|1d)_01$/)?.[1] as string;
    const old = String(strategy.config.timeframe ?? "1h");
    await save(dependencies, withPm(session, { ...pm, mode: "EDIT_CONFIRM", pendingTimeframe: timeframe, pendingFixedPrice: undefined, pendingTargetQuantity: undefined }));
    return screen(`确认修改止损条件？\n${timeframeLabel(old)} → ${timeframeLabel(timeframe)}\n\n新规则：${timeframeLabel(timeframe)}闭K后再判断 SMA30 / ATR14。`, [
      [{ text: "✅ 确认修改", callback_data: "tg:act:pm_edit_confirm_01" }],
      [{ text: "❌ 放弃", callback_data: "tg:act:pm_refresh_01" }],
    ]);
  }

  if (action === "pm_edit_ratio_01") {
    if (!managedStopStrategyCanEdit(strategy)) return screen("该保护已经触发，不能原地修改保护比例。", detailKeyboard(strategy));
    if (!current || current <= 0) return screen("当前持仓数量无法读取，暂不能修改保护比例。", detailKeyboard(strategy));
    return screen(`当前绑定保护量：${qty(strategy.initialQuantity)}\n当前持仓：${qty(current)}\n当前覆盖率：${pct(coverage(strategy, current))}\n\n请选择新的覆盖比例：`, [
      [{ text: "25%", callback_data: "tg:act:pm_ratio_25_01" }, { text: "50%", callback_data: "tg:act:pm_ratio_50_01" }],
      [{ text: "75%", callback_data: "tg:act:pm_ratio_75_01" }, { text: "100%", callback_data: "tg:act:pm_ratio_100_01" }],
      [{ text: "↩️ 返回保护列表", callback_data: "tg:act:pm_refresh_01" }],
    ]);
  }

  if (/^pm_ratio_(25|50|75|100)_01$/.test(action)) {
    if (!managedStopStrategyCanEdit(strategy) || !current || current <= 0) return screen("当前保护不能修改比例。", detailKeyboard(strategy));
    const percent = Number(action.match(/^pm_ratio_(25|50|75|100)_01$/)?.[1]);
    const target = current * percent / 100;
    if (target > strategy.initialQuantity + Math.max(1e-12, strategy.initialQuantity * 1e-9)) {
      return screen(`不能把已绑定保护从 ${qty(strategy.initialQuantity)} 原地扩大到 ${qty(target)}。\n如需增加覆盖，请停止旧策略后针对当前仓位重新建立。`, detailKeyboard(strategy));
    }
    await save(dependencies, withPm(session, { ...pm, mode: "EDIT_CONFIRM", pendingTargetQuantity: target, pendingTimeframe: undefined, pendingFixedPrice: undefined }));
    return screen(`确认修改保护比例？\n绑定保护量：${qty(strategy.initialQuantity)} → ${qty(target)}\n当前持仓：${qty(current)}\n目标覆盖率：${percent}%`, [
      [{ text: "✅ 确认修改", callback_data: "tg:act:pm_edit_confirm_01" }],
      [{ text: "❌ 放弃", callback_data: "tg:act:pm_refresh_01" }],
    ]);
  }

  if (action === "pm_edit_confirm_01") {
    if (pm.mode !== "EDIT_CONFIRM" || pm.selectedRevision === undefined) return screen("修改确认已失效，请刷新后重试。", [[{ text: "🔄 刷新", callback_data: "tg:act:pm_refresh_01" }]]);
    const edited = await (dependencies.editManagedStopStrategy ?? editManagedStopStrategy)({
      id: strategy.id,
      expectedRevision: pm.selectedRevision,
      ...(pm.pendingTimeframe ? { timeframe: pm.pendingTimeframe } : {}),
      ...(pm.pendingFixedPrice !== undefined ? { fixedPrice: pm.pendingFixedPrice } : {}),
      ...(pm.pendingTargetQuantity !== undefined ? { targetQuantity: pm.pendingTargetQuantity } : {}),
    });
    return showDetail(dependencies, update.userId, edited, await currentQuantity(dependencies, edited));
  }

  if (action === "pm_stop_01") {
    if (strategy.status !== "ACTIVE" && strategy.status !== "PARTIALLY_PROTECTED") return screen("当前状态不能直接停止，请先完成对账或等待执行结束。", detailKeyboard(strategy));
    await save(dependencies, withPm(session, { ...pm, mode: "STOP_CONFIRM", selectedRevision: strategy.revision }));
    return screen(`停止 ${displaySymbol(strategy.symbol)} 这条止损保护？\n\n这只会停止 Workbench 后续自动保护逻辑，不会立即平仓，也不会因为点击本按钮向交易所发送市价单。\n已有执行记录会保留用于审计。`, [
      [{ text: "✅ 确认停止", callback_data: "tg:act:pm_stop_confirm_01" }],
      [{ text: "❌ 放弃", callback_data: "tg:act:pm_refresh_01" }],
    ]);
  }

  if (action === "pm_stop_confirm_01") {
    if (pm.mode !== "STOP_CONFIRM" || pm.selectedRevision === undefined) return screen("停止确认已失效，请刷新后重试。", [[{ text: "🔄 刷新", callback_data: "tg:act:pm_refresh_01" }]]);
    const stopped = await (dependencies.stopManagedStopStrategy ?? stopManagedStopStrategy)({ id: strategy.id, expectedRevision: pm.selectedRevision });
    await resetHome(dependencies, update.userId);
    return screen(`${displaySymbol(stopped.symbol)} 止损保护已停止。\n不会因此立即平仓；历史保护和执行记录仍保留。`, [
      [{ text: "🛡️ 返回止损保护管理", callback_data: "tg:act:pm_refresh_01" }],
      [{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }],
    ]);
  }

  return screen("此保护管理菜单已失效，请刷新。", [[{ text: "🔄 刷新", callback_data: "tg:act:pm_refresh_01" }]]);
}

async function handleManagerPriceMessage(
  update: AuthorizedUpdate,
  dependencies: TelegramHandlerV2Dependencies,
): Promise<TelegramReply | null> {
  const session = await load(dependencies, update.userId);
  const pm = pmState(session);
  if (!session || pm?.mode !== "LEVEL_PRICE" || !pm.selectedId || pm.selectedRevision === undefined) return null;
  const strategy = (await managedStrategies(dependencies)).find((item) => item.id === pm.selectedId);
  if (!strategy || !managedStopStrategyCanEdit(strategy) || strategy.strategyType !== "LEVEL_SL") {
    return screen("该保护已经变化，不能继续修改，请刷新。", [[{ text: "🔄 刷新", callback_data: "tg:act:pm_refresh_01" }]]);
  }
  const fixedPrice = Number(String(update.text ?? "").trim());
  if (!Number.isFinite(fixedPrice) || fixedPrice <= 0) return screen("请输入大于 0 的有效止损价格。", [[{ text: "↩️ 返回保护列表", callback_data: "tg:act:pm_refresh_01" }]]);
  const old = Number(strategy.config.fixedPrice);
  await save(dependencies, withPm(session, { ...pm, mode: "EDIT_CONFIRM", pendingFixedPrice: fixedPrice, pendingTimeframe: undefined, pendingTargetQuantity: undefined }));
  return screen(`确认修改固定止损条件？\n${qty(old)} → ${qty(fixedPrice)}\n\n仍然只在所选周期 K 线收盘确认后执行，不会立即向交易所挂止损单。`, [
    [{ text: "✅ 确认修改", callback_data: "tg:act:pm_edit_confirm_01" }],
    [{ text: "❌ 放弃", callback_data: "tg:act:pm_refresh_01" }],
  ]);
}

export async function handleAuthorizedTelegramUpdate(
  update: AuthorizedUpdate,
  dependencies: TelegramHandlerV2Dependencies = {},
): Promise<TelegramReply> {
  try {
    if (update.kind === "MESSAGE" && update.text === MANAGER_BUTTON) {
      return showManagerList(dependencies, update.userId);
    }

    if (update.kind === "MESSAGE") {
      const managerPrice = await handleManagerPriceMessage(update, dependencies);
      if (managerPrice) return managerPrice;
      if (READ_ONLY_MENU_BUTTONS.has(String(update.text ?? ""))) {
        await resetHome(dependencies, update.userId);
      }
    }

    if (update.kind === "CALLBACK") {
      const action = pmAction(update.callbackData);
      if (action) return handlePmCallback(action, update, dependencies);

      const current = await load(dependencies, update.userId);
      const match = /^tg:act:([A-Za-z0-9_-]{8,64})$/.exec(String(update.callbackData ?? ""));
      if (current?.step === "HOME" && match && !ROOT_CALLBACKS.has(match[1])) {
        return screen("此菜单已失效，请从当前主菜单重新操作。", [[{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]]);
      }
    }

    return homeAugmented(await handleLegacyTelegramUpdate(update, dependencies));
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return screen(`操作未完成：${message}`, [[{ text: "🔄 刷新止损保护", callback_data: "tg:act:pm_refresh_01" }], [{ text: "返回主菜单", callback_data: "tg:act:home_menu_01" }]]);
  }
}
