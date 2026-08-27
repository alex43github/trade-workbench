import { cancelConditionalOrder, createConditionalOrder, listConditionalOrders } from "../../../../lib/trade/conditional-orders";
import { requireOperator, requireOperatorMutation } from "../../../../lib/security/operator-guard";

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") || 20);
    return Response.json({ orders: await listConditionalOrders(limit) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "等待单读取失败", orders: [] }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const input = await request.json() as Record<string, unknown>;
    const order = await createConditionalOrder({
      symbol: input.symbol, side: input.side, intent: input.intent, timeframe: input.timeframe,
      triggerPrice: input.triggerPrice, currentPrice: input.currentPrice, orderCount: input.orderCount,
      marginPerOrder: input.marginPerOrder, splitStop: input.splitStop, plan: input.plan,
    });
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "等待单保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const input = await request.json() as { id?: unknown };
    const order = await cancelConditionalOrder(input.id);
    if (!order) return Response.json({ error: "等待单不存在" }, { status: 404 });
    return Response.json({ order });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "等待单取消失败" }, { status: 400 });
  }
}
