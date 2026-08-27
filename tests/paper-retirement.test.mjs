import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_D1 = path.join(os.tmpdir(), `streetlight-paper-retirement-${process.pid}-${Date.now()}.sqlite`);

const request = (url, method = "POST") => new Request(url, {
  method,
  headers: method === "POST" ? { "content-type": "application/json" } : undefined,
  body: method === "POST" ? "{}" : undefined,
});

test("retired PAPER routes reject every read and write without creating a ledger record", async () => {
  const [paper, paperOrder, paperClose, paperReset, strategies, conditional] = await Promise.all([
    import("../app/api/paper/route.ts"),
    import("../app/api/paper/order/route.ts"),
    import("../app/api/paper/close/route.ts"),
    import("../app/api/paper/reset/route.ts"),
    import("../app/api/trade/strategies/route.ts"),
    import("../app/api/trade/conditional-orders/route.ts"),
  ]);

  const responses = await Promise.all([
    paper.GET(request("http://localhost:3000/api/paper", "GET")),
    paperOrder.POST(request("http://localhost:3000/api/paper/order")),
    paperOrder.DELETE(request("http://localhost:3000/api/paper/order", "DELETE")),
    paperClose.POST(request("http://localhost:3000/api/paper/close")),
    paperReset.POST(request("http://localhost:3000/api/paper/reset")),
    strategies.GET(request("http://localhost:3000/api/trade/strategies", "GET")),
    strategies.POST(request("http://localhost:3000/api/trade/strategies")),
    conditional.GET(request("http://localhost:3000/api/trade/conditional-orders", "GET")),
    conditional.POST(request("http://localhost:3000/api/trade/conditional-orders")),
    conditional.DELETE(request("http://localhost:3000/api/trade/conditional-orders", "DELETE")),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: "PAPER simulation retired", realOrderRouteEnabled: false });
  }
});
