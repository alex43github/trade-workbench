import { CORE_SYMBOLS } from "./config.ts";
import { createD1DeliveryStore, sendBarkOnce } from "./notifications.ts";
import type { ModelProviderError } from "./model-gateway.ts";

type AlertRow = { id?: string; context_json: string };

export function providerAlertKey(provider: string, code: string, at = new Date().toISOString()) {
  return `provider:${provider}:${code}:${at.slice(0, 10)}`;
}

export function resumableSymbolsFromAlerts(rows: AlertRow[]) {
  const supported = new Set<string>(CORE_SYMBOLS);
  const symbols = new Set<string>();
  for (const row of rows) {
    try {
      const value = JSON.parse(row.context_json) as { symbol?: unknown };
      if (typeof value.symbol === "string" && supported.has(value.symbol)) symbols.add(value.symbol);
    } catch { /* malformed legacy alert is not resumable */ }
  }
  return [...symbols];
}

export async function recordProviderFailureAlert(db: D1Database, input: { error: ModelProviderError; symbol: string; jobKey?: string; analysisDate?: string }) {
  const now = new Date().toISOString();
  const key = providerAlertKey(input.error.provider, input.error.code, now);
  const context = { provider: input.error.provider, code: input.error.code, symbol: input.symbol, jobKey: input.jobKey, analysisDate: input.analysisDate };
  await db.prepare(`INSERT INTO system_alerts (id, type, severity, title, message, context_json)
    VALUES (?, 'MODEL_PROVIDER', 'HIGH', '模型供应商需要手动切换', ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'OPEN', message = excluded.message,
      context_json = excluded.context_json, resolved_at = NULL`)
    .bind(`alert:${key}:${input.symbol}`, input.error.message, JSON.stringify(context)).run();
  const title = `AI 会诊已暂停·${input.error.provider}`;
  const body = `${input.symbol.replace("USDT", "")} 遇到 ${input.error.code}。请在设置页手动切换全局模型，再点击继续暂停会诊。系统不会自动换模型，不会真实下单。`;
  return sendBarkOnce({ key, title, body, barkBaseUrl: process.env.BARK_BASE_URL, store: createD1DeliveryStore(db) });
}

export async function loadOpenProviderAlerts(db: D1Database) {
  const rows = await db.prepare(`SELECT id, title, message, context_json, created_at FROM system_alerts
    WHERE type = 'MODEL_PROVIDER' AND status = 'OPEN' ORDER BY created_at DESC LIMIT 20`)
    .all<{ id: string; title: string; message: string; context_json: string; created_at: string }>();
  return rows.results;
}

export async function resolveProviderAlerts(db: D1Database, symbols: string[]) {
  for (const symbol of symbols) {
    await db.prepare(`UPDATE system_alerts SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
      WHERE type = 'MODEL_PROVIDER' AND status = 'OPEN' AND json_extract(context_json, '$.symbol') = ?`)
      .bind(symbol).run();
  }
}
