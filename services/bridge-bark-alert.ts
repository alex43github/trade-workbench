type BridgeAlertInput = {
  action: unknown;
  event_id: unknown;
  symbol: unknown;
  alert_type: unknown;
  title: unknown;
  body: unknown;
  priority: unknown;
  timestamp: unknown;
  model_version: unknown;
};

type BarkMessage = { key: string; title: string; body: string; group: string };
type BarkSender = { sendOnce(message: BarkMessage): Promise<unknown> };

const alertTypes = new Set(["SCAN_SIGNAL", "MODEL_ALERT", "RISK_ALERT", "SYSTEM_ALERT"]);
const priorities = new Map([["low", "低"], ["normal", "普通"], ["high", "高"], ["critical", "紧急"]]);

function text(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!sanitized || sanitized.length > maximum) throw new Error(`${field} is invalid`);
  return sanitized;
}

export function parseBridgeBarkAlert(input: BridgeAlertInput): BarkMessage {
  if (input.action !== "BARK_ALERT") throw new Error("action must be BARK_ALERT");
  const eventId = text(input.event_id, "event_id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(eventId)) throw new Error("event_id is invalid");
  const symbol = text(input.symbol, "symbol", 20).toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) throw new Error("symbol is invalid");
  const alertType = text(input.alert_type, "alert_type", 32);
  if (!alertTypes.has(alertType)) throw new Error("alert_type is invalid");
  const priority = text(input.priority, "priority", 16);
  const priorityLabel = priorities.get(priority);
  if (!priorityLabel) throw new Error("priority is invalid");
  const timestamp = text(input.timestamp, "timestamp", 40);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("timestamp is invalid");
  const title = text(input.title, "title", 120);
  const body = text(input.body, "body", 1_000);
  const modelVersion = text(input.model_version, "model_version", 80);

  return {
    key: `bridge:${eventId}`,
    title: `[${priorityLabel}] ${symbol} · ${title}`,
    body: `${body}\n类型：${alertType} · 优先级：${priorityLabel} · 时间：${timestamp} · 模型：${modelVersion}`,
    group: "Trade Workbench Bridge",
  };
}

export async function routeBridgeBarkAlert(input: BridgeAlertInput, options: { dryRun?: boolean; sender?: BarkSender } = {}) {
  const message = parseBridgeBarkAlert(input);
  if (options.dryRun) return { status: "DRY_RUN" as const, key: message.key, deduplicated: false };
  if (!options.sender) throw new Error("Bark sender is required outside dry-run mode");
  return options.sender.sendOnce(message);
}
