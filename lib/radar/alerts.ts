type CrowdingState = { score: number; level: string };
type PreviousAlert = CrowdingState & { sentAt: string };

export function shouldSendCrowdingAlert(previous: PreviousAlert | null, current: CrowdingState, now = Date.now()) {
  if (current.score < 80 || !["HIGH_CONFIDENCE", "SQUEEZE_TRIGGER"].includes(current.level)) return { send: false, reason: "below_high_confidence" };
  if (!previous) return { send: true, reason: "first_high_confidence" };
  const insideCooldown = now - Date.parse(previous.sentAt) < 4 * 60 * 60 * 1000;
  if (!insideCooldown) return { send: true, reason: "cooldown_elapsed" };
  if (current.level === "SQUEEZE_TRIGGER" && previous.level !== "SQUEEZE_TRIGGER") return { send: true, reason: "squeeze_upgrade" };
  if (current.score - previous.score >= 8) return { send: true, reason: "score_upgrade" };
  return { send: false, reason: "cooldown" };
}
