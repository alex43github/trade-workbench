import { requireOperator } from "../../../../../lib/security/operator-guard.ts";
import { complete, filters, groups, response } from "../query.ts";
export async function GET(request: Request) { const denied = await requireOperator(request); if (denied) return denied; try { const input = filters(new URL(request.url).searchParams); const items = (await groups(input)).filter((item)=>input.includeUncertain || complete(item)).map((item)=>({ ...item.group, metrics: item.metrics })); return response({ items, filters: input }); } catch { return response({ error: "复盘查询参数不正确" }, 400); } }
