import { openPaperPosition } from "../../../../lib/paper";
import { getD1 } from "../../../../db/index";
import { ensureAdvisorySchema } from "../../../../db/ensure";
import { notifyTradeEvent } from "../../../../lib/notifications/bark";
import { requireOperatorMutation } from "../../../../lib/security/operator-guard";

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const payload = await request.json();
    const order = await openPaperPosition(payload);
    let notification: unknown = { status: "SKIPPED" };
    try {
      await ensureAdvisorySchema();
      const kind = order.side === "LONG" ? "BUY" : "SELL";
      notification = await notifyTradeEvent({ db: await getD1(), event: {
        source: "paper", eventId: order.orderId, kind, symbol: order.symbol, side: order.side,
        price: order.price, quantity: order.quantity, reason: "PLAN_CONFIRMED",
      } });
    } catch { /* Bark must never block a paper order response. */ }
    return Response.json({ order, notification }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟下单失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { cancelPaperOrder } = await import("../../../../lib/paper");
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const payload = await request.json();
    return Response.json(await cancelPaperOrder(payload.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "撤销模拟订单失败" }, { status: 400 });
  }
}
