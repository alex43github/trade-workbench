import { ensureIndicatorSettingsSchema } from "../../../../db/ensure.ts";
import { getD1 } from "../../../../db/index.ts";
import { normalizeIndicatorSettings } from "../../../../lib/trade/indicator-settings.ts";
import { requireOperator, requireOperatorMutation } from "../../../../lib/security/operator-guard";

function requestedSymbol(request: Request) {
  return new URL(request.url).searchParams.get("symbol") || "";
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const symbol = requestedSymbol(request);
  if (!normalizeIndicatorSettings(symbol, {})) return Response.json({ error: "币种格式不正确" }, { status: 400 });
  try {
    await ensureIndicatorSettingsSchema();
    const row = await (await getD1()).prepare("SELECT payload_json, updated_at FROM trade_indicator_settings WHERE symbol = ? LIMIT 1").bind(symbol.toUpperCase()).first<Record<string, unknown>>();
    if (!row) return Response.json({ settings: null }, { headers: { "cache-control": "no-store" } });
    let payload: unknown = {};
    try { payload = JSON.parse(String(row.payload_json || "{}")); } catch { payload = {}; }
    return Response.json({ settings: normalizeIndicatorSettings(symbol, payload), updatedAt: row.updated_at }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "指标参数读取失败" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  try {
    const input = await request.json() as Record<string, unknown>;
    const settings = normalizeIndicatorSettings(input.symbol, input);
    if (!settings) return Response.json({ error: "币种格式不正确" }, { status: 400 });
    await ensureIndicatorSettingsSchema();
    const db = await getD1();
    await db.prepare(`INSERT INTO trade_indicator_settings (symbol, payload_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(symbol) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(settings.symbol, JSON.stringify(settings)).run();
    return Response.json({ settings }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "指标参数保存失败" }, { status: 400 });
  }
}
