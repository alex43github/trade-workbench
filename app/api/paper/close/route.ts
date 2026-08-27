import { closePaperPosition } from "../../../../lib/paper";
import { getD1 } from "../../../../db/index";
import { ensureAdvisorySchema } from "../../../../db/ensure";
import { notifyTradeEvent } from "../../../../lib/notifications/bark";
import { requireOperatorMutation } from "../../../../lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const payload = await request.json();
    const close = await closePaperPosition(payload);
    let notification: unknown = { status: "SKIPPED" };
    try {
      await ensureAdvisorySchema();
      const reason = String(close.reason || "MANUAL_CLOSE");
      const kind = reason.startsWith("STOP_") ? "STOP_LOSS" : reason.startsWith("TAKE_PROFIT_") ? "TAKE_PROFIT" : "SELL";
      notification = await notifyTradeEvent({ db: await getD1(), event: {
        source: "paper", eventId: close.tradeId, kind, symbol: close.symbol, side: close.positionSide,
        price: close.price, quantity: close.quantity, pnl: close.realizedPnl, reason,
      } });
    } catch { /* Bark must never block a paper close response. */ }
    return Response.json({ close, notification });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟平仓失败" }, { status: 400 });
  }
}
