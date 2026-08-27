import { ensureTelegramSchema } from "../../db/ensure.ts";
import { getD1 } from "../../db/index.ts";
import type { TelegramConversation } from "./contracts.ts";

type Row = Record<string, unknown>;
type RunResult = { meta?: { changes?: number } };

function changes(result: unknown) {
  return Number((result as RunResult | undefined)?.meta?.changes ?? 0);
}

function safeUserId(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) throw new Error("Telegram 用户信息不正确");
  return value;
}

function safeNonce(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new Error("确认编号不正确");
  return value;
}

function isExpired(value: string) {
  const time = Date.parse(value);
  return !Number.isFinite(time) || time <= Date.now();
}

function conversation(row: Row | null): TelegramConversation | null {
  if (!row) return null;
  const expiresAt = String(row.expires_at || "");
  if (isExpired(expiresAt)) return null;
  try {
    const draft = JSON.parse(String(row.draft_json || "{}"));
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
    return {
      id: String(row.id), userId: String(row.user_id), version: Number(row.version),
      step: String(row.step) as TelegramConversation["step"], draft: draft as Record<string, unknown>,
      confirmNonce: row.confirm_nonce === null || row.confirm_nonce === undefined ? null : String(row.confirm_nonce), expiresAt,
    };
  } catch { return null; }
}

export async function claimTelegramUpdate(updateId: number) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error("Telegram 更新编号不正确");
  await ensureTelegramSchema();
  const result = await (await getD1()).prepare("INSERT OR IGNORE INTO telegram_updates (update_id) VALUES (?)").bind(updateId).run();
  return changes(result) === 1;
}

export async function loadConversation(userId: string) {
  const id = safeUserId(userId);
  await ensureTelegramSchema();
  const row = await (await getD1()).prepare("SELECT * FROM telegram_conversations WHERE user_id = ? LIMIT 1").bind(id).first<Row>();
  return conversation(row);
}

export async function saveConversation(session: TelegramConversation, expectedVersion: number) {
  const userId = safeUserId(session.userId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || session.version !== expectedVersion) throw new Error("会话版本冲突，请重新操作");
  await ensureTelegramSchema();
  const db = await getD1();
  const result = await db.prepare(`INSERT INTO telegram_conversations
    (user_id, id, version, step, draft_json, confirm_nonce, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, version = telegram_conversations.version + 1,
      step = excluded.step, draft_json = excluded.draft_json, confirm_nonce = excluded.confirm_nonce,
      expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_conversations.version = ?
      OR (? = 0 AND julianday(telegram_conversations.expires_at) <= julianday(CURRENT_TIMESTAMP))`)
    .bind(userId, session.id, expectedVersion + 1, session.step, JSON.stringify(session.draft), session.confirmNonce, session.expiresAt, expectedVersion, expectedVersion).run();
  if (changes(result) !== 1) throw new Error("会话版本冲突，请重新操作");
  if (session.confirmNonce) {
    const nonce = safeNonce(session.confirmNonce);
    await db.prepare("INSERT OR IGNORE INTO telegram_actions (id, nonce, user_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(`telegram-action:${userId}:${nonce}`, nonce, userId, session.expiresAt).run();
  }
  return { ...session, userId, version: expectedVersion + 1 };
}

export async function consumeConfirmation(userId: string, nonce: string) {
  const safeUser = safeUserId(userId);
  const safe = safeNonce(nonce);
  await ensureTelegramSchema();
  const db = await getD1();
  const current = conversation(await db.prepare("SELECT * FROM telegram_conversations WHERE user_id = ? LIMIT 1").bind(safeUser).first<Row>());
  if (!current || current.confirmNonce !== safe) return null;
  const result = await db.prepare(`UPDATE telegram_actions SET used_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND nonce = ? AND used_at IS NULL AND julianday(expires_at) > julianday(CURRENT_TIMESTAMP)`)
    .bind(safeUser, safe).run();
  if (changes(result) !== 1) return null;
  const conversationUpdate = await db.prepare(`UPDATE telegram_conversations SET confirm_nonce = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND confirm_nonce = ? AND julianday(expires_at) > julianday(CURRENT_TIMESTAMP)
    `).bind(safeUser, safe).run();
  if (changes(conversationUpdate) !== 1) return null;
  return { ...current, version: current.version + 1, confirmNonce: null };
}

export async function appendTelegramAudit(input: { userId: string; action: string; strategyId?: string; outcome: "ACCEPTED" | "REJECTED" | "DUPLICATE" }) {
  const userId = safeUserId(input.userId);
  if (!/^[A-Z_]{1,64}$/.test(input.action) || !["ACCEPTED", "REJECTED", "DUPLICATE"].includes(input.outcome)) throw new Error("Telegram 审计格式不正确");
  if (input.strategyId !== undefined && !/^TW-[A-Z0-9-]{1,120}$/.test(input.strategyId)) throw new Error("策略编号不正确");
  await ensureTelegramSchema();
  await (await getD1()).prepare(`INSERT INTO telegram_audit_events (id, user_id, action, strategy_id, outcome)
    VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), userId, input.action, input.strategyId ?? null, input.outcome).run();
}
