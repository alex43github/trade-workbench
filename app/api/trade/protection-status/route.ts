import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/security/operator-guard";
import { listProtectionStrategies } from "@/lib/trade/protection-strategies";

const ACTIVE_STATUSES = new Set(["DRAFT", "ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"]);

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const quantities = new Map<string, { symbol: string; side: "LONG" | "SHORT"; protectedQuantity: number }>();
    for (const strategy of await listProtectionStrategies(100)) {
      if (!ACTIVE_STATUSES.has(strategy.status) || !Number.isFinite(strategy.remainingQuantity) || strategy.remainingQuantity <= 0) continue;
      const key = `${strategy.symbol}:${strategy.side}`;
      const current = quantities.get(key) ?? { symbol: strategy.symbol, side: strategy.side, protectedQuantity: 0 };
      current.protectedQuantity += strategy.remainingQuantity;
      quantities.set(key, current);
    }
    return NextResponse.json({ protections: [...quantities.values()] }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ protections: [] }, { headers: { "cache-control": "no-store" } });
  }
}
