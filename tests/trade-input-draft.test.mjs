import assert from "node:assert/strict";
import test from "node:test";

const { parseNumberDraft } = await import("../app/trade/numberDraft.ts");

test("number drafts preserve an empty field and decimal prefixes while typing", () => {
  assert.equal(parseNumberDraft(""), undefined);
  assert.equal(parseNumberDraft("0."), 0);
  assert.equal(parseNumberDraft("0.00"), 0);
  assert.equal(parseNumberDraft("0.0012"), 0.0012);
});

test("number drafts do not coerce a deleted final digit back to zero", () => {
  assert.equal(parseNumberDraft("3"), 3);
  assert.equal(parseNumberDraft(""), undefined);
});
