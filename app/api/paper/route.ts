import { getPaperSnapshot } from "../../../lib/paper";

export async function GET() {
  try {
    return Response.json(await getPaperSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模拟账户读取失败" }, { status: 503 });
  }
}
