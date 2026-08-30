/** Preserve the exact text while a user is editing a numeric input. */
export function keepNumberDraft(value: string) {
  return value;
}

/** Convert a completed numeric draft at submit/validation time. */
export function parseNumberDraft(value: string): number | undefined {
  const text = value.trim();
  if (!text || text === "." || text === "-" || text === "-.") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
