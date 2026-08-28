export const transientScanWarning = "网站服务正在重启或网络暂时波动，请稍后刷新或重试";

export function isTransientScanTransportFailure(status: number | null) {
  return status === null || status >= 500;
}
