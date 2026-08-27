import { getPaperSnapshot } from "../../../lib/paper";
import { requireOperator } from "../../../lib/security/operator-guard";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    return Response.json(await getPaperSnapshot({
      symbol: url.searchParams.get("symbol"),
      quotedPrice: url.searchParams.get("quotedPrice"),
      quoteMode: url.searchParams.get("quoteMode"),
      closedCandle: {
        id: url.searchParams.get("closedCandleId"),
        isNewClosedCandle: url.searchParams.get("closedCandleIsNew") === "true",
        close: url.searchParams.get("closedCandleClose"),
        ma: url.searchParams.get("closedCandleMa"),
        atr: url.searchParams.get("closedCandleAtr"),
        tickSize: url.searchParams.get("closedCandleTickSize"),
        stepSize: url.searchParams.get("closedCandleStepSize"),
        timeframe: url.searchParams.get("closedCandleTimeframe"),
        maKind: url.searchParams.get("closedCandleMaKind"),
        maLength: url.searchParams.get("closedCandleMaLength"),
        atrLength: url.searchParams.get("closedCandleAtrLength"),
      },
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟账户读取失败" }, { status: 503 });
  }
}
