const TAKER_FEE_RATE = 0.0004;
type TriggerPlan = { triggerType: "PRICE_IN_ZONE" | "CLOSE_BREAKOUT" | "CLOSE_BREAKDOWN"; entryZone: { low: number; high: number } | null; triggerPrice: number | null; validUntil: string; direction: "LONG" | "SHORT" };

export function evaluateMachineTrigger(plan: TriggerPlan, market: { previousClose: number; close: number; now: string }) {
  if (!Number.isFinite(Date.parse(plan.validUntil)) || Date.parse(market.now) > Date.parse(plan.validUntil)) return { status: "EXPIRED" as const, reason: "plan expired" };
  if (plan.triggerType === "PRICE_IN_ZONE") {
    const reached = Boolean(plan.entryZone && market.close >= plan.entryZone.low && market.close <= plan.entryZone.high);
    return reached ? { status: "TRIGGERED" as const, reason: "price entered entry zone" } : { status: "PENDING" as const, reason: "entry zone not reached" };
  }
  if (!plan.triggerPrice) return { status: "PENDING" as const, reason: "trigger price missing" };
  const crossed = plan.triggerType === "CLOSE_BREAKOUT" ? market.previousClose < plan.triggerPrice && market.close >= plan.triggerPrice : market.previousClose > plan.triggerPrice && market.close <= plan.triggerPrice;
  return crossed ? { status: "TRIGGERED" as const, reason: "closed through trigger" } : { status: "PENDING" as const, reason: "close trigger not confirmed" };
}

export function validateStopRisk(input: { direction: "LONG" | "SHORT"; entryPrice: number; stopPrice: number; quantity: number; maxLossUsdt: number }) {
  const protectiveSide = input.direction === "LONG" ? input.stopPrice < input.entryPrice : input.stopPrice > input.entryPrice;
  const distanceLoss = Math.abs(input.entryPrice - input.stopPrice) * input.quantity;
  const fees = (input.entryPrice + input.stopPrice) * input.quantity * TAKER_FEE_RATE;
  const requiredLossUsdt = distanceLoss + fees;
  return { ok: protectiveSide && Number.isFinite(requiredLossUsdt) && requiredLossUsdt <= input.maxLossUsdt, requiredLossUsdt };
}
