import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { loadLatestCompositeSnapshot, type CompositeSnapshot } from "@/lib/radar/composite-ranking";

function pendingSnapshot(): CompositeSnapshot {
  const now = new Date().toISOString();
  return {
    status: "pending",
    generatedAt: now,
    scannedAt: now,
    candidates: [],
    warnings: ["综合榜尚未生成，请等待北京时间 08:00 维护扫描"],
    realOrderRouteEnabled: false,
  };
}

export async function GET() {
  await ensureAdvisorySchema();
  const snapshot = await loadLatestCompositeSnapshot(await getD1());
  return Response.json(snapshot ?? pendingSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
