import { BINANCE_FUTURES_STREAM } from "./config.ts";

type SocketLike = {
  addEventListener(type: "open" | "message" | "close" | "error", callback: (event: unknown) => void): void;
  close(): void;
};

type FeedOptions = {
  batches: readonly (readonly string[])[];
  socketFactory?: (url: string) => SocketLike;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  now?: () => number;
  staleAfterMs?: number;
  onEvent: (value: unknown) => Promise<void> | void;
  onStatus?: (status: { batch: number; state: "connecting" | "open" | "closed" | "error"; attempt: number }) => void;
  onActivity?: (activity: { batch: number; at: number }) => void;
};

// Combined kline batches should receive updates continuously during normal
// futures trading. Ninety seconds leaves room for transient network jitter
// while bounding a silently-open connection well below an hourly scan cycle.
export const FEED_STALE_AFTER_MS = 90_000;

export function reconnectDelay(attempt: number) {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
}

export class KlineWebSocketFeed {
  readonly #options: FeedOptions;
  readonly #sockets = new Map<number, SocketLike>();
  readonly #reconnectTimers = new Map<number, unknown>();
  readonly #watchdogTimers = new Map<number, unknown>();
  readonly #attempts = new Map<number, number>();
  readonly #messageQueues = new Map<number, Promise<void>>();
  #running = false;

  constructor(options: FeedOptions) {
    this.#options = options;
  }

  #cancelWatchdog(batchIndex: number) {
    const handle = this.#watchdogTimers.get(batchIndex);
    if (handle === undefined) return;
    (this.#options.cancelSchedule ?? clearTimeout)(handle as never);
    this.#watchdogTimers.delete(batchIndex);
  }

  #armWatchdog(batchIndex: number, socket: SocketLike) {
    this.#cancelWatchdog(batchIndex);
    const schedule = this.#options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    const staleAfterMs = this.#options.staleAfterMs ?? FEED_STALE_AFTER_MS;
    const handle = schedule(() => {
      this.#watchdogTimers.delete(batchIndex);
      this.#recover(batchIndex, socket);
    }, staleAfterMs);
    this.#watchdogTimers.set(batchIndex, handle);
  }

  #recover(batchIndex: number, socket: SocketLike) {
    if (!this.#running || this.#sockets.get(batchIndex) !== socket || this.#reconnectTimers.has(batchIndex)) return;
    this.#cancelWatchdog(batchIndex);
    this.#sockets.delete(batchIndex);
    socket.close();
    const attempt = this.#attempts.get(batchIndex) ?? 0;
    this.#options.onStatus?.({ batch: batchIndex, state: "closed", attempt });
    this.#attempts.set(batchIndex, attempt + 1);
    const schedule = this.#options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    const handle = schedule(() => {
      this.#reconnectTimers.delete(batchIndex);
      this.#connect(batchIndex);
    }, reconnectDelay(attempt));
    this.#reconnectTimers.set(batchIndex, handle);
  }

  #connect(batchIndex: number) {
    if (!this.#running) return;
    const streams = this.#options.batches[batchIndex];
    if (!streams || streams.length === 0) return;
    const attempt = this.#attempts.get(batchIndex) ?? 0;
    this.#options.onStatus?.({ batch: batchIndex, state: "connecting", attempt });
    const createSocket = this.#options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = createSocket(`${BINANCE_FUTURES_STREAM}?streams=${streams.join("/")}`);
    this.#sockets.set(batchIndex, socket);
    socket.addEventListener("open", () => {
      if (this.#sockets.get(batchIndex) !== socket) return;
      this.#attempts.set(batchIndex, 0);
      this.#options.onStatus?.({ batch: batchIndex, state: "open", attempt });
      this.#armWatchdog(batchIndex, socket);
    });
    socket.addEventListener("message", (event) => {
      if (this.#sockets.get(batchIndex) !== socket) return;
      try {
        const data = event && typeof event === "object" && "data" in event ? event.data : event;
        const value = typeof data === "string" ? JSON.parse(data) : data;
        this.#options.onActivity?.({ batch: batchIndex, at: (this.#options.now ?? Date.now)() });
        this.#armWatchdog(batchIndex, socket);
        const queued = (this.#messageQueues.get(batchIndex) ?? Promise.resolve())
          .then(() => this.#options.onEvent(value))
          .catch(() => this.#options.onStatus?.({ batch: batchIndex, state: "error", attempt }));
        this.#messageQueues.set(batchIndex, queued.then(() => undefined));
      } catch {
        this.#options.onStatus?.({ batch: batchIndex, state: "error", attempt });
      }
    });
    socket.addEventListener("close", () => this.#recover(batchIndex, socket));
    socket.addEventListener("error", () => {
      if (this.#sockets.get(batchIndex) !== socket) return;
      this.#options.onStatus?.({ batch: batchIndex, state: "error", attempt: this.#attempts.get(batchIndex) ?? attempt });
      this.#recover(batchIndex, socket);
    });
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#options.batches.forEach((_, index) => this.#connect(index));
  }

  stop() {
    this.#running = false;
    const cancel = this.#options.cancelSchedule ?? clearTimeout;
    for (const handle of this.#reconnectTimers.values()) cancel(handle as never);
    this.#reconnectTimers.clear();
    for (const handle of this.#watchdogTimers.values()) cancel(handle as never);
    this.#watchdogTimers.clear();
    for (const socket of this.#sockets.values()) socket.close();
    this.#sockets.clear();
    this.#messageQueues.clear();
  }
}
