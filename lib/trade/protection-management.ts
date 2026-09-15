import { ensureProtectionSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { assertLiveTimeframe } from "./live-exchange.ts";
import { resolveLiveExchangeAdapter, type LiveExchangeAdapter } from "./live-exchange-adapter.ts";
import { validateFixedProtectionPrice } from "./protection-math.ts";
import {
  getProtectionStrategy,
  listProtectionStrategies,
  type PersistedProtectionStrategy,
} from "./protection-strategies.ts";

type RunResult = { meta?: { changes?: number } };

function changes(result: unknown) {
  return Number((result as RunResult | undefined)?.meta?.changes ?? 0);
}

function safeStrategyId(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(text)) throw new Error("保护策略编号不正确");
  return text;
}

function safeRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("保护策略版本不正确");
  return revision;
}

function positive(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必须大于0`);
  return number;
}

function isManagedStop(strategy: PersistedProtectionStrategy) {
  return strategy.strategyType === "MA_SL" || strategy.strategyType === "LEVEL_SL";
}

function hasStopExecution(strategy: PersistedProtectionStrategy) {
  return strategy.orders.some((order) =>
    (order.stage.startsWith("MA_") || order.stage.startsWith("LEVEL_"))
    && ["RESERVED", "SUBMITTED", "UNKNOWN", "FILLED"].includes(order.status),
  );
}

function hasPendingStopExecution(strategy: PersistedProtectionStrategy) {
  return strategy.orders.some((order) =>
    (order.stage.startsWith("MA_") || order.stage.startsWith("LEVEL_"))
    && ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(order.status),
  );
}

export function managedStopStrategyCanEdit(strategy: PersistedProtectionStrategy): boolean {
  if (!isManagedStop(strategy)) return false;
  if (strategy.status !== "ACTIVE" || strategy.invalidCandleCount !== 0) return false;
  if (Math.abs(strategy.remainingQuantity - strategy.initialQuantity) > Math.max(1e-12, strategy.initialQuantity * 1e-9)) return false;
  return !hasStopExecution(strategy);
}

/**
 * User-facing stop manager keeps completed/cancelled audit history out of the
 * active list but deliberately includes partial/reconciliation states so the
 * user can see protections that still require attention.
 */
export async function listManagedStopStrategies(limit = 100): Promise<PersistedProtectionStrategy[]> {
  const strategies = await listProtectionStrategies(limit);
  return strategies.filter((strategy) =>
    isManagedStop(strategy)
    && !["DRAFT", "CANCELED", "CLOSED"].includes(strategy.status),
  );
}

export async function editManagedStopStrategy(input: {
  id: unknown;
  expectedRevision: unknown;
  timeframe?: unknown;
  fixedPrice?: unknown;
  targetQuantity?: unknown;
}): Promise<PersistedProtectionStrategy> {
  await ensureProtectionSchema();
  const id = safeStrategyId(input.id);
  const expectedRevision = safeRevision(input.expectedRevision);
  const strategy = await getProtectionStrategy(id);
  if (!strategy || !isManagedStop(strategy)) throw new Error("止损保护不存在");
  if (strategy.revision !== expectedRevision) throw new Error("保护策略版本已变化，请刷新后重试");
  if (!managedStopStrategyCanEdit(strategy)) {
    throw new Error("该止损保护已经触发或进入执行状态，不可原地修改；请停止旧策略后重新建立");
  }

  const config = { ...strategy.config };
  let changedField = false;

  if (input.timeframe !== undefined) {
    if (strategy.strategyType !== "MA_SL") throw new Error("只有均线止损可以修改周期");
    const timeframe = String(input.timeframe).trim();
    assertLiveTimeframe(strategy.exchange, timeframe);
    config.timeframe = timeframe;
    changedField = true;
  }

  if (input.fixedPrice !== undefined) {
    if (strategy.strategyType !== "LEVEL_SL") throw new Error("只有支撑阻力止损可以修改固定止损价");
    const fixedPrice = positive(input.fixedPrice, "止损价格");
    validateFixedProtectionPrice({
      side: strategy.side,
      kind: "SL",
      price: fixedPrice,
      referencePrice: strategy.entryPrice,
    });
    config.fixedPrice = fixedPrice;
    changedField = true;
  }

  let targetQuantity = strategy.initialQuantity;
  if (input.targetQuantity !== undefined) {
    targetQuantity = positive(input.targetQuantity, "保护数量");
    if (targetQuantity > strategy.initialQuantity + Math.max(1e-12, strategy.initialQuantity * 1e-9)) {
      throw new Error("不能原地扩大已绑定保护数量；如需增加覆盖，请停止旧策略后重新建立");
    }
    changedField = true;
  }

  if (!changedField) throw new Error("没有需要修改的止损保护参数");

  const db = await getD1();
  const result = await db.prepare(`UPDATE trade_protection_strategies
    SET config_json = ?, initial_quantity = ?, remaining_quantity = ?,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revision = ? AND status = 'ACTIVE' AND invalid_candle_count = 0`)
    .bind(JSON.stringify(config), String(targetQuantity), String(targetQuantity), id, expectedRevision).run();
  if (changes(result) !== 1) throw new Error("保护策略已变化，请刷新后重试");

  const updated = await getProtectionStrategy(id);
  if (!updated) throw new Error("止损保护更新后无法读取");
  return updated;
}

/**
 * Stop means stop Workbench's future protection logic. It never submits an
 * exchange market order. Completed history remains in the database.
 */
export async function stopManagedStopStrategy(input: {
  id: unknown;
  expectedRevision: unknown;
}): Promise<PersistedProtectionStrategy> {
  await ensureProtectionSchema();
  const id = safeStrategyId(input.id);
  const expectedRevision = safeRevision(input.expectedRevision);
  const strategy = await getProtectionStrategy(id);
  if (!strategy || !isManagedStop(strategy)) throw new Error("止损保护不存在");
  if (strategy.revision !== expectedRevision) throw new Error("保护策略版本已变化，请刷新后重试");
  if (strategy.status !== "ACTIVE" && strategy.status !== "PARTIALLY_PROTECTED") {
    throw new Error("当前保护状态不能直接停止，请先完成对账或等待正在执行的保护单结束");
  }
  if (hasPendingStopExecution(strategy)) {
    throw new Error("保护单仍在交易所确认中，暂不能停止，请稍后刷新");
  }

  const result = await (await getD1()).prepare(`UPDATE trade_protection_strategies
    SET status = 'CANCELED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revision = ? AND status IN ('ACTIVE','PARTIALLY_PROTECTED')`)
    .bind(id, expectedRevision).run();
  if (changes(result) !== 1) throw new Error("保护策略已变化，请刷新后重试");

  const updated = await getProtectionStrategy(id);
  if (!updated) throw new Error("止损保护停止后无法读取");
  return updated;
}

export async function readProtectionPositionQuantity(
  strategy: Pick<PersistedProtectionStrategy, "exchange" | "symbol" | "side">,
  dependencies: { adapter?: LiveExchangeAdapter } = {},
): Promise<number | null> {
  try {
    const adapter = dependencies.adapter ?? resolveLiveExchangeAdapter(strategy.exchange);
    const positions = await adapter.position(strategy.symbol);
    let total = 0;
    for (const position of positions) {
      const amount = Number(position.positionAmt);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const positionSide = String(position.positionSide ?? "BOTH").toUpperCase();
      const direction = positionSide === "LONG" || positionSide === "SHORT"
        ? positionSide
        : amount > 0 ? "LONG" : "SHORT";
      if (direction === strategy.side) total += Math.abs(amount);
    }
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}
