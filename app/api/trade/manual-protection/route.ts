import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireOperator, requireOperatorMutation } from "@/lib/security/operator-guard";
import { STRATEGY_TIMEFRAMES } from "@/lib/trade/strategy-contracts";
import { assertLiveTimeframe, normalizeLiveExchange, type LiveExchange } from "@/lib/trade/live-exchange";
import { getAlexManualPositions } from "@/lib/trade/alex-positions";
import { createProtectionStrategy } from "@/lib/trade/protection-strategies";
import type { ProtectionStrategyType } from "@/lib/trade/protection-contracts";
import { isBinanceFuturesSymbol } from "@/lib/trade/symbols";

const PROTECTION_TYPES = new Set<ProtectionStrategyType>(["DEFAULT_TP", "FIXED_TP", "MA_SL", "LEVEL_SL"]);

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

function requestSelection(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase() ?? "";
  const side = params.get("side")?.trim().toUpperCase() ?? "";
  if (symbol && !isBinanceFuturesSymbol(symbol)) throw new Error("合约代码无效");
  if (side && side !== "LONG" && side !== "SHORT") throw new Error("持仓方向无效");
  const exchange = normalizeLiveExchange(params.get("exchange") ?? undefined);
  return { symbol, side: side as "LONG" | "SHORT" | "", exchange };
}

function positiveNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须大于0`);
  return parsed;
}

export async function GET(request: Request) {
  const denied = await requireOperator(request);
  if (denied) return denied;
  try {
    const selection = requestSelection(request);
    const result = await getAlexManualPositions({ exchange: selection.exchange });
    const positions = result.positions.filter((item) =>
      (!selection.symbol || item.symbol === selection.symbol) && (!selection.side || item.side === selection.side));
    return NextResponse.json({ ...result, positions }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "手动持仓查询失败", 400);
  }
}

export async function POST(request: Request) {
  const denied = await requireOperatorMutation(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return errorResponse("请求格式无效"); }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  const side = typeof body.side === "string" ? body.side.trim().toUpperCase() : "";
  const strategyTypeValue = typeof body.strategyType === "string" ? body.strategyType : "";
  const strategyType = strategyTypeValue as ProtectionStrategyType;
  let exchange: LiveExchange;
  try { exchange = normalizeLiveExchange(body.exchange); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : "交易所无效"); }
  if (!isBinanceFuturesSymbol(symbol)) return errorResponse("合约代码无效");
  if (side !== "LONG" && side !== "SHORT") return errorResponse("持仓方向无效");
  if (!PROTECTION_TYPES.has(strategyType)) return errorResponse("保护策略类型不正确");
  if (body.confirmation !== "CONFIRM_MANUAL_PROTECTION") return errorResponse("请先完成手动保护策略二次确认");
  const timeframe = body.timeframe === undefined ? undefined : String(body.timeframe);
  if (timeframe !== undefined && !STRATEGY_TIMEFRAMES.includes(timeframe as typeof STRATEGY_TIMEFRAMES[number])) return errorResponse("保护策略周期不正确");
  try { if (strategyType === "MA_SL") assertLiveTimeframe(exchange, timeframe ?? ""); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : "保护策略周期不正确"); }

  let fixedPrice: number | undefined;
  if (strategyType === "FIXED_TP" || strategyType === "LEVEL_SL") {
    try { fixedPrice = positiveNumber(body.fixedPrice, "保护价格"); }
    catch (error) { return errorResponse(error instanceof Error ? error.message : "保护价格无效"); }
  }

  try {
    const positionsResult = await getAlexManualPositions({ exchange });
    if (!positionsResult.connected) return errorResponse(positionsResult.reason ?? `${exchange} 手动持仓查询失败`, 503);
    const source = positionsResult.positions.find((item) => item.symbol === symbol && item.side === side);
    if (!source) return errorResponse("当前未找到该币种对应的手动持仓，请刷新后重试", 409);
    if (source.reconciliationRequired) return errorResponse("手动持仓来源无法与当前仓位安全对账，暂不能挂保护策略", 409);
    const suppliedKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const idempotencyKey = /^[A-Za-z0-9:_-]{8,200}$/.test(suppliedKey)
      ? suppliedKey
      : `web:manual-protection:${crypto.randomUUID()}`;
    const submission = await createProtectionStrategy({
      exchange,
      origin: "ALEX",
      source,
      strategyType,
      ...(fixedPrice === undefined ? {} : { fixedPrice }),
      ...(timeframe === undefined ? {} : { timeframe }),
      idempotencyKey,
    });
    return NextResponse.json(submission, { status: submission.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "手动保护策略提交失败";
    return errorResponse(message, /持仓|保护|来源|交易所|数量|价格/.test(message) ? 409 : 502);
  }
}
