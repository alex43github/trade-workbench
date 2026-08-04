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
