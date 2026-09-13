import { ensureWatchlistSchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { handleFocusSourcesGet } from "@/lib/structure-radar/focus-source-api";

export async function GET(request: Request) {
  return handleFocusSourcesGet(request, {
    token: process.env.RADAR_LOCAL_TOKEN ?? "",
    getDb: getD1,
    ensure: ensureWatchlistSchema,
  });
}
