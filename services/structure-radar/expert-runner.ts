import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalHash } from "../../lib/structure-radar/math.ts";
import { validateExpertDecision } from "../../lib/structure-radar/expert-consensus.ts";
import type { ExpertDecision, ExpertId, ExpertRound } from "../../lib/structure-radar/expert-types.ts";
import { buildExpertPrompt } from "./expert-prompts.ts";

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
  return new Promise<string>((resolve, reject) => {
    const child = spawn("codex", input.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "production",
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("expert runner timed out"));
    }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 256 * 1024) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`codex exited ${code}: ${stderr.slice(-1_000)}`));
    });
    child.stdin.end(input.prompt);
  });
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
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "expert-schema.json");
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
