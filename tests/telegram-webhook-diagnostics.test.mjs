import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { telegramWebhookErrorDiagnostic } from "../lib/telegram/webhook-diagnostics.ts";

const route = fs.readFileSync(new URL("../app/api/telegram/webhook/[path]/route.ts", import.meta.url), "utf8");

test("Telegram webhook diagnostics preserve stage while sanitizing error details", () => {
  const diagnostic = telegramWebhookErrorDiagnostic(
    new Error("POST https://api.telegram.org/botSECRET/sendMessage Bearer abc123 failed"),
    "send_message",
  );

  assert.equal(diagnostic.stage, "send_message");
  assert.equal(diagnostic.name, "Error");
  assert.match(diagnostic.message, /\[url\]/);
  assert.match(diagnostic.message, /Bearer \[redacted\]/);
  assert.doesNotMatch(diagnostic.message, /SECRET|abc123/);
});

test("Telegram webhook route records actionable processing stages", () => {
  for (const stage of ["parse", "claim", "handler", "answer_callback", "send_message"]) {
    assert.match(route, new RegExp(`stage = "${stage}"`));
  }
  assert.match(route, /telegramWebhookErrorDiagnostic\(error, stage\)/);
});
