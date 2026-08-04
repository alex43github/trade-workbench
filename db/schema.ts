import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tradeKnowledge = sqliteTable("trade_knowledge", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  phase: text("phase").notNull(),
  status: text("status").notNull(),
  score: integer("score").notNull(),
  outcome: text("outcome"),
  pnl: real("pnl"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  strengthsJson: text("strengths_json").notNull().default("[]"),
  mistakesJson: text("mistakes_json").notNull().default("[]"),
  planJson: text("plan_json").notNull().default("{}"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  sourceRefsJson: text("source_refs_json").notNull().default("[]"),
  knowledgeVersion: text("knowledge_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_trade_knowledge_symbol_created").on(table.symbol, table.createdAt),
  index("idx_trade_knowledge_phase_created").on(table.phase, table.createdAt),
]);

export const paperAccounts = sqliteTable("paper_accounts", {
  id: text("id").primaryKey(),
  initialBalance: real("initial_balance").notNull(),
  cashBalance: real("cash_balance").notNull(),
  realizedPnl: real("realized_pnl").notNull().default(0),
  totalFees: real("total_fees").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const paperPositions = sqliteTable("paper_positions", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  entryPrice: real("entry_price").notNull(),
  leverage: integer("leverage").notNull().default(3),
  entries: integer("entries").notNull().default(1),
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  strategyScore: integer("strategy_score").notNull(),
  openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_paper_positions_symbol").on(table.symbol),
]);

export const paperOrders = sqliteTable("paper_orders", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  intent: text("intent").notNull(),
  type: text("type").notNull(),
  triggerPrice: real("trigger_price"),
  quantity: real("quantity").notNull(),
  status: text("status").notNull(),
  score: integer("score").notNull(),
  planJson: text("plan_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  filledAt: text("filled_at"),
}, (table) => [
  index("idx_paper_orders_status_created").on(table.status, table.createdAt),
  index("idx_paper_orders_symbol_status").on(table.symbol, table.status),
]);

export const paperTrades = sqliteTable("paper_trades", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  intent: text("intent").notNull(),
  price: real("price").notNull(),
  quantity: real("quantity").notNull(),
  fee: real("fee").notNull(),
  realizedPnl: real("realized_pnl").notNull().default(0),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_paper_trades_created").on(table.createdAt),
  index("idx_paper_trades_symbol_created").on(table.symbol, table.createdAt),
]);

export const paperEquitySnapshots = sqliteTable("paper_equity_snapshots", {
  id: text("id").primaryKey(),
  recordedAt: integer("recorded_at").notNull(),
  equity: real("equity").notNull(),
}, (table) => [
  index("idx_paper_equity_recorded").on(table.recordedAt),
]);
