export type AsterOiResponse = { symbol?: string; openInterest?: number | string; openInterestValue?: number | string };
export type AsterOiSnapshot = { symbol: string; openInterest: number; capturedAt: string };
export type AsterOiObservation = {
  symbol: string; openInterest: number; changePct: number | null; status: "live" | "pending"; reference: "ASTER";
};

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildAsterOiObservation(
  current: AsterOiResponse,
  previous: AsterOiSnapshot | null,
): AsterOiObservation {
  const openInterest = asNumber(current.openInterestValue ?? current.openInterest);
  const symbol = String(current.symbol ?? "").toUpperCase();
  if (!symbol || openInterest === null || openInterest <= 0) throw new Error("invalid aster open interest");
  const changePct = previous && previous.openInterest > 0 ? Number((((openInterest - previous.openInterest) / previous.openInterest) * 100).toFixed(2)) : null;
  return { symbol, openInterest, changePct, status: changePct === null ? "pending" : "live", reference: "ASTER" };
}

export function asterOiEndpoint(symbol: string, baseUrl = "https://fapi.asterdex.com") {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${baseUrl.replace(/\/$/, "")}/fapi/v1/openInterest?symbol=${encodeURIComponent(normalized)}`;
}
