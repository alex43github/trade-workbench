import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { arbitrateR4, validateExpertDecision } from "../lib/structure-radar/expert-consensus.ts";
import { buildExpertBundle, runExpertRound } from "../services/structure-radar/expert-runner.ts";

function decision(expert, vote = "SUPPORT", overrides = {}) {
  return {
    expert, round: "R3", vote, direction: vote === "SUPPORT" ? "LONG" : "NEUTRAL",
    thesis: `${expert} thesis`, confidence: 70,
    entry: vote === "SUPPORT" ? { min: 99, max: 100 } : null,
    stop: vote === "SUPPORT" ? 97 : null,
    targets: vote === "SUPPORT" ? [103, 106] : [],
    management: vote === "SUPPORT" ? ["站稳后才加仓", "失效退出"] : [],
    citations: [{ ref: `${expert.toUpperCase()}-001 @ 00:01:00-00:02:00`, note: "结构依据" }],
    ...overrides,
  };
}

test("validates directional geometry and source citations", () => {
  assert.equal(validateExpertDecision(decision("street")).valid, true);
  assert.equal(validateExpertDecision(decision("street", "SUPPORT", { stop: 101 })).valid, false);
  assert.equal(validateExpertDecision(decision("street", "SUPPORT", { citations: [] })).valid, false);
});

test("maps 4/4 and 3/4 support to full-plan alerts", () => {
  const unanimous = arbitrateR4(["ict", "street", "jingxin", "bitlanglang"].map((id) => decision(id)));
  assert.equal(unanimous.grade, "4/4");
  assert.equal(unanimous.alertPolicy, "FULL_PLAN");
  assert.equal(unanimous.executionExpert, "bitlanglang");
  const three = arbitrateR4([decision("ict"), decision("street"), decision("jingxin"), decision("bitlanglang", "NEUTRAL")]);
  assert.equal(three.grade, "3/4");
  assert.equal(three.alertPolicy, "FULL_PLAN");
  assert.equal(three.executionExpert, "street");
});

test("maps two support and two neutral to aggressive candidate", () => {
  const result = arbitrateR4([decision("ict", "NEUTRAL"), decision("street"), decision("jingxin", "NEUTRAL"), decision("bitlanglang")]);
  assert.equal(result.grade, "2/4");
  assert.equal(result.alertPolicy, "AGGRESSIVE_CANDIDATE");
  assert.equal(result.executionExpert, "bitlanglang");
});

test("suppresses unified points for opposition or two-versus-two", () => {
  const shapeOnly = arbitrateR4([decision("ict", "OPPOSE"), decision("street"), decision("jingxin", "NEUTRAL"), decision("bitlanglang")]);
  assert.equal(shapeOnly.alertPolicy, "SHAPE_ONLY");
  assert.equal(shapeOnly.executionPlan, null);
  const divergence = arbitrateR4([decision("ict", "OPPOSE"), decision("street", "OPPOSE"), decision("jingxin"), decision("bitlanglang")]);
  assert.equal(divergence.alertPolicy, "MAJOR_DIVERGENCE");
  assert.equal(divergence.executionPlan, null);
});

test("requires at least three valid R3 opinions", () => {
  const result = arbitrateR4([decision("street"), decision("bitlanglang")]);
  assert.equal(result.alertPolicy, "MECHANICAL_ONLY");
  assert.equal(result.executionPlan, null);
});

test("bitlanglang leads execution without receiving extra vote weight", () => {
  const result = arbitrateR4([decision("ict"), decision("street"), decision("jingxin", "OPPOSE"), decision("bitlanglang")]);
  assert.equal(result.support, 3);
  assert.equal(result.executionExpert, "bitlanglang");
  assert.deepEqual(result.executionPlan?.entry, { min: 99, max: 100 });
});

test("hashes every file in a Skill bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "expert-skill-"));
  try {
    await writeFile(join(root, "SKILL.md"), "one");
    await mkdir(join(root, "references"));
    await writeFile(join(root, "references", "rules.md"), "two");
    const first = await buildExpertBundle("street", root);
    await writeFile(join(root, "references", "rules.md"), "changed");
    const second = await buildExpertBundle("street", root);
    assert.equal(first.files.length, 2);
    assert.notEqual(first.hash, second.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real runner retries twice and returns unavailable instead of a fake opinion", async () => {
  let attempts = 0;
  const result = await runExpertRound({
    expert: "street", round: "R1", skillPath: "/missing/SKILL.md", marketSnapshot: { symbol: "BTCUSDT" },
    async execute() { attempts += 1; throw new Error("codex unavailable"); },
  });
  assert.equal(attempts, 3);
  assert.equal(result.status, "unavailable");
  assert.equal(result.decision, null);
});

test("R2 prompt anonymizes peer identities", async () => {
  let prompt = "";
  const valid = decision("street", "SUPPORT", { round: "R2" });
  const result = await runExpertRound({
    expert: "street", round: "R2", skillPath: "/tmp/street/SKILL.md", marketSnapshot: { symbol: "BTCUSDT" },
    peerTheses: [{ expert: "ict", thesis: "liquidity sweep" }],
    async execute(input) { prompt = input.prompt; return JSON.stringify(valid); },
  });
  assert.equal(result.status, "complete");
  assert.match(prompt, /Peer A/);
  assert.doesNotMatch(prompt, /ict/i);
});

test("runner always invokes Codex in ephemeral read-only schema mode", async () => {
  let args = [];
  await runExpertRound({
    expert: "street", round: "R1", skillPath: "/tmp/street/SKILL.md", marketSnapshot: { symbol: "BTCUSDT" },
    async execute(input) { args = input.args; return JSON.stringify(decision("street", "SUPPORT", { round: "R1" })); },
  });
  assert.deepEqual(args.slice(0, 5), ["exec", "--ephemeral", "--sandbox", "read-only", "--output-schema"]);
  assert.equal(args.at(-1), "-");
});
