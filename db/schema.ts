import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const experts = sqliteTable("experts", {
  id: text("id").primaryKey(), name: text("name").notNull(), role: text("role").notNull(),
  skillVersion: text("skill_version").notNull(), enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const strategyVersions = sqliteTable("strategy_versions", {
  id: text("id").primaryKey(), expertId: text("expert_id").notNull(), version: text("version").notNull(),
  status: text("status").notNull(), summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_strategy_versions_expert_created").on(table.expertId, table.createdAt)]);

export const marketSnapshots = sqliteTable("market_snapshots", {
  id: text("id").primaryKey(), symbol: text("symbol").notNull(), snapshotHash: text("snapshot_hash").notNull(),
  sourceMode: text("source_mode").notNull(), quality: text("quality").notNull(), lastClosedAt: text("last_closed_at").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_market_snapshots_symbol_created").on(table.symbol, table.createdAt)]);

export const consultations = sqliteTable("consultations", {
  id: text("id").primaryKey(), analysisDate: text("analysis_date").notNull(), symbol: text("symbol").notNull(),
  status: text("status").notNull(), marketSnapshotId: text("market_snapshot_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  failuresJson: text("failures_json").notNull().default("[]"), completedAt: text("completed_at"),
}, (table) => [index("idx_consultations_date_symbol").on(table.analysisDate, table.symbol)]);

export const expertOpinions = sqliteTable("expert_opinions", {
  id: text("id").primaryKey(), consultationId: text("consultation_id").notNull(), expertId: text("expert_id").notNull(),
  round: text("round").notNull(), direction: text("direction").notNull(), skillVersion: text("skill_version").notNull(),
  decisionJson: text("decision_json").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_expert_opinions_consultation_round").on(table.consultationId, table.round)]);

export const consensusDecisions = sqliteTable("consensus_decisions", {
  id: text("id").primaryKey(), consultationId: text("consultation_id").notNull().unique(),
  direction: text("direction").notNull(), strength: text("strength").notNull(),
  pushEligible: integer("push_eligible").notNull().default(0), stateVersion: integer("state_version").notNull().default(1),
  payloadJson: text("payload_json").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const expertAccounts = sqliteTable("expert_accounts", {
  id: text("id").primaryKey(), expertId: text("expert_id").notNull(), seasonId: text("season_id").notNull(),
  initialBalance: real("initial_balance").notNull().default(500), cashBalance: real("cash_balance").notNull().default(500),
  realizedPnl: real("realized_pnl").notNull().default(0), totalFees: real("total_fees").notNull().default(0),
  maxLeverage: integer("max_leverage").notNull().default(10), status: text("status").notNull().default("ACTIVE"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_expert_accounts_expert_season").on(table.expertId, table.seasonId)]);

export const expertPositions = sqliteTable("expert_positions", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), consultationId: text("consultation_id"),
  strategyVersionId: text("strategy_version_id").notNull(), symbol: text("symbol").notNull(), side: text("side").notNull(),
  quantity: real("quantity").notNull(), entryPrice: real("entry_price").notNull(), leverage: integer("leverage").notNull(),
  isolatedMargin: real("isolated_margin").notNull(), stopPrice: real("stop_price"), targetPrice: real("target_price"),
  openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_expert_positions_account_symbol").on(table.accountId, table.symbol)]);

export const expertOrders = sqliteTable("expert_orders", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), consultationId: text("consultation_id"),
  symbol: text("symbol").notNull(), side: text("side").notNull(), intent: text("intent").notNull(), type: text("type").notNull(),
  triggerPrice: real("trigger_price"), quantity: real("quantity").notNull(), status: text("status").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), filledAt: text("filled_at"),
}, (table) => [
  index("idx_expert_orders_account_status").on(table.accountId, table.status),
  uniqueIndex("uq_expert_orders_account_consultation").on(table.accountId, table.consultationId),
]);

export const expertTrades = sqliteTable("expert_trades", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), orderId: text("order_id").notNull(), symbol: text("symbol").notNull(),
  price: real("price").notNull(), quantity: real("quantity").notNull(), fee: real("fee").notNull().default(0),
  realizedPnl: real("realized_pnl").notNull().default(0), reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_expert_trades_account_created").on(table.accountId, table.createdAt)]);

export const expertEquitySnapshots = sqliteTable("expert_equity_snapshots", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), recordedAt: integer("recorded_at").notNull(), equity: real("equity").notNull(),
}, (table) => [index("idx_expert_equity_account_recorded").on(table.accountId, table.recordedAt)]);

export const reviewTasks = sqliteTable("review_tasks", {
  id: text("id").primaryKey(), consultationId: text("consultation_id"), tradeId: text("trade_id"), reviewType: text("review_type").notNull(),
  status: text("status").notNull(), dueAt: text("due_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_review_tasks_status_due").on(table.status, table.dueAt)]);

export const reviewReports = sqliteTable("review_reports", {
  id: text("id").primaryKey(), taskId: text("task_id").notNull(), expertId: text("expert_id").notNull(),
  judgmentScore: integer("judgment_score").notNull(), executionScore: integer("execution_score").notNull(), outcomeScore: integer("outcome_score").notNull(),
  attributionJson: text("attribution_json").notNull().default("[]"), candidateExperienceJson: text("candidate_experience_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_review_reports_expert_created").on(table.expertId, table.createdAt)]);

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(), channel: text("channel").notNull(), dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull(), attempts: integer("attempts").notNull().default(0), error: text("error"), payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pendingPaperPlans = sqliteTable("pending_paper_plans", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), consultationId: text("consultation_id").notNull(),
  expertId: text("expert_id").notNull(), symbol: text("symbol").notNull(), status: text("status").notNull().default("PENDING"),
  validUntil: text("valid_until").notNull(), decisionJson: text("decision_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_pending_plans_account_consultation").on(table.accountId, table.consultationId),
  index("idx_pending_plans_status_symbol").on(table.status, table.symbol),
]);

export const jobRuns = sqliteTable("job_runs", {
  id: text("id").primaryKey(), jobType: text("job_type").notNull(), idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull(), stage: text("stage").notNull(), leaseToken: text("lease_token"), error: text("error"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text("completed_at"),
});

export const advisorySettings = sqliteTable("advisory_settings", {
  key: text("key").primaryKey(), value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const systemAlerts = sqliteTable("system_alerts", {
  id: text("id").primaryKey(), type: text("type").notNull(), severity: text("severity").notNull(),
  status: text("status").notNull().default("OPEN"), title: text("title").notNull(), message: text("message").notNull(),
  contextJson: text("context_json").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [index("idx_system_alerts_status_created").on(table.status, table.createdAt)]);
