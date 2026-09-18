function numberText(value: unknown, digits = 6): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function cBlock(title: string, rows: readonly any[]): string[] {
  return [
    title,
    ...(rows.length
      ? rows.map((row, index) => [
          "Rank " + (index + 1),
          "Symbol " + String(row.symbol),
          "Slope20 " + numberText(row.slope20),
          "Streak " + String(row.cCount ?? row.count ?? row.streak ?? 0),
          "ExtensionATR " + numberText(row.extensionAtr, 3),
        ].join(" | "))
      : ["无"]),
  ];
}

function dBlock(title: string, rows: readonly any[]): string[] {
  return [
    title,
    ...(rows.length
      ? rows.map((row, index) => [
          "Rank " + (index + 1),
          "Symbol " + String(row.symbol),
          "Direction " + String(row.direction),
          "Slope20 " + numberText(row.slope20 ?? row.metric?.slope20),
        ].join(" | "))
      : ["无"]),
  ];
}

export function buildCBarkBody(
  c5: readonly any[],
  c3: readonly any[],
  c1: readonly any[],
): string {
  return [
    ...cBlock("C5 Top10", c5.slice(0, 10)),
    "",
    ...cBlock("C3 Top10", c3.slice(0, 10)),
    "",
    ...cBlock("C1 Top10", c1.slice(0, 10)),
  ].join("\n");
}

export function buildDBarkBody(
  dLong: readonly any[],
  dShort: readonly any[],
): string {
  return [
    ...dBlock("D-LONG Top10", dLong.slice(0, 10)),
    "",
    ...dBlock("D-SHORT Top10", dShort.slice(0, 10)),
  ].join("\n");
}
