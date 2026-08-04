import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureTradeKnowledgeSchema } from "../../../db/ensure";
import { tradeKnowledge } from "../../../db/schema";

const KNOWLEDGE_VERSION = "street-brother-template-v0.1";

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).slice(0, 30) : [];
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJson(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalized(row: typeof tradeKnowledge.$inferSelect) {
  return {
    ...row,
    strengths: parseJson(row.strengthsJson, []),
    mistakes: parseJson(row.mistakesJson, []),
    plan: parseJson(row.planJson, {}),
    evidence: parseJson(row.evidenceJson, {}),
    sourceRefs: parseJson(row.sourceRefsJson, []),
  };
}

export async function GET(request: Request) {
  try {
    await ensureTradeKnowledgeSchema();
    const db = await getDb();
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol")?.trim().toUpperCase();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 30)));
    const rows = symbol
      ? await db.select().from(tradeKnowledge).where(eq(tradeKnowledge.symbol, symbol)).orderBy(desc(tradeKnowledge.createdAt)).limit(limit)
      : await db.select().from(tradeKnowledge).orderBy(desc(tradeKnowledge.createdAt)).limit(limit);
    return Response.json({ records: rows.map(normalized), knowledgeVersion: KNOWLEDGE_VERSION });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "交易知识库读取失败", records: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureTradeKnowledgeSchema();
    const payload = await request.json() as Record<string, unknown>;
    const symbol = String(payload.symbol || "").trim().toUpperCase();
    const side = String(payload.side || "LONG").toUpperCase();
    const phase = String(payload.phase || "pretrade");
    if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return Response.json({ error: "symbol is required" }, { status: 400 });
    if (!["LONG", "SHORT"].includes(side)) return Response.json({ error: "invalid side" }, { status: 400 });
    if (!["pretrade", "closed"].includes(phase)) return Response.json({ error: "invalid phase" }, { status: 400 });

    const values = {
      id: crypto.randomUUID(), symbol, side, phase,
      status: String(payload.status || (phase === "closed" ? "closed" : "draft")).slice(0, 20),
      score: Math.round(Math.max(0, Math.min(100, Number(payload.score) || 0))),
      outcome: payload.outcome ? String(payload.outcome).slice(0, 30) : null,
      pnl: payload.pnl === null || payload.pnl === undefined ? null : Number(payload.pnl),
      title: String(payload.title || `${symbol} ${phase === "closed" ? "退出复盘" : "交易前评分"}`).slice(0, 120),
      summary: String(payload.summary || "").slice(0, 3000),
      strengthsJson: JSON.stringify(asArray(payload.strengths)), mistakesJson: JSON.stringify(asArray(payload.mistakes)),
      planJson: JSON.stringify(asObject(payload.plan)), evidenceJson: JSON.stringify(asObject(payload.evidence)),
      sourceRefsJson: JSON.stringify(asArray(payload.sourceRefs)), knowledgeVersion: KNOWLEDGE_VERSION,
      updatedAt: new Date().toISOString(),
    };
    const db = await getDb();
    const [record] = await db.insert(tradeKnowledge).values(values).returning();
    return Response.json({ record: normalized(record) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "交易知识库写入失败" }, { status: 500 });
  }
}
