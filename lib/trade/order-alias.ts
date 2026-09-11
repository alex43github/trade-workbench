import { ensureStrategyLedgerSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import { isBinanceFuturesSymbol } from "./symbols.ts";

type Row = Record<string, unknown>;
type RunResult = { meta?: { changes?: number } };

export type ManualOrderAliasInput = {
  externalOrderId: string;
  clientOrderId?: string;
  symbol: string;
};

function safeIdentifier(value: unknown, message: string) {
  const identifier = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:._/-]{1,200}$/.test(identifier)) throw new Error(message);
  return identifier;
}

function safeSymbol(value: unknown) {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol)) throw new Error("币安订单交易对不正确");
  return symbol;
}

function changes(result: unknown) {
  return Number((result as RunResult | undefined)?.meta?.changes ?? 0);
}

async function nextAliasSequence() {
  const db = await getD1();
  await db.prepare("INSERT OR IGNORE INTO trade_strategy_sequences (name, value) VALUES ('alex-order', 0)").run();
  const row = await db.prepare("UPDATE trade_strategy_sequences SET value = value + 1 WHERE name = 'alex-order' RETURNING value").first<Row>();
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("手动订单编号生成失败");
  return value;
}

function alias(value: number) {
  return `ios${String(value).padStart(4, "0")}`;
}

export async function getOrCreateManualOrderAlias(input: ManualOrderAliasInput) {
  const externalOrderId = safeIdentifier(input.externalOrderId, "币安订单编号不正确");
  const clientOrderId = input.clientOrderId ? safeIdentifier(input.clientOrderId, "币安客户订单编号不正确") : null;
  const symbol = safeSymbol(input.symbol);
  await ensureStrategyLedgerSchema();
  const db = await getD1();
  const existing = await db.prepare(`SELECT alias FROM trade_order_aliases
    WHERE (source = 'ALEX' AND external_order_id = ?)
       OR (? IS NOT NULL AND source = 'ALEX' AND client_order_id = ?)
    LIMIT 1`).bind(externalOrderId, clientOrderId, clientOrderId).first<Row>();
  if (existing?.alias) return String(existing.alias);

  const nextAlias = alias(await nextAliasSequence());
  try {
    const result = await db.prepare(`INSERT INTO trade_order_aliases
      (alias, source, external_order_id, client_order_id, symbol)
      VALUES (?, 'ALEX', ?, ?, ?)`).bind(nextAlias, externalOrderId, clientOrderId, symbol).run();
    if (changes(result) !== 1) throw new Error("手动订单编号保存失败");
    return nextAlias;
  } catch (error) {
    const replay = await db.prepare(`SELECT alias FROM trade_order_aliases
      WHERE (source = 'ALEX' AND external_order_id = ?)
         OR (? IS NOT NULL AND source = 'ALEX' AND client_order_id = ?)
      LIMIT 1`).bind(externalOrderId, clientOrderId, clientOrderId).first<Row>();
    if (replay?.alias) return String(replay.alias);
    throw error;
  }
}
