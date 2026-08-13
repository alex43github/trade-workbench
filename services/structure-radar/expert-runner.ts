import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { canonicalHash } from "../../lib/structure-radar/math.ts";
import { validateExpertDecision } from "../../lib/structure-radar/expert-consensus.ts";
import type { ExpertDecision, ExpertId, ExpertRound } from "../../lib/structure-radar/expert-types.ts";
import { buildExpertPrompt } from "./expert-prompts.ts";

const execFileAsync = promisify(execFile);

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function buildExpertBundle(expert: ExpertId, skillPathOrRoot: string) {
  const root = skillPathOrRoot.endsWith("SKILL.md") ? dirname(skillPathOrRoot) : skillPathOrRoot;
  const paths = await listFiles(root);
  const files = await Promise.all(paths.map(async (path) => ({
    path: relative(root, path),
    content: await readFile(path, "utf8"),
  })));
  return { expert, root, files: files.map(({ path }) => path), hash: await canonicalHash(files) };
}

type ExecuteInput = { prompt: string; schemaPath: string; args: string[] };
type Execute = (input: ExecuteInput) => Promise<string>;

async function defaultExecute(input: ExecuteInput) {
  const { stdout } = await execFileAsync("codex", input.args, {
    input: input.prompt,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "production" },
  });
  return stdout;
}

export async function runExpertRound(input: {
  expert: ExpertId;
  round: ExpertRound;
  skillPath: string;
  marketSnapshot: unknown;
  peerTheses?: readonly { expert?: string; thesis: string }[];
  execute?: Execute;
}) {
  const prompt = buildExpertPrompt(input);
  const schemaPath = join(dirname(new URL(import.meta.url).pathname), "expert-schema.json");
  const args = ["exec", "--ephemeral", "--sandbox", "read-only", "--output-schema", schemaPath, "-"];
  const execute = input.execute ?? defaultExecute;
  const errors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const output = await execute({ prompt, schemaPath, args });
      const parsed: unknown = JSON.parse(output.trim());
      const validation = validateExpertDecision(parsed);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      if (validation.decision.expert !== input.expert || validation.decision.round !== input.round) {
        throw new Error("expert or round identity mismatch");
      }
      return { status: "complete" as const, attempts: attempt, decision: validation.decision as ExpertDecision, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "expert runner failed");
    }
  }
  return { status: "unavailable" as const, attempts: 3, decision: null, errors };
}
