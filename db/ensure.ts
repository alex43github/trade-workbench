let initialized = false;
let paperInitialized = false;

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
