import type { Ma30AiSnapshot } from "./ma30-ai-selection.ts";
import {
  ensureMa30PersistenceSchema,
  prepareMa30AiSnapshotStatements,
  type Ma30PersistenceDb,
  type Ma30PersistenceStatement,
} from "./ma30-persistence.ts";
import {
  ensureMa30RuntimePersistenceSchema,
  prepareMa30RuntimeSnapshotStatements,
  type Ma30RuntimeDb,
  type Ma30RuntimeSnapshot,
  type Ma30RuntimeStatement,
} from "./ma30-runtime-persistence.ts";

type CombinedStatement = Ma30PersistenceStatement & Ma30RuntimeStatement;
export type Ma30ProductionDb = Ma30PersistenceDb & Ma30RuntimeDb & {
  batch: (statements: CombinedStatement[]) => Promise<unknown[]>;
};

export async function ensureMa30ProductionSchema(db: Ma30PersistenceDb & Ma30RuntimeDb): Promise<void> {
  await ensureMa30RuntimePersistenceSchema(db);
  await ensureMa30PersistenceSchema(db);
}

/**
 * Atomically append all durable facts for one hourly MA30 run.
 *
 * Runtime scan, lifecycle state, immutable AI snapshot and AI selections share
 * one DB batch so a process crash cannot leave a run half-written and then make
 * the duplicate guard permanently skip the missing sibling facts.
 */
export async function appendMa30ProductionBundle(
  db: Ma30PersistenceDb & Ma30RuntimeDb,
  input: { runtimeSnapshot: Ma30RuntimeSnapshot; aiSnapshot: Ma30AiSnapshot },
): Promise<void> {
  if (input.runtimeSnapshot.runId !== input.aiSnapshot.runId) {
    throw new Error("MA30 production run_id mismatch between runtime and AI snapshot");
  }
  if (!db.batch) {
    throw new Error("MA30 production persistence requires atomic batch support");
  }

  const runtime = prepareMa30RuntimeSnapshotStatements(db, input.runtimeSnapshot);
  const ai = prepareMa30AiSnapshotStatements(db, input.aiSnapshot);
  await db.batch([...runtime, ...ai] as CombinedStatement[]);
}
