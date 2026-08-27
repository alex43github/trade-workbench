import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";
import { getLocalD1 } from "../lib/local-d1.ts";

export async function getD1() {
  try {
    const { env } = await import("cloudflare:workers");
    if (env?.DB) return env.DB;
  } catch {
    // 纯 Node 生产模式（vinext start）没有 cloudflare: 加载器，
    // 回退到本地 SQLite，保证本地测试全功能可用。
  }
  return getLocalD1() as unknown as D1Database;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
}
