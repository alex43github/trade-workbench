export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramReplyKeyboardMarkup = {
  keyboard: Array<Array<{ text: string }>>;
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;

export type TelegramMessage = {
  chatId: string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

type FetchLike = typeof fetch;

function validateToken(value: string) {
  if (!/^\d{6,20}:[A-Za-z0-9_-]{20,128}$/.test(value)) throw new Error("Telegram Bot Token 配置格式不正确");
  return value;
}

function validateMessage(message: TelegramMessage) {
  if (!/^\d{1,20}$/.test(message.chatId) || !message.text.trim() || message.text.length > 4_000) throw new Error("Telegram 消息格式不正确");
}

export function createTelegramClient(token: string, fetchImpl: FetchLike = fetch) {
  const safeToken = validateToken(token);
  async function call(method: string, payload: Record<string, unknown>) {
    const response = await fetchImpl(`https://api.telegram.org/bot${safeToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Telegram 消息发送失败");
  }
  return {
    async sendMessage(message: TelegramMessage) {
      validateMessage(message);
      await call("sendMessage", { chat_id: message.chatId, text: message.text, reply_markup: message.replyMarkup });
    },
    async answerCallbackQuery(callbackQueryId: string) {
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(callbackQueryId)) throw new Error("Telegram 回调编号不正确");
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId });
    },
  };
}
