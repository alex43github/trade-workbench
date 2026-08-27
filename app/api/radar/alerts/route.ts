import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { GET as getRadar } from "../route";
import { shouldSendCrowdingAlert } from "@/lib/radar/alerts";
import { requireScheduler } from "@/lib/security/operator-guard";

type Coin = { symbol: string; displayName: string; shortCallRatio: number; change4h: number; oi1h: number; shortCrowding?: { score: number; level: string; evidence: string[] } };

export async function POST(request: Request) {
  if (!requireScheduler(request)) return Response.json({ error: "unauthorized", realOrderRouteEnabled: false }, { status: 401 });
  await ensureAdvisorySchema();
  const db = await getD1();
  const radar = await (await getRadar()).json() as { mode?: string; shortCrowding?: Coin[] };
  if (radar.mode !== "live") return Response.json({ sent: 0, skipped: "live Square coverage required", realOrderRouteEnabled: false });
  const outcomes = [];
  for (const coin of radar.shortCrowding ?? []) {
    const current = coin.shortCrowding;
    if (!current) continue;
    const key = `crowding_alert:${coin.symbol}`;
    const stored = await db.prepare("SELECT value FROM advisory_settings WHERE key = ? LIMIT 1").bind(key).first<{ value: string }>();
    const previous = stored ? JSON.parse(stored.value) as { score: number; level: string; sentAt: string } : null;
    const decision = shouldSendCrowdingAlert(previous, current, Date.now());
    if (!decision.send) { outcomes.push({ symbol: coin.symbol, status: "SKIPPED", reason: decision.reason }); continue; }
    if (!process.env.BARK_BASE_URL) { outcomes.push({ symbol: coin.symbol, status: "SKIPPED", reason: "Bark is not configured" }); continue; }
    const title = `${coin.displayName} 空头扛单 ${current.score}分`;
    const body = `强烈建议立即研究，不代表直接买入。\n广场看空 ${coin.shortCallRatio.toFixed(0)}% · 4H ${coin.change4h >= 0 ? "+" : ""}${coin.change4h.toFixed(1)}% · OI 1H ${coin.oi1h >= 0 ? "+" : ""}${coin.oi1h.toFixed(1)}%\n${current.evidence.slice(0, 2).join("；")}`;
    try {
      const url = `${process.env.BARK_BASE_URL.replace(/\/$/, "")}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Bark ${response.status}`);
      const value = JSON.stringify({ score: current.score, level: current.level, sentAt: new Date().toISOString() });
      await db.prepare(`INSERT INTO advisory_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(key, value).run();
      outcomes.push({ symbol: coin.symbol, status: "SENT", reason: decision.reason });
    } catch (error) {
      await db.prepare(`INSERT INTO notification_deliveries (id, channel, dedupe_key, status, attempts, error, payload_json)
        VALUES (?, 'bark', ?, 'FAILED', 1, ?, ?)
        ON CONFLICT(dedupe_key) DO UPDATE SET status = 'FAILED', attempts = attempts + 1, error = excluded.error, payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(), `crowding:${coin.symbol}:${current.level}:${current.score}`, error instanceof Error ? error.message : "Bark failed", JSON.stringify({ title, body })).run();
      outcomes.push({ symbol: coin.symbol, status: "FAILED" });
    }
  }
  return Response.json({ sent: outcomes.filter((item) => item.status === "SENT").length, outcomes, realOrderRouteEnabled: false });
}
