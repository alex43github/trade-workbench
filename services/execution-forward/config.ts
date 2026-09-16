export const EXECUTION_FORWARD_RESEARCH_FLAG = "EXECUTION_FORWARD_RESEARCH_ENABLED";
export const RECHECK_DELAY_MS = 15 * 60 * 1000;

export function isExecutionForwardResearchEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return String(env[EXECUTION_FORWARD_RESEARCH_FLAG] ?? "")
    .trim()
    .toLowerCase() === "true";
}
