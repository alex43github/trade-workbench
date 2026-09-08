import { ensureAdvisorySchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { runDailyAdvisoryJob } from "@/lib/advisory/daily-job";
import { loadOpenProviderAlerts, resolveProviderAlerts, resumableSymbolsFromAlerts } from "@/lib/advisory/provider-alerts";
import { requireOperatorMutation } from "@/lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  await ensureAdvisorySchema();
  const db = await getD1();
  const alerts = await loadOpenProviderAlerts(db);
  const symbols = resumableSymbolsFromAlerts(alerts);
  if (!symbols.length) return Response.json({ resumed: 0, message: "没有可继续的暂停会诊", realOrderRouteEnabled: false });
  const resumeKeys: Record<string, string> = {};
  for (const row of alerts) {
    try {
      const context = JSON.parse(row.context_json) as { symbol?: string; jobKey?: string };
      if (context.symbol && context.jobKey && !resumeKeys[context.symbol]) resumeKeys[context.symbol] = context.jobKey;
    } catch { /* ignored */ }
  }
  const result = await runDailyAdvisoryJob(db, symbols, resumeKeys);
  const completedSymbols = result.results.filter((item) => item.status === "COMPLETED").map((item) => item.symbol);
  await resolveProviderAlerts(db, completedSymbols);
  return Response.json({ ...result, resumed: completedSymbols.length, realOrderRouteEnabled: false }, { status: result.paused ? 503 : 200 });
}
