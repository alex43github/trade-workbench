import type { ProtectionKind, ProtectionOrigin, ProtectionSide } from "./protection-contracts.ts";
import crypto from "node:crypto";

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于0`);
  return value;
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}不能小于0`);
  return value;
}

function roundToTick(value: number, tickSize: number) {
  positive(tickSize, "价格精度");
  return Number((Math.round(value / tickSize) * tickSize).toPrecision(15));
}

function floorToStep(value: number, stepSize: number) {
  positive(stepSize, "数量精度");
  return Number((Math.floor(value / stepSize + Number.EPSILON) * stepSize).toPrecision(15));
}

export function computeRoiTriggerPrice({
  side,
  entryPrice,
  leverage,
  roiPct,
  tickSize,
}: {
  side: ProtectionSide;
  entryPrice: number;
  leverage: number;
  roiPct: number;
  tickSize: number;
}) {
  positive(entryPrice, "入场价格");
  positive(leverage, "杠杆");
  positive(roiPct, "ROI");
  const change = roiPct / 100 / leverage;
  const raw = side === "LONG" ? entryPrice * (1 + change) : entryPrice * (1 - change);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error("ROI 触发价不可实现");
  const rounded = roundToTick(raw, tickSize);
  if (rounded <= 0 || (side === "LONG" && rounded <= entryPrice) || (side === "SHORT" && rounded >= entryPrice)) {
    throw new Error("ROI 触发价不在盈利方向");
  }
  return rounded;
}

export function sourceExitQuantity({
  initialQuantity,
  remainingQuantity,
  percent,
  stepSize,
}: {
  initialQuantity: number;
  remainingQuantity: number;
  percent: number;
  stepSize: number;
}) {
  positive(initialQuantity, "初始数量");
  positive(remainingQuantity, "剩余数量");
  positive(percent, "退出比例");
  if (percent > 100) throw new Error("退出比例不能超过100%");
  const requested = Math.min(remainingQuantity, initialQuantity * percent / 100);
  return floorToStep(requested, stepSize);
}

export function validateFixedProtectionPrice({
  side,
  kind,
  price,
  referencePrice,
}: {
  side: ProtectionSide;
  kind: Extract<ProtectionKind, "TP" | "SL">;
  price: number;
  referencePrice: number;
}) {
  positive(price, "保护价格");
  positive(referencePrice, "参考价格");
  if (kind === "TP") {
    if ((side === "LONG" && price <= referencePrice) || (side === "SHORT" && price >= referencePrice)) {
      throw new Error("固定止盈价格不在盈利方向");
    }
  } else if ((side === "LONG" && price >= referencePrice) || (side === "SHORT" && price <= referencePrice)) {
    throw new Error("支撑阻力止损价格不在止损方向");
  }
  return price;
}

export function nextProtectionClientOrderId({
  origin,
  kind,
  sequence,
}: {
  origin: ProtectionOrigin;
  kind: Extract<ProtectionKind, "TP" | "SL">;
  sequence: number;
}) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("保护单序号不正确");
  const prefix = origin === "ALEX" ? "alex" : origin === "TELEGRAM" ? "tele" : "web";
  return `${prefix}${kind}${String(sequence).padStart(8, "0")}`;
}

/** A durable strategy/stage identity, not an authorization token. */
export function stableProtectionExitClientOrderId({
  origin,
  kind,
  eventKey,
}: {
  origin: ProtectionOrigin;
  kind: Extract<ProtectionKind, "TP" | "SL">;
  eventKey: string;
}) {
  if (!/^[A-Za-z0-9:_-]{1,240}$/.test(eventKey)) throw new Error("退出事件编号不正确");
  const prefix = origin === "ALEX" ? "alex" : origin === "TELEGRAM" ? "tele" : "web";
  // Keep the historical numeric suffix: ownership classifiers already rely on it.
  const digest = BigInt(`0x${crypto.createHash("sha256").update(eventKey).digest("hex")}`);
  return `${prefix}${kind}${(digest % (10n ** 22n)).toString().padStart(22, "0")}`;
}

export function guardRemainingPercent(invalidCandleCount: number) {
  if (!Number.isSafeInteger(invalidCandleCount) || invalidCandleCount < 0) throw new Error("失效 K 线计数不正确");
  if (invalidCandleCount === 0) return 100;
  if (invalidCandleCount === 1) return 50;
  return 0;
}

export function normalizeFixedPrice(price: number, tickSize: number) {
  nonNegative(price, "保护价格");
  return roundToTick(positive(price, "保护价格"), tickSize);
}
