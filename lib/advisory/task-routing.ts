import type { CompatibleTarget } from "./model-gateway.ts";

export type AiTaskKind = "market_scan" | "expert_consultation" | "risk_review";

const MODEL_ORDER: Record<AiTaskKind, readonly string[]> = {
  market_scan: ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  expert_consultation: ["gpt-5.6-terra", "gpt-5.6-sol", "deepseek-v4-flash", "gpt-5.6-luna"],
  risk_review: ["gpt-5.6-sol", "gpt-5.6-terra", "deepseek-v4-flash", "gpt-5.6-luna"],
};

export function defaultTaskRoute(task: AiTaskKind) {
  return [...MODEL_ORDER[task]];
}

export function routeTargets(task: AiTaskKind, targets: readonly CompatibleTarget[]) {
  const priorities = MODEL_ORDER[task];
  return targets
    .map((target, index) => ({ target, index, priority: priorities.indexOf(target.model) }))
    .sort((left, right) => {
      const leftPriority = left.priority < 0 ? Number.MAX_SAFE_INTEGER : left.priority;
      const rightPriority = right.priority < 0 ? Number.MAX_SAFE_INTEGER : right.priority;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map((item) => item.target);
}

export function taskRouteSummary(targets: readonly CompatibleTarget[]) {
  return (Object.keys(MODEL_ORDER) as AiTaskKind[]).map((task) => ({
    task,
    models: routeTargets(task, targets).map((target) => ({ id: target.id, name: target.name, model: target.model })),
  }));
}
