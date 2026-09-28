import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { TrackedSignal } from "../../../lib/structure-radar/state-machine.ts";
import { TIMEFRAME_SECONDS } from "../config.ts";
import {
  TASK007_PROTOCOL_VERSION,
  buildEventId,
  buildSourceCycleId,
  canonicalJson,
  sha256Value,
  type LiveEventIdentity,
  type TransitionType,
} from "./task-007-protocol.ts";

type StoredState = {
  kind: "TASK007C_SHADOW_SCANNER_STATE";
  protocol_version: typeof TASK007_PROTOCOL_VERSION;
  signals: TrackedSignal[];
  state_sha256: string;
};

type ImmutableSignalIdentity = Pick<TrackedSignal, "id" | "symbol" | "timeframe" | "setup" | "anchorHash" | "detectedAt">;

function statePayload(signals: readonly TrackedSignal[]) {
  return {
    kind: "TASK007C_SHADOW_SCANNER_STATE" as const,
    protocol_version: TASK007_PROTOCOL_VERSION,
    signals: [...signals].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function validateState(value: unknown, path: string): StoredState {
  if (!value || typeof value !== "object") throw new Error(`${path} state must be an object`);
  const candidate = value as Partial<StoredState>;
  if (candidate.kind !== "TASK007C_SHADOW_SCANNER_STATE" || candidate.protocol_version !== TASK007_PROTOCOL_VERSION || !Array.isArray(candidate.signals)) {
    throw new Error(`${path} state header is invalid`);
  }
  const payload = statePayload(candidate.signals);
  if (candidate.state_sha256 !== sha256Value(payload)) throw new Error(`${path} state hash mismatch`);
  const ids = new Set<string>();
  for (const signal of candidate.signals) {
    if (!signal || typeof signal !== "object" || typeof signal.id !== "string" || ids.has(signal.id)) throw new Error(`${path} state signal identity is invalid`);
    ids.add(signal.id);
  }
  return { ...payload, state_sha256: candidate.state_sha256 };
}

function sameImmutableSignal(left: ImmutableSignalIdentity, right: ImmutableSignalIdentity) {
  return left.id === right.id && left.symbol === right.symbol && left.timeframe === right.timeframe &&
    left.setup === right.setup && left.anchorHash === right.anchorHash && left.detectedAt === right.detectedAt;
}

export class DurableShadowSignalStore {
  readonly #path: string;
  readonly #root: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string, { approvedRoot }: { approvedRoot: string }) {
    if (!path.trim() || !approvedRoot.trim()) throw new Error("shadow state path and root are required");
    const root = resolve(approvedRoot);
    const target = resolve(path);
    const relativePath = relative(root, target);
    if (isOutside(relativePath)) throw new Error("shadow state path is outside approved root");
    this.#path = target;
    this.#root = root;
  }

  async #readSignals() {
    try {
      const content = await readFile(this.#path, "utf8");
      return validateState(JSON.parse(content), this.#path).signals;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async #enqueue<T>(operation: () => Promise<T>) {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolvePromise, rejectPromise) => { resolveResult = resolvePromise; rejectResult = rejectPromise; });
    const queued = this.#writeQueue.then(async () => {
      try { resolveResult(await operation()); }
      catch (error) { rejectResult(error); }
    });
    this.#writeQueue = queued.catch(() => undefined);
    await queued;
    return result;
  }

  async get(id: string) {
    return (await this.#readSignals()).find((signal) => signal.id === id) ?? null;
  }

  async list() {
    return await this.#readSignals();
  }

  async save(signal: TrackedSignal) {
    return this.#enqueue(async () => {
      const current = await this.#readSignals();
      const previous = current.find((item) => item.id === signal.id);
      if (previous && !sameImmutableSignal(previous, signal)) throw new Error("shadow scanner signal identity is immutable");
      const next = [...current.filter((item) => item.id !== signal.id), signal].sort((left, right) => left.id.localeCompare(right.id));
      const payload = statePayload(next);
      const stored: StoredState = { ...payload, state_sha256: sha256Value(payload) };
      await mkdir(this.#root, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${canonicalJson(stored)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#path);
      return signal;
    });
  }
}

function isOutside(relativePath: string) {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.startsWith(sep);
}

export function buildTask007CIdentity(
  signal: TrackedSignal,
  forwardEpochId: string,
  detectedAtUtc: string,
  eapStatus: "NOT_ESTABLISHED" | "EAP_NOT_OBSERVED" = "NOT_ESTABLISHED",
  edpPrice?: number,
  edpUtc?: string,
): {
  identity: LiveEventIdentity & { event_id: string };
  scanner_signal_id: string;
  execution_context: {
    edp_utc: string;
    edp_price?: number;
    eap_utc: null;
    eap_status: "NOT_ESTABLISHED" | "EAP_NOT_OBSERVED";
  };
} {
  if (!forwardEpochId.trim()) throw new Error("forward epoch id is required");
  if (!Number.isFinite(Date.parse(detectedAtUtc))) throw new Error("detectedAtUtc must be an ISO timestamp");
  const detectedAtMs = Date.parse(detectedAtUtc);
  const decisionBarCloseMs = signal.detectedAt * 1_000 + TIMEFRAME_SECONDS[signal.timeframe] * 1_000 - 1;
  const decisionBarCloseUtc = new Date(decisionBarCloseMs).toISOString();
  const frozenEdpUtc = edpUtc ?? decisionBarCloseUtc;
  const edpMs = Date.parse(frozenEdpUtc);
  if (!Number.isFinite(edpMs)) throw new Error("edpUtc must be an ISO timestamp");
  if (edpMs > detectedAtMs) throw new Error("edpUtc cannot be after detectedAtUtc");
  if (frozenEdpUtc !== decisionBarCloseUtc) throw new Error("edpUtc must equal the immutable decision bar close");
  if (edpPrice !== undefined && (!Number.isFinite(edpPrice) || edpPrice <= 0)) throw new Error("edpPrice must be positive when provided");
  const identityBase = {
    source: "LIVE_FORWARD" as const,
    forward_epoch_id: forwardEpochId,
    symbol: signal.symbol.toUpperCase(),
    timeframe: signal.timeframe,
    setup: signal.setup,
    decision_bar_close_utc: decisionBarCloseUtc,
    anchor_time_utc: new Date(signal.detectedAt * 1_000).toISOString(),
    anchor_hash: signal.anchorHash,
  };
  const source_cycle_id = buildSourceCycleId(identityBase);
  const identity = {
    ...identityBase,
    source_cycle_id,
    event_id: buildEventId({ ...identityBase, source_cycle_id }),
  };
  return {
    identity,
    scanner_signal_id: signal.id,
    execution_context: {
      edp_utc: frozenEdpUtc,
      ...(edpPrice === undefined ? {} : { edp_price: edpPrice }),
      eap_utc: null,
      eap_status: eapStatus,
    },
  };
}

export function transitionTypeForTask007C(state: TrackedSignal["state"]): TransitionType {
  if (state === "CANDIDATE") return "IGNITION";
  if (state === "CONFIRMED") return "SCANNER_STATE_CHANGE";
  if (state === "ADD_CANDIDATE") return "REIGNITION";
  if (state === "TAKE_PROFIT_WATCH") return "EXHAUSTION";
  if (state === "INVALIDATED") return "INVALIDATED";
  if (state === "EXPIRED") return "TERMINAL";
  return "SCANNER_STATE_CHANGE";
}
