let initialized = false;
let paperInitialized = false;
let advisoryInitialized = false;

export async function ensureTradeKnowledgeSchema() {
  if (initialized) return;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS trade_knowledge (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      outcome TEXT,
      pnl REAL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '' NOT NULL,
      strengths_json TEXT DEFAULT '[]' NOT NULL,
      mistakes_json TEXT DEFAULT '[]' NOT NULL,
      plan_json TEXT DEFAULT '{}' NOT NULL,
      evidence_json TEXT DEFAULT '{}' NOT NULL,
      source_refs_json TEXT DEFAULT '[]' NOT NULL,
      knowledge_version TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trade_knowledge_symbol_created ON trade_knowledge(symbol, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trade_knowledge_phase_created ON trade_knowledge(phase, created_at)"),
  ]);
  await env.DB.prepare("PRAGMA optimize").run();
  initialized = true;
}

export async function ensurePaperSchema() {
  if (paperInitialized) return;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paper_accounts (
      id TEXT PRIMARY KEY NOT NULL, initial_balance REAL NOT NULL, cash_balance REAL NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, total_fees REAL DEFAULT 0 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity REAL NOT NULL,
      entry_price REAL NOT NULL, leverage INTEGER DEFAULT 3 NOT NULL, entries INTEGER DEFAULT 1 NOT NULL,
      stop_price REAL, target_price REAL, strategy_score INTEGER NOT NULL,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paper_orders (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, intent TEXT NOT NULL,
      type TEXT NOT NULL, trigger_price REAL, quantity REAL NOT NULL, status TEXT NOT NULL,
      score INTEGER NOT NULL, plan_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, filled_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paper_trades (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      intent TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL, fee REAL NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, reason TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
      id TEXT PRIMARY KEY NOT NULL, recorded_at INTEGER NOT NULL, equity REAL NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_positions_symbol ON paper_positions(symbol)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_orders_status_created ON paper_orders(status, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_orders_symbol_status ON paper_orders(symbol, status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_trades_created ON paper_trades(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_created ON paper_trades(symbol, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_paper_equity_recorded ON paper_equity_snapshots(recorded_at)"),
    env.DB.prepare("INSERT OR IGNORE INTO paper_accounts (id, initial_balance, cash_balance) VALUES ('default', 10000, 10000)"),
  ]);
  await env.DB.prepare("PRAGMA optimize").run();
  paperInitialized = true;
}

export async function ensureAdvisorySchema() {
  if (advisoryInitialized) return;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS experts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      skill_version TEXT NOT NULL, enabled INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS strategy_versions (
      id TEXT PRIMARY KEY NOT NULL, expert_id TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL, summary TEXT DEFAULT '' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_snapshots (
      id TEXT PRIMARY KEY NOT NULL, symbol TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
      source_mode TEXT NOT NULL, quality TEXT NOT NULL, last_closed_at TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY NOT NULL, analysis_date TEXT NOT NULL, symbol TEXT NOT NULL,
      status TEXT NOT NULL, market_snapshot_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      failures_json TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, completed_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_opinions (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT NOT NULL, expert_id TEXT NOT NULL,
      round TEXT NOT NULL, direction TEXT NOT NULL, skill_version TEXT NOT NULL,
      decision_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS consensus_decisions (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT NOT NULL UNIQUE, direction TEXT NOT NULL,
      strength TEXT NOT NULL, push_eligible INTEGER DEFAULT 0 NOT NULL,
      state_version INTEGER DEFAULT 1 NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_accounts (
      id TEXT PRIMARY KEY NOT NULL, expert_id TEXT NOT NULL, season_id TEXT NOT NULL,
      initial_balance REAL DEFAULT 500 NOT NULL, cash_balance REAL DEFAULT 500 NOT NULL,
      realized_pnl REAL DEFAULT 0 NOT NULL, total_fees REAL DEFAULT 0 NOT NULL,
      max_leverage INTEGER DEFAULT 10 NOT NULL, status TEXT DEFAULT 'ACTIVE' NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_positions (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, consultation_id TEXT,
      strategy_version_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      quantity REAL NOT NULL, entry_price REAL NOT NULL, leverage INTEGER NOT NULL,
      isolated_margin REAL NOT NULL, stop_price REAL, target_price REAL,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_orders (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, consultation_id TEXT,
      symbol TEXT NOT NULL, side TEXT NOT NULL, intent TEXT NOT NULL, type TEXT NOT NULL,
      trigger_price REAL, quantity REAL NOT NULL, status TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, filled_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_trades (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, order_id TEXT NOT NULL,
      symbol TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL,
      fee REAL DEFAULT 0 NOT NULL, realized_pnl REAL DEFAULT 0 NOT NULL,
      reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS expert_equity_snapshots (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
      equity REAL NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS review_tasks (
      id TEXT PRIMARY KEY NOT NULL, consultation_id TEXT, trade_id TEXT, review_type TEXT NOT NULL,
      status TEXT NOT NULL, due_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, expert_id TEXT NOT NULL,
      judgment_score INTEGER NOT NULL, execution_score INTEGER NOT NULL, outcome_score INTEGER NOT NULL,
      attribution_json TEXT DEFAULT '[]' NOT NULL, candidate_experience_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY NOT NULL, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, attempts INTEGER DEFAULT 0 NOT NULL, error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY NOT NULL, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, stage TEXT NOT NULL, lease_token TEXT, error TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, completed_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS advisory_settings (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS system_alerts (
      id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN' NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
      context_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      resolved_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_consultations_date_symbol ON consultations(analysis_date, symbol)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_strategy_versions_expert_created ON strategy_versions(expert_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_market_snapshots_symbol_created ON market_snapshots(symbol, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_opinions_consultation_round ON expert_opinions(consultation_id, round)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_accounts_expert_season ON expert_accounts(expert_id, season_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_positions_account_symbol ON expert_positions(account_id, symbol)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_orders_account_status ON expert_orders(account_id, status)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_expert_orders_account_consultation ON expert_orders(account_id, consultation_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_trades_account_created ON expert_trades(account_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_expert_equity_account_recorded ON expert_equity_snapshots(account_id, recorded_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_review_tasks_status_due ON review_tasks(status, due_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_review_reports_expert_created ON review_reports(expert_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_system_alerts_status_created ON system_alerts(status, created_at)"),
  ]);
  await env.DB.prepare("PRAGMA optimize").run();
  advisoryInitialized = true;
}
