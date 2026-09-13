import { getD1 } from "@/db";
import { ensureAtrBandLifecycleSchema } from "@/db/ensure";
import { buildAtrLifecycleMarkdown, filterCompletedAtrLifecycles, normalizeAtrLifecycleExportRange } from "@/lib/radar/atr-band-export";
import { loadAtrLifecycleDashboard } from "@/lib/radar/atr-band-lifecycle-snapshot";

export async function GET(request: Request) {
  await ensureAtrBandLifecycleSchema();
  const range = normalizeAtrLifecycleExportRange(new URL(request.url).searchParams.get("range"));
  const dashboard = await loadAtrLifecycleDashboard(await getD1());
  const markdown = buildAtrLifecycleMarkdown(filterCompletedAtrLifecycles(dashboard.history, range), range);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"atr-lifecycle-history-${range}.md\"`,
      "Cache-Control": "no-store",
    },
  });
}
