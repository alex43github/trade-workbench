import assert from "node:assert/strict";
import test from "node:test";

import { operatorAccessToken, operatorSessionSecret, requireOperator, requireOperatorMutation, requireScheduler } from "../lib/security/operator-guard.ts";

const production = {
  NODE_ENV: "production",
  OPERATOR_SESSION_SECRET: "operator-session-secret-0123456789",
  OPERATOR_ACCESS_TOKEN: "operator-access-token-0123456789",
  MAINTENANCE_JOB_TOKEN: "maintenance-token-0123456789",
};

test("private APIs reject an anonymous production request", async () => {
  const response = await requireOperator(new Request("https://terminal.example/api/account"), production);
  assert.equal(response?.status, 401);
});

test("localhost permits temporary anonymous testing unless explicitly disabled", async () => {
  const localResponse = await requireOperator(new Request("http://localhost:3003/api/account"), production);
  assert.equal(localResponse, null);

  const disabledResponse = await requireOperator(
    new Request("http://localhost:3003/api/account"),
    { ...production, STREETLIGHT_LOCAL_TEST_MODE: "false" },
  );
  assert.equal(disabledResponse?.status, 401);
});

test("production separates the login token from the session signing secret", () => {
  assert.equal(operatorAccessToken(production), "operator-access-token-0123456789");
  assert.equal(operatorSessionSecret(production), "operator-session-secret-0123456789");
  assert.notEqual(operatorAccessToken(production), operatorSessionSecret(production));
});

test("scheduler authorization requires its own token instead of the operator secret", () => {
  const request = new Request("https://terminal.example/api/advisory/maintenance", {
    method: "POST",
    headers: { authorization: "Bearer operator-session-secret-0123456789" },
  });
  assert.equal(requireScheduler(request, production), false);
  const scheduled = new Request("https://terminal.example/api/advisory/maintenance", {
    method: "POST",
    headers: { authorization: "Bearer maintenance-token-0123456789" },
  });
  assert.equal(requireScheduler(scheduled, production), true);
});

test("private mutations reject cross-origin requests before they can change state", async () => {
  const response = await requireOperatorMutation(new Request("https://terminal.example/api/paper/order", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      cookie: "streetlight_operator=not-a-valid-session",
    },
  }), { ...production, STREETLIGHT_LOCAL_TEST_MODE: "false" });
  assert.equal(response?.status, 403);
});

test("private mutations accept the public origin forwarded by the HTTPS proxy", async () => {
  const response = await requireOperatorMutation(new Request("http://127.0.0.1:3000/api/paper/order", {
    method: "POST",
    headers: {
      origin: "https://terminal.example",
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "terminal.example",
    },
  }), { ...production, STREETLIGHT_LOCAL_TEST_MODE: "false" });
  assert.equal(response?.status, 401);
});
