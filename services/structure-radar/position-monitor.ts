import { classifyPosition } from "../../lib/structure-radar/position-state.ts";

type RawPosition = Record<string, unknown>;
type PositionClient = { getPositions(): Promise<unknown> };

export class PositionMonitor {
  readonly #client: PositionClient;
  readonly #now: () => number;
  readonly #maxAgeSeconds: number;
  readonly #firstSeen = new Map<string, number>();
  #positions: Array<{ symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; markPrice: number; firstSeenAt: number }> = [];
  #observedAt = 0;
  #connected = false;
  #initialPoll = true;

  constructor(options: { client?: PositionClient; getPositions?: () => Promise<unknown>; now?: () => number; maxAgeSeconds?: number }) {
    this.#client = options.client ?? { getPositions: options.getPositions ?? (async () => []) };
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#maxAgeSeconds = options.maxAgeSeconds ?? 90;
  }

  async poll() {
    const now = this.#now();
    try {
      const payload = await this.#client.getPositions();
      const values = Array.isArray(payload) ? payload.filter((item): item is RawPosition => Boolean(item) && typeof item === "object") : [];
      this.#positions = values.filter((item) => Math.abs(Number(item.positionAmt)) > 0).map((item) => {
        const symbol = String(item.symbol).toUpperCase();
        if (!this.#firstSeen.has(symbol)) this.#firstSeen.set(symbol, this.#initialPoll ? 0 : now);
        return {
          symbol,
          side: Number(item.positionAmt) >= 0 ? "LONG" as const : "SHORT" as const,
          quantity: Math.abs(Number(item.positionAmt)),
          entryPrice: Number(item.entryPrice),
          markPrice: Number(item.markPrice),
          firstSeenAt: this.#firstSeen.get(symbol)!,
        };
      });
      this.#connected = true;
      this.#observedAt = now;
    } catch {
      this.#connected = false;
      this.#observedAt = now;
    } finally {
      this.#initialPoll = false;
    }
  }

  classify(signal: { symbol: string; direction: "LONG" | "SHORT"; candidateAt: number; confirmedAt?: number | null }) {
    const result = classifyPosition(signal, {
      connected: this.#connected,
      observedAt: this.#observedAt,
      positions: this.#positions,
    }, this.#now(), this.#maxAgeSeconds);
    return { ...result, ...(result.position ?? {}) };
  }
}
