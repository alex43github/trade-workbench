import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

import { canonicalJson } from "./task-007-protocol.ts";

type FileInventory = {
  relative_path: string;
  size_bytes: number;
  sha256: string;
  row_count: number | null;
  event_count: number | null;
  outcome_count: number | null;
};

const COPY_LAYOUT: Readonly<Record<string, string>> = {
  "LIVE_FORWARD_EPOCH.json": "manifests/LIVE_FORWARD_EPOCH.json",
  "LIVE_EVENT_SNAPSHOT.jsonl": "snapshot/LIVE_EVENT_SNAPSHOT.jsonl",
  "LIVE_EVENT_TRANSITION.jsonl": "transitions/LIVE_EVENT_TRANSITION.jsonl",
  "LIVE_EVENT_OUTCOME.jsonl": "outcomes/LIVE_EVENT_OUTCOME.jsonl",
  "UNIFIED_RESEARCH_VIEW.jsonl": "unified/UNIFIED_RESEARCH_VIEW.jsonl",
  "SHADOW_FORWARD_SUMMARY.jsonl": "audit/SHADOW_FORWARD_SUMMARY.jsonl",
  "SHADOW_SCANNER_STATE.json": "audit/SHADOW_SCANNER_STATE.json",
};

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonlStats(text: string, fileName: string) {
  if (!fileName.endsWith(".jsonl")) return { row_count: null, event_count: null, outcome_count: null };
  const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    row_count: rows.length,
    event_count: fileName.includes("SNAPSHOT") || fileName.includes("VIEW") ? rows.length : null,
    outcome_count: fileName.includes("OUTCOME") ? rows.length : null,
  };
}

async function inventoryFile(root: string, relativePath: string): Promise<FileInventory> {
  const path = join(root, relativePath);
  const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
  return { relative_path: relativePath, size_bytes: details.size, sha256: sha256(bytes), ...jsonlStats(bytes.toString("utf8"), relativePath) };
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
  }
  return files;
}

export async function inventoryResearchEpoch(sourceRoot: string) {
  const root = resolve(sourceRoot);
  const files = await walkFiles(root);
  const inventory = await Promise.all(files.map((file) => inventoryFile(root, file)));
  return {
    root,
    files: inventory.sort((left, right) => left.relative_path.localeCompare(right.relative_path)),
    event_count: inventory.find((item) => item.relative_path === "LIVE_EVENT_SNAPSHOT.jsonl")?.event_count ?? 0,
    outcome_count: inventory.find((item) => item.relative_path === "LIVE_EVENT_OUTCOME.jsonl")?.outcome_count ?? 0,
  };
}

function assertDestination(destinationRoot: string) {
  const root = resolve(destinationRoot);
  if (root === "/opt" || root.startsWith("/opt/")) throw new Error("persistent research destination cannot be /opt");
  if (!root.endsWith("/forward-shadow")) throw new Error("persistent research destination must end with /forward-shadow");
  return root;
}

async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function destinationInventory(sourceRoot: string, destinationRoot: string) {
  const entries: FileInventory[] = [];
  for (const [sourceName, destinationName] of Object.entries(COPY_LAYOUT)) {
    const source = await inventoryFile(sourceRoot, sourceName);
    const destination = await inventoryFile(destinationRoot, destinationName);
    entries.push({ ...destination, relative_path: sourceName });
  }
  return entries.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

export async function copyResearchEpoch({
  sourceRoot,
  destinationRoot,
  epochId,
}: {
  sourceRoot: string;
  destinationRoot: string;
  epochId: string;
}) {
  if (!/^epoch-[A-Za-z0-9T:._-]+$/.test(epochId)) throw new Error("epoch id is invalid");
  const source = resolve(sourceRoot);
  const root = assertDestination(destinationRoot);
  if (source === root || root.startsWith(`${source}/`)) throw new Error("persistent destination cannot contain the source");
  const sourceInventory = await inventoryResearchEpoch(source);
  const finalRoot = join(root, "epochs", epochId);
  await mkdir(join(root, "epochs"), { recursive: true, mode: 0o700 });
  const stagingRoot = join(root, "epochs", `.staging-${epochId}-${process.pid}-${Date.now()}`);
  try {
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    for (const [sourceName, destinationName] of Object.entries(COPY_LAYOUT)) {
      const sourceFile = join(source, sourceName);
      const destinationFile = join(stagingRoot, destinationName);
      await mkdir(resolve(destinationFile, ".."), { recursive: true, mode: 0o700 });
      await copyFile(sourceFile, destinationFile);
    }
    const copied = await destinationInventory(source, stagingRoot);
    const sourceByName = new Map(sourceInventory.files.map((item) => [item.relative_path, item]));
    for (const item of copied) {
      const sourceItem = sourceByName.get(item.relative_path);
      if (!sourceItem || sourceItem.sha256 !== item.sha256 || sourceItem.size_bytes !== item.size_bytes || sourceItem.row_count !== item.row_count) {
        throw new Error(`persistent copy verification failed: ${item.relative_path}`);
      }
    }
    const manifest = {
      schema_version: "FAST_DETACH_V2_PERSISTENT_FORWARD_EPOCH_V1",
      epoch_id: epochId,
      source_root: source,
      destination_root: finalRoot,
      copied_files: copied,
      source_inventory: sourceInventory,
      source_preserved: true,
    };
    await writeJson(join(stagingRoot, "manifests", "PERSISTENT_COPY_MANIFEST.json"), manifest);
    await mkdir(join(stagingRoot, "manifests"), { recursive: true, mode: 0o700 });
    await writeJson(join(stagingRoot, "manifests", "SOURCE_INVENTORY.json"), sourceInventory);
    let status: "written" | "reused" = "written";
    try {
      await stat(finalRoot);
      const existing = await destinationInventory(source, finalRoot);
      if (JSON.stringify(existing) !== JSON.stringify(copied)) throw new Error("persistent epoch destination conflicts with source");
      status = "reused";
      await rm(stagingRoot, { recursive: true, force: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") await rename(stagingRoot, finalRoot);
      else throw error;
    }
    await mkdir(join(root, "current"), { recursive: true, mode: 0o700 });
    await writeJson(join(root, "current", "CURRENT_EPOCH.json"), { epoch_id: epochId, path: finalRoot, status });
    const sourceAfter = await inventoryResearchEpoch(source);
    return {
      PERSISTENT_COPY_SHA_MATCH: true,
      SOURCE_TMP_PRESERVED: JSON.stringify(sourceAfter.files) === JSON.stringify(sourceInventory.files),
      status,
      source_inventory: sourceInventory,
      persistent_inventory: copied,
      persistent_root: finalRoot,
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export { COPY_LAYOUT };
