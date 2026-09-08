type Attempt = { intent?: unknown; generation?: unknown; status?: unknown; quantity?: unknown; executedQuantity?: unknown };
type OrderOutcome = { status?: unknown; error?: unknown };

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function shouldShowHistoricalAttempt(attempt: Attempt) {
  return !(String(attempt.status ?? "").toUpperCase() === "CANCELED" && number(attempt.executedQuantity) === 0);
}

export function activeEntryQuantity(attempts: Attempt[], generation: number | null) {
  if (generation === null) return 0;
  return attempts
    .filter((attempt) => String(attempt.intent ?? "").toUpperCase() === "ENTRY" && Number(attempt.generation) === generation)
    .filter((attempt) => ["RESERVED", "SUBMITTED", "UNKNOWN"].includes(String(attempt.status ?? "").toUpperCase()))
    .reduce((total, attempt) => total + Math.max(0, number(attempt.quantity) - number(attempt.executedQuantity)), 0);
}

export function orderFailureReason(order: OrderOutcome) {
  const error = String(order.error ?? "").trim();
  if (error) return error;
  if (["REJECTED", "UNKNOWN"].includes(String(order.status ?? "").toUpperCase())) {
    return "订单状态未知，需要核对交易所结果";
  }
  return null;
}

function displayNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function strategyRiskLabel(totalMarginUsdt: unknown, leverage: unknown) {
  const margin = displayNumber(totalMarginUsdt) ?? "—";
  const leverageText = displayNumber(leverage) ?? "杠杆未记录";
  return `${margin}U × ${leverageText}`;
}
