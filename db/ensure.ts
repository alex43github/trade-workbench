let initialized = false;

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
