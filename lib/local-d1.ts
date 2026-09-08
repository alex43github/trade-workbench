import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * 本地 D1 兼容层：仅用于「纯 Node 生产模式」（vinext start）下没有
 * cloudflare:workers 加载器时，把 D1 落到本机 SQLite 文件。
 * 部署到 Cloudflare 后仍走真实 D1，本文件不会被触发。
 */

type Row = Record<string, unknown>;
type Params = Array<string | number | bigint | null | Uint8Array>;
type LocalResult = { success: true; meta: { changes: number; last_row_id: number } };

class LocalStatement {
  #stmt: StatementSync;
  #params: Params = [];

  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }

  bind(...args: unknown[]): this {
    this.#params = args as Params;
    return this;
  }

  async first<T = Row>(): Promise<T | null> {
    const row = this.#params.length ? this.#stmt.get(...this.#params) : this.#stmt.get();
    return (row as T) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    const rows = this.#params.length ? this.#stmt.all(...this.#params) : this.#stmt.all();
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<LocalResult> {
    return this.runSync();
  }

  runSync(): LocalResult {
    const info = this.#params.length ? this.#stmt.run(...this.#params) : this.#stmt.run();
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }
}

class LocalD1 {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.#db.prepare(sql));
  }

  async batch(statements: LocalStatement[]): Promise<LocalResult[]> {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // The original statement failure is the actionable error.
      }
      throw error;
    }
  }

  close() {
    this.#db.close();
  }
}

function findLocalDbPath(): string {
  const isolatedPath = process.env.STREETLIGHT_LOCAL_D1;
  if (isolatedPath) return isolatedPath;
  const candidates = [
    path.join(
      process.cwd(),
      ".wrangler",
      "state",
      "v3",
      "d1",
      "miniflare-D1DatabaseObject",
    ),
  ];
  for (const dir of candidates) {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".sqlite") && !name.startsWith("metadata"));
    } catch {
      continue;
    }
    if (files.length > 0) {
      // 取最新的一个数据文件，保证与 miniflare 本地状态一致。
      const sorted = files
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return path.join(dir, sorted[0].name);
    }
  }
  const fallbackDir = path.join(process.cwd(), ".local");
  fs.mkdirSync(fallbackDir, { recursive: true });
  return path.join(fallbackDir, "d1.sqlite");
}

let cached: LocalD1 | null = null;

export function getLocalD1(): LocalD1 {
  if (cached) return cached;
  const file = findLocalDbPath();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  cached = new LocalD1(db);
  return cached;
}
