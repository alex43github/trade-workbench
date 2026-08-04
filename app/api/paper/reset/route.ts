import { resetPaperAccount } from "../../../../lib/paper";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { confirmation?: string };
    if (payload.confirmation !== "RESET_PAPER") return Response.json({ error: "缺少模拟盘重置确认" }, { status: 400 });
    return Response.json(await resetPaperAccount());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "重置模拟盘失败" }, { status: 400 });
  }
}
