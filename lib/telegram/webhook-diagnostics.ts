export type TelegramWebhookStage =
  | "parse"
  | "claim"
  | "handler"
  | "answer_callback"
  | "send_message";

function sanitizedMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || "unknown error");
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

export function telegramWebhookErrorDiagnostic(error: unknown, stage: TelegramWebhookStage) {
  return {
    stage,
    name: error instanceof Error ? error.name : "unknown",
    message: sanitizedMessage(error),
  };
}
