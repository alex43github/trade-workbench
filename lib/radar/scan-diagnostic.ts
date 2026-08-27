export type RadarDiagnostic = {
  code: string;
  detail: string;
  occurredAt: string;
  checks: string[];
};

type StructuredScanError = { status?: unknown; hint?: unknown };

export function createRadarDiagnostic(status: number | null, message: string, occurredAt = new Date()): RadarDiagnostic {
  const code = status === null
    ? "NETWORK_ERROR"
    : status === 401
      ? "AUTH_REQUIRED"
      : status === 409
        ? "SCAN_IN_PROGRESS"
        : status === 429
          ? "RATE_LIMITED"
          : status === 408
            ? "SCAN_TIMEOUT"
            : status >= 500
              ? "UPSTREAM_UNAVAILABLE"
              : `HTTP_${status}`;
  const checks = code === "AUTH_REQUIRED"
    ? ["请先通过 /signin 安全登录管理员账户。", "登录后返回雷达页点击“立即扫描/筛选”；匿名访问只读取已有快照，不会启动扫描。"]
    : code === "SCAN_IN_PROGRESS"
      ? ["已有扫描正在运行；等待其结束后再重试。", "不要连续重复点击，以免增加 Binance 数据源请求压力。"]
      : code === "RATE_LIMITED"
        ? ["Binance Futures 暂时限制了请求频率；等待片刻后再重试。", "扫描器已启用统一节流，不要连续重复点击。"]
        : code === "SCAN_TIMEOUT"
          ? ["扫描任务仍在后台执行，页面等待已超时。", "稍后刷新页面查看快照；如果反复超时，请检查 VPS 出网和 Binance 网关。"]
        : code === "UPSTREAM_UNAVAILABLE"
          ? ["本地扫描服务或上游 Binance 数据源暂不可用。", "稍后重试；若持续失败，请检查 VPS 出网、代理和 DNS。"]
          : ["检查本地扫描服务是否正在运行，以及 VPS/本机能否访问 Binance Futures。", "确认网络、代理和 DNS 可用后再重试。"];
  return {
    code,
    detail: message || "扫描请求没有返回可用结果",
    occurredAt: occurredAt.toISOString(),
    checks,
  };
}

export function createRadarDiagnosticFromError(error: unknown, fallback: string, occurredAt = new Date()): RadarDiagnostic {
  const details = error && typeof error === "object" ? error as StructuredScanError : {};
  const status = typeof details.status === "number" ? details.status : null;
  const baseMessage = error instanceof Error ? error.message : fallback;
  const hint = typeof details.hint === "string" ? details.hint : "";
  return createRadarDiagnostic(status, hint ? `${baseMessage}：${hint}` : baseMessage || fallback, occurredAt);
}
