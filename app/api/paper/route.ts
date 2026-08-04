import { getPaperSnapshot } from "../../../lib/paper";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await getPaperSnapshot({
      symbol: url.searchParams.get("symbol"),
      quotedPrice: url.searchParams.get("quotedPrice"),
      quoteMode: url.searchParams.get("quoteMode"),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟账户读取失败" }, { status: 503 });
  }
}
