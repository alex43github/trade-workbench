type RuntimeEnv = Record<string, string | undefined>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DeploymentStatus = {
  enabled: boolean;
  triggered: boolean;
  message: string;
  version: string;
  buildId: string;
};

function deploymentConfig(env: RuntimeEnv = process.env) {
  const url = env.DEPLOY_WEBHOOK_URL?.trim() ?? "";
  const token = env.DEPLOY_WEBHOOK_TOKEN?.trim() ?? "";
  try {
    return { url: new URL(url), token, enabled: new URL(url).protocol === "https:" && token.length >= 16 };
  } catch {
    return { url: null, token, enabled: false };
  }
}

export function getDeploymentStatus(env: RuntimeEnv = process.env): DeploymentStatus {
  const config = deploymentConfig(env);
  return {
    enabled: config.enabled,
    triggered: false,
    message: config.enabled ? "部署 Webhook 已配置，可请求受控更新" : "未配置 HTTPS 部署 Webhook；不会从网页执行任何服务器命令。",
    version: env.npm_package_version || env.APP_VERSION || "development",
    buildId: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || env.BUILD_ID || "local",
  };
}

export async function triggerDeploymentUpdate(options: { fetchImpl?: FetchLike; env?: RuntimeEnv } = {}): Promise<DeploymentStatus> {
  const env = options.env ?? process.env;
  const config = deploymentConfig(env);
  const status = getDeploymentStatus(env);
  if (!config.enabled || !config.url) return status;
  try {
    const response = await (options.fetchImpl ?? fetch)(config.url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "deploy-streetlight" }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    return {
      ...status,
      triggered: response.ok,
      message: response.ok ? "已向部署服务发送更新请求，请在部署平台查看构建结果。" : "部署服务拒绝了更新请求；请在 VPS 部署服务中检查令牌与来源限制。",
    };
  } catch {
    return { ...status, triggered: false, message: "部署服务暂不可达；请检查 HTTPS Webhook 与 VPS 网络。" };
  }
}
