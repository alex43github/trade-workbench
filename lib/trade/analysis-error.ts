export type AnalysisFailure = {
  code: "PROVIDER_QUOTA_EXHAUSTED" | "PROVIDER_RATE_LIMITED" | "ANALYSIS_UNAVAILABLE";
  message: string;
  retryable: boolean;
};

export function classifyAnalysisError(error: unknown): AnalysisFailure {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/429|quota|exceeded\s+your\s+current\s+quota|billing/i.test(raw)) {
    return {
      code: "PROVIDER_QUOTA_EXHAUSTED",
      message: "AI 分析服务当前额度不足，未生成四专家结论。请到连接设置补充额度或更换可用的分析服务。",
      retryable: false,
    };
  }
  if (/rate\s*limit|too many requests|频率|限流/i.test(raw)) {
    return {
      code: "PROVIDER_RATE_LIMITED",
      message: "AI 分析服务当前请求较多，本次未生成四专家结论。请稍后重试。",
      retryable: true,
    };
  }
  return {
    code: "ANALYSIS_UNAVAILABLE",
    message: "四专家分析服务暂不可用，本次未生成交易建议。请检查连接设置后重试。",
    retryable: true,
  };
}
