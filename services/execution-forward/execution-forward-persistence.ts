import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  EdpSnapshot,
  ForwardOutcomeSnapshot,
  ForwardRecord,
  PaperPlanSnapshot,
  RecheckSnapshot,
} from "./types.ts";

const RECORD_KINDS = new Set(["EDP", "RECHECK", "PLAN", "OUTCOME"]);
const RECHECK_CLASSIFICATIONS = new Set([
  "POST_EVENT_REPRICE_RISK_COMPRESSION",
  "RECHECK_CLASSIFIER_UNAVAILABLE",
  "RECHECK_DATA_INCOMPLETE",
]);
const OUTCOME_HORIZONS = new Set(["1H", "3H", "6H", "12H", "24H"]);
const PROBABILITY_LIKE_KEY = /^(p_opp|p_sev|probability|probabilityScore|predictedProbability)$/i;

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} timestamp is invalid`);
  }
  return timestamp;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function assertNoSyntheticProbability(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSyntheticProbability(item, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROBABILITY_LIKE_KEY.test(key)) {
      throw new Error(`malformed ${label}: probability/scorer field ${key} is forbidden`);
    }
    assertNoSyntheticProbability(child, `${label}.${key}`);
  }
}

function validateEdpSnapshot(snapshot: Record<string, unknown>, lineNumber: number): void {
  const label = `JSONL row ${lineNumber} EDP`;
  requireString(snapshot.eventId, `${label}.eventId`);
  requireString(snapshot.dedupeKey, `${label}.dedupeKey`);
  requireString(snapshot.symbol, `${label}.symbol`);
  if (snapshot.direction !== "LONG" && snapshot.direction !== "SHORT") {
    throw new Error(`malformed ${label}: direction must be LONG or SHORT`);
  }
  requireTimestamp(snapshot.detectedAt, `${label}.detectedAt`);
  requireFiniteNumber(snapshot.price, `${label}.price`);
  requireString(snapshot.lifecycle, `${label}.lifecycle`);
  requireString(snapshot.source, `${label}.source`);
  requireString(snapshot.discoveryChannel, `${label}.discoveryChannel`);
  requireString(snapshot.candidateVersion, `${label}.candidateVersion`);
  requireString(snapshot.modelVersion, `${label}.modelVersion`);
  asObject(snapshot.rawFeatures, `${label}.rawFeatures`);
  asObject(snapshot.dataCompleteness, `${label}.dataCompleteness`);
  if (snapshot.state !== "WAIT_15M_RECHECK") {
    throw new Error(`malformed ${label}: invalid state`);
  }
  if (snapshot.scorerStatus !== "UNAVAILABLE_ARTIFACT") {
    throw new Error(`malformed ${label}: invalid scorerStatus`);
  }
  requireTimestamp(snapshot.createdAt, `${label}.createdAt`);
  if (snapshot.tradingPermission !== false) {
    throw new Error(`malformed ${label}: tradingPermission must be false`);
  }
  assertNoSyntheticProbability(snapshot, label);
}

function validateRecheckSnapshot(snapshot: Record<string, unknown>, lineNumber: number): void {
  const label = `JSONL row ${lineNumber} RECHECK`;
  requireString(snapshot.eventId, `${label}.eventId`);
  requireTimestamp(snapshot.recheckAt, `${label}.recheckAt`);
  requireFiniteNumber(snapshot.price, `${label}.price`);
  asObject(snapshot.rawFeatures, `${label}.rawFeatures`);
  asObject(snapshot.dataCompleteness, `${label}.dataCompleteness`);
  if (typeof snapshot.classification !== "string" || !RECHECK_CLASSIFICATIONS.has(snapshot.classification)) {
    throw new Error(`malformed ${label}: unsupported classification`);
  }
  const expectedState =
    snapshot.classification === "POST_EVENT_REPRICE_RISK_COMPRESSION"
      ? "ACTIONABLE_REVIEW_CANDIDATE"
      : "RECHECK_FAILED";
  if (snapshot.state !== expectedState) {
    throw new Error(`malformed ${label}: classification/state mismatch`);
  }
  if (snapshot.scorerStatus !== "UNAVAILABLE_ARTIFACT") {
    throw new Error(`malformed ${label}: invalid scorerStatus`);
  }
  if (snapshot.tradingPermission !== false) {
    throw new Error(`malformed ${label}: tradingPermission must be false`);
  }
  requireTimestamp(snapshot.createdAt, `${label}.createdAt`);
  assertNoSyntheticProbability(snapshot, label);
}

function validatePlanSnapshot(snapshot: Record<string, unknown>, lineNumber: number): void {
  const label = `JSONL row ${lineNumber} PLAN`;
  requireString(snapshot.eventId, `${label}.eventId`);
  requireFiniteNumber(snapshot.entry, `${label}.entry`);
  requireFiniteNumber(snapshot.invalidation, `${label}.invalidation`);
  requireFiniteNumber(snapshot.stop, `${label}.stop`);
  requireTimestamp(snapshot.frozenAt, `${label}.frozenAt`);
  if (snapshot.paperOnly !== true) {
    throw new Error(`malformed ${label}: paperOnly must be true`);
  }
  if (snapshot.tradingPermission !== false) {
    throw new Error(`malformed ${label}: tradingPermission must be false`);
  }
}

function validateOutcomeSnapshot(snapshot: Record<string, unknown>, lineNumber: number): void {
  const label = `JSONL row ${lineNumber} OUTCOME`;
  requireString(snapshot.eventId, `${label}.eventId`);
  if (typeof snapshot.horizon !== "string" || !OUTCOME_HORIZONS.has(snapshot.horizon)) {
    throw new Error(`malformed ${label}: unsupported horizon`);
  }
  requireTimestamp(snapshot.observedAt, `${label}.observedAt`);
  for (const field of ["returnPct", "mfePct", "maePct", "timeToMfeMinutes", "pathEfficiency"] as const) {
    if (snapshot[field] !== undefined) {
      requireFiniteNumber(snapshot[field], `${label}.${field}`);
    }
  }
}

function validateRecord(value: unknown, lineNumber: number): asserts value is ForwardRecord {
  const record = asObject(value, `malformed JSONL row ${lineNumber}: record`);
  if (typeof record.kind !== "string" || !RECORD_KINDS.has(record.kind)) {
    throw new Error(`malformed JSONL row ${lineNumber}: unknown kind`);
  }
  const snapshot = asObject(record.snapshot, `malformed JSONL row ${lineNumber}: snapshot`);
  switch (record.kind) {
    case "EDP":
      validateEdpSnapshot(snapshot, lineNumber);
      break;
    case "RECHECK":
      validateRecheckSnapshot(snapshot, lineNumber);
      break;
    case "PLAN":
      validatePlanSnapshot(snapshot, lineNumber);
      break;
    case "OUTCOME":
      validateOutcomeSnapshot(snapshot, lineNumber);
      break;
  }
}

function sameEdpLogicalSnapshot(left: EdpSnapshot, right: EdpSnapshot): boolean {
  const { createdAt: _leftCreatedAt, ...leftLogical } = left;
  const { createdAt: _rightCreatedAt, ...rightLogical } = right;
  return isDeepStrictEqual(leftLogical, rightLogical);
}

export class ExecutionForwardJsonlStore {
  readonly filePath: string;

  constructor(filePath: string) {
    if (!filePath) throw new Error("forward JSONL file path is required");
    this.filePath = filePath;
  }

  async load(): Promise<ForwardRecord[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rows: ForwardRecord[] = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`malformed JSONL row ${index + 1}: invalid JSON`, { cause: error });
      }
      validateRecord(parsed, index + 1);
      rows.push(parsed);
    }
    return rows;
  }

  async getRecords(): Promise<ForwardRecord[]> {
    return cloneRecord(await this.load());
  }

  async appendEdp(snapshot: EdpSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const sameEvent = records.find(
      (row) => row.kind === "EDP" && row.snapshot.eventId === snapshot.eventId,
    );
    if (sameEvent) {
      if (sameEdpLogicalSnapshot(sameEvent.snapshot, snapshot)) return { appended: false };
      throw new Error(`eventId conflict for ${snapshot.eventId}`);
    }
    const sameDedupe = records.find(
      (row) => row.kind === "EDP" && row.snapshot.dedupeKey === snapshot.dedupeKey,
    );
    if (sameDedupe) {
      throw new Error(`dedupe conflict for ${snapshot.dedupeKey}`);
    }
    await this.append({ kind: "EDP", snapshot });
    return { appended: true };
  }

  async appendRecheck(snapshot: RecheckSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const existing = records.find(
      (row) => row.kind === "RECHECK" && row.snapshot.eventId === snapshot.eventId,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`recheck conflict for ${snapshot.eventId}`);
    }
    await this.append({ kind: "RECHECK", snapshot });
    return { appended: true };
  }

  async appendPlan(snapshot: PaperPlanSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const edp = records.find(
      (row) => row.kind === "EDP" && row.snapshot.eventId === snapshot.eventId,
    );
    if (!edp) {
      throw new Error(`paper plan requires EDP for ${snapshot.eventId}`);
    }
    const actionableRecheck = records.find(
      (row) =>
        row.kind === "RECHECK" &&
        row.snapshot.eventId === snapshot.eventId &&
        row.snapshot.classification === "POST_EVENT_REPRICE_RISK_COMPRESSION" &&
        row.snapshot.state === "ACTIONABLE_REVIEW_CANDIDATE",
    );
    if (!actionableRecheck) {
      throw new Error(`paper plan requires actionable recheck for ${snapshot.eventId}`);
    }
    const existing = records.find(
      (row) => row.kind === "PLAN" && row.snapshot.eventId === snapshot.eventId,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`paper plan conflict for ${snapshot.eventId}`);
    }
    await this.append({ kind: "PLAN", snapshot });
    return { appended: true };
  }

  async appendOutcome(snapshot: ForwardOutcomeSnapshot): Promise<{ appended: boolean }> {
    const records = await this.load();
    const existing = records.find(
      (row) =>
        row.kind === "OUTCOME" &&
        row.snapshot.eventId === snapshot.eventId &&
        row.snapshot.horizon === snapshot.horizon,
    );
    if (existing) {
      if (isDeepStrictEqual(existing.snapshot, snapshot)) return { appended: false };
      throw new Error(`outcome conflict for ${snapshot.eventId}:${snapshot.horizon}`);
    }
    await this.append({ kind: "OUTCOME", snapshot });
    return { appended: true };
  }

  async listPendingRechecks(): Promise<EdpSnapshot[]> {
    const records = await this.load();
    const completed = new Set(
      records
        .filter((row): row is Extract<ForwardRecord, { kind: "RECHECK" }> => row.kind === "RECHECK")
        .map((row) => row.snapshot.eventId),
    );
    return records
      .filter((row): row is Extract<ForwardRecord, { kind: "EDP" }> => row.kind === "EDP")
      .filter((row) => !completed.has(row.snapshot.eventId))
      .map((row) => cloneRecord(row.snapshot));
  }

  private async append(record: ForwardRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
