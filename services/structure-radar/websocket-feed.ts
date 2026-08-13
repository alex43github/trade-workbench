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
  onEvent: (value: unknown) => Promise<void> | void;
  onStatus?: (status: { batch: number; state: "connecting" | "open" | "closed" | "error"; attempt: number }) => void;
};

export function reconnectDelay(attempt: number) {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
}

export class KlineWebSocketFeed {
  readonly #options: FeedOptions;
  readonly #sockets = new Map<number, SocketLike>();
  readonly #timers = new Map<number, unknown>();
  readonly #attempts = new Map<number, number>();
  #running = false;

  constructor(options: FeedOptions) {
    this.#options = options;
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
      this.#attempts.set(batchIndex, 0);
      this.#options.onStatus?.({ batch: batchIndex, state: "open", attempt });
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = event && typeof event === "object" && "data" in event ? event.data : event;
        const value = typeof data === "string" ? JSON.parse(data) : data;
        void this.#options.onEvent(value);
      } catch {
        this.#options.onStatus?.({ batch: batchIndex, state: "error", attempt });
      }
    });
    const reconnect = () => {
      if (!this.#running || this.#timers.has(batchIndex)) return;
      this.#sockets.delete(batchIndex);
      this.#options.onStatus?.({ batch: batchIndex, state: "closed", attempt });
      const nextAttempt = attempt + 1;
      this.#attempts.set(batchIndex, nextAttempt);
      const schedule = this.#options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
      const handle = schedule(() => {
        this.#timers.delete(batchIndex);
        this.#connect(batchIndex);
      }, reconnectDelay(attempt));
      this.#timers.set(batchIndex, handle);
    };
    socket.addEventListener("close", reconnect);
    socket.addEventListener("error", () => this.#options.onStatus?.({ batch: batchIndex, state: "error", attempt }));
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#options.batches.forEach((_, index) => this.#connect(index));
  }

  stop() {
    this.#running = false;
    const cancel = this.#options.cancelSchedule ?? clearTimeout;
    for (const handle of this.#timers.values()) cancel(handle as never);
    this.#timers.clear();
    for (const socket of this.#sockets.values()) socket.close();
    this.#sockets.clear();
  }
}
