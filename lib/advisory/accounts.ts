import { MAX_LEVERAGE } from "./config.ts";

export type AccountActionInput = { action: "OPEN" | "HOLD" | "CLOSE" | "REDUCE"; leverage: number; marginUsdt: number; maxLossUsdt: number };
export type AccountState = { cashBalance: number; usedMargin: number; status: string };

export function validateAccountAction(action: AccountActionInput, account: AccountState, marketMode: "live" | "demo" | "partial") {
  const reasons: string[] = [];
  if (marketMode !== "live") reasons.push("formal account requires live complete market data");
  if (account.status !== "ACTIVE" && action.action === "OPEN") reasons.push("account is not active");
  if (!Number.isInteger(action.leverage) || action.leverage < 1 || action.leverage > MAX_LEVERAGE) reasons.push("leverage must be an integer from 1 to 10");
  if (!Number.isFinite(action.marginUsdt) || action.marginUsdt < 0) reasons.push("margin must be non-negative");
  if (!Number.isFinite(action.maxLossUsdt) || action.maxLossUsdt < 0) reasons.push("max loss must be non-negative");
  const available = Math.max(0, account.cashBalance - account.usedMargin);
  if (action.action === "OPEN" && action.marginUsdt > available) reasons.push("insufficient isolated margin");
  if (action.action === "OPEN" && action.marginUsdt <= 0) reasons.push("open action requires positive margin");
  return reasons.length ? { ok: false as const, reasons } : { ok: true as const, availableMargin: available };
}

