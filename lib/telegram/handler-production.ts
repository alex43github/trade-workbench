import { loadConversation } from "./store.ts";
import {
  handleAuthorizedTelegramUpdate as handleV2,
  type TelegramHandlerV2Dependencies,
} from "./handler-v2.ts";

type AuthorizedUpdate = {
  updateId: number;
  kind: "MESSAGE" | "CALLBACK";
  userId: string;
  chatId: string;
  text?: string;
  callbackData?: string;
  callbackQueryId?: string;
};

function pmSnapshot(session: Awaited<ReturnType<typeof loadConversation>>) {
  const value = session?.draft?.pm;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.ids) || raw.ids.some((id) => typeof id !== "string")) return null;
  return {
    ids: raw.ids as string[],
    selectedId: typeof raw.selectedId === "string" ? raw.selectedId : undefined,
    mode: typeof raw.mode === "string" ? raw.mode : undefined,
  };
}

async function currentSession(dependencies: TelegramHandlerV2Dependencies, userId: string) {
  return (dependencies.loadConversation ?? loadConversation)(userId);
}

function rewriteBackButton(reply: Awaited<ReturnType<typeof handleV2>>, enabled: boolean) {
  if (!enabled || !("inline_keyboard" in reply.replyMarkup) || !reply.replyMarkup.inline_keyboard) return reply;
  return {
    ...reply,
    replyMarkup: {
      ...reply.replyMarkup,
      inline_keyboard: reply.replyMarkup.inline_keyboard.map((row) => row.map((button) =>
        button.callback_data === "tg:act:pm_item_0_01"
          ? { ...button, callback_data: "tg:act:pm_back_detail_01" }
          : button,
      )),
    },
  };
}

/**
 * Thin final router around the V2 handler.
 *
 * V2 intentionally keeps its management state canonical under draft.pm. This
 * adapter makes the detail-back callback refer to the selected strategy rather
 * than a volatile list index, so stale/reordered lists cannot send the user to
 * item zero by accident.
 */
export async function handleAuthorizedTelegramUpdate(
  update: AuthorizedUpdate,
  dependencies: TelegramHandlerV2Dependencies = {},
) {
  if (update.kind === "CALLBACK" && update.callbackData === "tg:act:pm_back_detail_01") {
    const snapshot = pmSnapshot(await currentSession(dependencies, update.userId));
    const index = snapshot?.selectedId ? snapshot.ids.indexOf(snapshot.selectedId) : -1;
    const callbackData = index >= 0 ? `tg:act:pm_item_${index}_01` : "tg:act:pm_refresh_01";
    return handleV2({ ...update, callbackData }, dependencies);
  }

  const reply = await handleV2(update, dependencies);
  const snapshot = pmSnapshot(await currentSession(dependencies, update.userId));
  return rewriteBackButton(reply, snapshot?.mode === "LEVEL_PRICE" && Boolean(snapshot.selectedId));
}

export type { TelegramHandlerV2Dependencies as TelegramHandlerDependencies };
