import { openPaperPosition } from "../../../../lib/paper";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    return Response.json({ order: await openPaperPosition(payload) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟下单失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { cancelPaperOrder } = await import("../../../../lib/paper");
  try {
    const payload = await request.json();
    return Response.json(await cancelPaperOrder(payload.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "撤销模拟订单失败" }, { status: 400 });
  }
}
