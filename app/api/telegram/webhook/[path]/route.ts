import { parseTelegramUpdate } from "../../../../../lib/telegram/contracts.ts";
import { createTelegramClient } from "../../../../../lib/telegram/client.ts";
import { handleAuthorizedTelegramUpdate } from "../../../../../lib/telegram/handler-production.ts";
import { claimTelegramUpdate, releaseTelegramUpdate } from "../../../../../lib/telegram/store.ts";
import { telegramWebhookErrorDiagnostic, type TelegramWebhookStage } from "../../../../../lib/telegram/webhook-diagnostics.ts";

function safeEqual(expected: string | undefined, actual: string | null) {
  if (!expected || !actual) return false;
  let difference = expected.length ^ actual.length;
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function denied() {
  return Response.json({ error: "Telegram webhook unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ path: string }> }) {
  const { path } = await context.params;
  if (!safeEqual(process.env.TELEGRAM_WEBHOOK_PATH, path)
    || !safeEqual(process.env.TELEGRAM_WEBHOOK_SECRET, request.headers.get("x-telegram-bot-api-secret-token"))) return denied();
  let claimedUpdateId: number | null = null;
  let stage: TelegramWebhookStage = "parse";
  try {
    stage = "parse";
    const update = parseTelegramUpdate(await request.json());
    if (!safeEqual(process.env.TELEGRAM_ALLOWED_USER_ID, update.userId)) return denied();

    stage = "claim";
    const claimed = await claimTelegramUpdate(update.updateId);
    if (claimed) claimedUpdateId = update.updateId;
    if (claimed && process.env.TELEGRAM_BOT_TOKEN) {
      stage = "handler";
      const reply = await handleAuthorizedTelegramUpdate(update);
      const client = createTelegramClient(process.env.TELEGRAM_BOT_TOKEN);

      if (update.callbackQueryId) {
        stage = "answer_callback";
        await client.answerCallbackQuery(update.callbackQueryId);
      }

      stage = "send_message";
      await client.sendMessage({
        chatId: update.chatId,
        text: reply.text,
        replyMarkup: reply.replyMarkup,
      });
    }
    return Response.json({ ok: true, duplicate: !claimed }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (claimedUpdateId !== null) await releaseTelegramUpdate(claimedUpdateId).catch(() => undefined);
    console.error("Telegram webhook processing failed", {
      updateId: claimedUpdateId,
      ...telegramWebhookErrorDiagnostic(error, stage),
    });
    return Response.json({ error: "Telegram webhook unavailable" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
