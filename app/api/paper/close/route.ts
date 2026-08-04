import { closePaperPosition } from "../../../../lib/paper";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    return Response.json({ close: await closePaperPosition(payload) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟平仓失败" }, { status: 400 });
  }
}
