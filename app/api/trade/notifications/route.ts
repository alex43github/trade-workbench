import { getD1 } from "../../../../db/index";
import { ensureAdvisorySchema } from "../../../../db/ensure";
import { notifyTradeEvent, type TradeEventKind } from "../../../../lib/notifications/bark";
import { requireOperatorMutation } from "../../../../lib/security/operator-guard";
import { isBinanceFuturesSymbol } from "../../../../lib/trade/symbols";

const OBSERVED_KINDS = new Set<TradeEventKind>(["POSITION_OPENED", "POSITION_CLOSED"]);

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const input = await request.json() as Record<string, unknown>;
    const kind = String(input.kind) as TradeEventKind;
    const source = String(input.source);
    const symbol = String(input.symbol || "").trim().toUpperCase();
    const eventId = String(input.eventId || "").trim();
    if (source !== "binance" || !OBSERVED_KINDS.has(kind) || !isBinanceFuturesSymbol(symbol) || !eventId || eventId.length > 180) {
      return Response.json({ error: "invalid observed trade event" }, { status: 400 });
    }
    await ensureAdvisorySchema();
    const notification = await notifyTradeEvent({ db: await getD1(), event: {
      source: "binance", eventId, kind, symbol,
      side: typeof input.side === "string" ? input.side : undefined,
      price: Number.isFinite(Number(input.price)) ? Number(input.price) : undefined,
      quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : undefined,
      pnl: Number.isFinite(Number(input.pnl)) ? Number(input.pnl) : undefined,
      reason: typeof input.reason === "string" ? input.reason.slice(0, 120) : undefined,
    } });
    return Response.json({ notification });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "交易提醒发送失败" }, { status: 400 });
  }
}
