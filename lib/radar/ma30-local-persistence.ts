import { getLocalD1 } from "../local-d1.ts";
import type { Ma30AiOutcome, Ma30AiSnapshot } from "./ma30-ai-selection.ts";
import {
  appendMa30AiOutcome,
  appendMa30AiSnapshot,
  ensureMa30PersistenceSchema,
  type Ma30PersistenceDb,
} from "./ma30-persistence.ts";

function db(): Ma30PersistenceDb {
  // LocalD1 deliberately mirrors the subset of D1 used by the app. Keep this adapter
  // tiny so the scanner shares the same VPS SQLite instead of inventing a second store.
  return getLocalD1() as unknown as Ma30PersistenceDb;
}

export async function persistMa30AiSnapshot(snapshot: Ma30AiSnapshot): Promise<void> {
  const store = db();
  await ensureMa30PersistenceSchema(store);
  await appendMa30AiSnapshot(store, snapshot);
}

export async function persistMa30AiOutcome(outcome: Ma30AiOutcome): Promise<void> {
  const store = db();
  await ensureMa30PersistenceSchema(store);
  await appendMa30AiOutcome(store, outcome);
}
