export type HorizontalStopTrigger = "BELOW" | "ABOVE";

export type HorizontalStopLine = {
  price: number;
  trigger: HorizontalStopTrigger;
};

export function normalizeHorizontalStopLine(value: unknown): HorizontalStopLine | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const price = Number(source.price);
  const trigger = source.trigger === "BELOW" || source.trigger === "ABOVE" ? source.trigger : null;
  if (!Number.isFinite(price) || price <= 0 || !trigger) return null;
  return { price, trigger };
}

export function horizontalStopLineInstruction(line: HorizontalStopLine): string {
  return `用户人工水平止损线 ${line.price}；收盘${line.trigger === "BELOW" ? "跌破" : "涨破"}该价格时，按用户指令进入全部止损复核。`;
}
