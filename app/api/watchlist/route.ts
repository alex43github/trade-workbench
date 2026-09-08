import { ensureWatchlistSchema } from "@/db/ensure";
import { getD1 } from "@/db";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";
import { addWatchlistItems, hasWatchlistHistory, listWatchlist, removeWatchlistItem } from "@/lib/watchlist";

export async function GET() {
  try {
    await ensureWatchlistSchema();
    const db = await getD1();
    return Response.json({ items: await listWatchlist(db), initialized: await hasWatchlistHistory(db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "自选读取失败" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "same-origin action required" }, { status: 403 });
  try {
    const body = await request.json() as { items?: unknown };
    await ensureWatchlistSchema();
    return Response.json({ items: await addWatchlistItems(await getD1(), body.items, "MANUAL", true), initialized: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "自选保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "same-origin action required" }, { status: 403 });
  try {
    const body = await request.json() as { symbol?: unknown };
    await ensureWatchlistSchema();
    return Response.json({ items: await removeWatchlistItem(await getD1(), body.symbol), initialized: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "自选删除失败" }, { status: 400 });
  }
}
