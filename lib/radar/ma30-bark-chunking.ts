import type { RadarBarkGroup } from "./bark-notifications.ts";

/**
 * Keep individual Bark bodies comfortably below URL-size trouble after UTF-8
 * text is percent-encoded into Bark's GET path. The database still retains the
 * complete scanner state; this limit only affects transport presentation.
 */
export const MA30_BARK_MAX_BODY_UTF8_BYTES = 900;

const encoder = new TextEncoder();

function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

function chooseSeparator(body: string): "\n" | "｜" | null {
  if (body.includes("\n")) return "\n";
  if (body.includes("｜")) return "｜";
  return null;
}

function splitOversizedItem(item: string, maxBytes: number): string[] {
  if (utf8Bytes(item) <= maxBytes) return [item];
  const pieces: string[] = [];
  let current = "";
  for (const char of item) {
    const candidate = current + char;
    if (current && utf8Bytes(candidate) > maxBytes) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Split one logical notification into transport-safe parts. Small messages are
 * returned byte-for-byte unchanged. Multi-part messages receive unique dedupe
 * keys and explicit x/N title suffixes so Bark retries remain idempotent.
 */
export function chunkMa30BarkGroup(
  group: RadarBarkGroup,
  maxBodyBytes = MA30_BARK_MAX_BODY_UTF8_BYTES,
): RadarBarkGroup[] {
  const limit = Math.max(128, Math.floor(maxBodyBytes));
  if (utf8Bytes(group.body) <= limit) return [group];

  const separator = chooseSeparator(group.body);
  if (!separator) {
    const pieces = splitOversizedItem(group.body, limit);
    return pieces.map((body, index) => ({
      key: `${group.key}:part:${index + 1}-of-${pieces.length}`,
      title: `${group.title} (${index + 1}/${pieces.length})`,
      body,
    }));
  }

  const rawItems = group.body.split(separator);
  const items = rawItems.flatMap((item) => splitOversizedItem(item, limit));
  const bodies: string[] = [];
  let current = "";

  for (const item of items) {
    const candidate = current ? `${current}${separator}${item}` : item;
    if (current && utf8Bytes(candidate) > limit) {
      bodies.push(current);
      current = item;
    } else {
      current = candidate;
    }
  }
  if (current) bodies.push(current);

  return bodies.map((body, index) => ({
    key: `${group.key}:part:${index + 1}-of-${bodies.length}`,
    title: `${group.title} (${index + 1}/${bodies.length})`,
    body,
  }));
}
