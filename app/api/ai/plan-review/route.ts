import { getServerCredential } from "@/lib/server-credentials";
import { getD1 } from "@/db";
import { getActiveAiTarget } from "@/lib/advisory/provider-settings";
import { configuredChannels } from "@/lib/advisory/channel-config";
import { invokeStructuredModel, invokeStructuredModelWithFallback } from "@/lib/advisory/model-gateway";
import { resolveTaskTargets } from "@/lib/advisory/task-targets";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";
import { requireOperator } from "@/lib/security/operator-guard";
import { reserveAiRequest } from "@/lib/security/ai-rate-limit";

type Review = {
  action: "ALLOW_LIVE" | "REVISE" | "WAIT";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  verdict: string;
  reasons: string[];
  modifications: string[];
};

function rulesFallback(payload: Record<string, unknown>): Review {
  const score = Number(payload.score) || 0;
  const radar = payload.radar && typeof payload.radar === "object" ? payload.radar as { participation?: string; mode?: string } : {};
  const action = radar.participation === "AVOID" ? "WAIT" : score >= 70 ? "ALLOW_LIVE" : "REVISE";
  return {
    action,
    riskLevel: score >= 80 && radar.mode === "live" ? "LOW" : score >= 65 ? "MEDIUM" : "HIGH",
    verdict: action === "ALLOW_LIVE" ? "纪律条件达到实盘策略门槛，仍需由你最终确认。" : action === "WAIT" ? "市场风险闸门已触发，暂不建立实盘策略。" : "计划尚未达到实盘策略执行门槛。",
    reasons: [
      `当前纪律评分 ${score}/100`,
      radar.mode === "live" ? "市场证据为实时数据" : "市场证据并非完整实时数据",
      "AI意见不会绕过止损、风险和禁做条件",
    ],
    modifications: score < 70 ? ["补充独立触发条件", "同时定义止损与止盈路径"] : ["执行前再次核对价格与仓位"],
  };
}

function validReview(value: unknown): value is Review {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<Review>;
  return ["ALLOW_LIVE", "REVISE", "WAIT"].includes(review.action ?? "")
    && ["LOW", "MEDIUM", "HIGH"].includes(review.riskLevel ?? "")
    && typeof review.verdict === "string" && Array.isArray(review.reasons) && Array.isArray(review.modifications);
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "same-origin operator action required" }, { status: 403 });
  const denied = await requireOperator(request);
  if (denied) return denied;
  if (Number(request.headers.get("content-length") || 0) > 32_000) return Response.json({ error: "request too large" }, { status: 413 });
  const payload = await request.json() as Record<string, unknown>;
  const fallback = rulesFallback(payload);
  const target = await getActiveAiTarget(await getD1());
  const channel = target.provider === "ccswitch" ? configuredChannels().find((item) => item.id === target.channelId) : undefined;
  const apiKey = target.provider === "ccswitch" && channel ? await getServerCredential(channel.secretKey) : await getServerCredential("OPENAI_API_KEY");
  const taskTargets = await resolveTaskTargets("risk_review");
  if (!apiKey && !taskTargets.length) return Response.json({ configured: false, mode: "rules", model: null, review: fallback });
  const reservation = reserveAiRequest();
  if (!reservation.allowed) {
    return Response.json({ error: "AI 分析请求过于频繁，请稍后重试。", retryAfterMs: reservation.retryAfterMs }, { status: 429, headers: { "retry-after": String(Math.ceil((reservation.retryAfterMs ?? 1_000) / 1_000)) } });
  }

  try {
    const structuredRequest = { system: "你是私有交易工作台里的实盘策略风险复核员。只评估计划质量，不预测收益，不发送订单，不得放宽硬性风险闸门。输出简洁中文。", user: JSON.stringify(payload), name: "live_trade_review", schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["ALLOW_LIVE", "REVISE", "WAIT"] },
            riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
            verdict: { type: "string" },
            reasons: { type: "array", items: { type: "string" } },
            modifications: { type: "array", items: { type: "string" } },
          },
          required: ["action", "riskLevel", "verdict", "reasons", "modifications"],
          additionalProperties: false,
        } };
    const result = taskTargets.length
      ? await invokeStructuredModelWithFallback(structuredRequest, { provider: "openai", targets: taskTargets, timeoutMs: 25_000 })
      : await invokeStructuredModel(structuredRequest, { provider: target.provider === "ccswitch" ? "openai" : target.provider, target: channel && target.model && target.protocol ? { id: channel.id, name: channel.name, model: target.model, protocol: target.protocol, endpoint: channel.baseUrl, apiKey } : undefined, env: { ...process.env, OPENAI_API_KEY: apiKey }, timeoutMs: 25_000 });
    const review = result.json;
    if (!validReview(review)) throw new Error("invalid_review");
    if (fallback.action !== "ALLOW_LIVE" && review.action === "ALLOW_LIVE") review.action = fallback.action;
    const fallbacks = "fallbacks" in result ? result.fallbacks : [];
    return Response.json({ configured: true, mode: taskTargets.length ? "task_router" : target.provider === "ccswitch" ? "ccswitch" : "openai", model: result.model, fallbacks, review });
  } catch {
    return Response.json({ configured: true, mode: "rules_fallback", model: null, review: fallback, warning: "AI复核暂不可用，已回退到可解释纪律引擎。" });
  } finally {
    reservation.release?.();
  }
}
