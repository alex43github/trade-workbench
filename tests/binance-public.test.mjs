import assert from "node:assert/strict";
import test from "node:test";
import { binancePublicJson } from "../lib/binance-public.ts";

async function withEnv(updates, run) {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("公共行情优先通过本机网关，且不把令牌放进 URL", async () => {
  const requests = [];
  await withEnv({
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
    BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  }, async () => {
    const result = await binancePublicJson("/fapi/v1/time", {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
        return Response.json({ serverTime: 1 });
      },
    });
    assert.equal(result.source, "gateway");
    assert.deepEqual(result.data, { serverTime: 1 });
  });
  assert.equal(requests[0].url, "http://127.0.0.1:8788/api/binance/fapi/v1/time");
  assert.equal(requests[0].authorization, "Bearer 0123456789abcdef");
  assert.equal(requests[0].url.includes("0123456789abcdef"), false);
});

test("未配置网关时才直接请求 Binance 公共接口", async () => {
  const requests = [];
  await withEnv({ BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined }, async () => {
    const result = await binancePublicJson("/fapi/v1/time", {
      fetchImpl: async (url) => {
        requests.push(String(url));
        return Response.json({ serverTime: 2 });
      },
    });
    assert.equal(result.source, "direct");
    assert.deepEqual(result.data, { serverTime: 2 });
  });
  assert.equal(requests[0], "https://fapi.binance.com/fapi/v1/time");
});

test("网关失败仅返回安全错误与修复提示", async () => {
  await withEnv({
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
    BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
  }, async () => {
    await assert.rejects(
      () => binancePublicJson("/fapi/v1/time", { fetchImpl: async () => new Response("upstream topology", { status: 502 }) }),
      (error) => error?.source === "gateway" && error?.status === 502 && /网关/.test(error.message) && !error.message.includes("topology"),
    );
  });
});
