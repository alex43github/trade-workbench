type Review = {
  action: "ALLOW_PAPER" | "REVISE" | "WAIT";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  verdict: string;
  reasons: string[];
  modifications: string[];
};

function rulesFallback(payload: Record<string, unknown>): Review {
  const score = Number(payload.score) || 0;
  const radar = payload.radar && typeof payload.radar === "object" ? payload.radar as { participation?: string; mode?: string } : {};
  const action = radar.participation === "AVOID" ? "WAIT" : score >= 70 ? "ALLOW_PAPER" : "REVISE";
  return {
    action,
    riskLevel: score >= 80 && radar.mode === "live" ? "LOW" : score >= 65 ? "MEDIUM" : "HIGH",
    verdict: action === "ALLOW_PAPER" ? "纪律条件达到模拟盘门槛，仍需由你确认后执行。" : action === "WAIT" ? "市场风险闸门已触发，暂不进入模拟盘。" : "计划尚未达到模拟盘执行门槛。",
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
  return ["ALLOW_PAPER", "REVISE", "WAIT"].includes(review.action ?? "")
    && ["LOW", "MEDIUM", "HIGH"].includes(review.riskLevel ?? "")
    && typeof review.verdict === "string" && Array.isArray(review.reasons) && Array.isArray(review.modifications);
}

export async function POST(request: Request) {
  const payload = await request.json() as Record<string, unknown>;
  const fallback = rulesFallback(payload);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ configured: false, mode: "rules", model: null, review: fallback });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "low" },
        store: false,
        safety_identifier: "streetlight-owner-v1",
        input: [
          { role: "developer", content: "你是私有交易工作台里的模拟盘风险复核员。只评估计划质量，不预测收益，不发送订单，不得放宽硬性风险闸门。盈利不等于正确，亏损不等于错误；关注触发、失效、仓位、止损、止盈、拥挤度和数据质量。输出简洁中文。" },
          { role: "user", content: JSON.stringify(payload) },
        ],
        text: { format: { type: "json_schema", name: "paper_trade_review", strict: true, schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["ALLOW_PAPER", "REVISE", "WAIT"] },
            riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
            verdict: { type: "string" },
            reasons: { type: "array", items: { type: "string" } },
            modifications: { type: "array", items: { type: "string" } },
          },
          required: ["action", "riskLevel", "verdict", "reasons", "modifications"],
          additionalProperties: false,
        } } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const result = await response.json() as { output_text?: string; model?: string };
    const review = result.output_text ? JSON.parse(result.output_text) : null;
    if (!validReview(review)) throw new Error("invalid_review");
    if (fallback.action !== "ALLOW_PAPER" && review.action === "ALLOW_PAPER") review.action = fallback.action;
    return Response.json({ configured: true, mode: "openai", model: result.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6-terra", review });
  } catch {
    return Response.json({ configured: true, mode: "rules_fallback", model: null, review: fallback, warning: "AI复核暂不可用，已回退到可解释纪律引擎。" });
  }
}
