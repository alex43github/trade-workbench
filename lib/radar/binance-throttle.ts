export type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function retryDelayMs(attempt: number, baseMs = 1_000) {
  return Math.min(8_000, baseMs * (2 ** Math.max(0, attempt - 1)));
}

export class BinanceRequestPacer {
  #nextAllowedAt = 0;
  #scheduleTail = Promise.resolve();
  readonly minIntervalMs: number;
  readonly sleep: Sleep;

  constructor({ minIntervalMs = 150, sleep = defaultSleep }: { minIntervalMs?: number; sleep?: Sleep } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.sleep = sleep;
  }

  run<T>(task: () => Promise<T>) {
    let resolveResult: (value: T | PromiseLike<T>) => void;
    let rejectResult: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const scheduled = this.#scheduleTail.then(async () => {
      try {
        const wait = Math.max(0, this.#nextAllowedAt - Date.now());
        if (wait) await this.sleep(wait);
        this.#nextAllowedAt = Date.now() + this.minIntervalMs;
        void Promise.resolve().then(task).then(resolveResult, rejectResult);
      } catch (error) {
        rejectResult(error);
      }
    });
    this.#scheduleTail = scheduled.then(() => undefined, () => undefined);
    return result;
  }
}

export async function withRetries<T>(task: () => Promise<T>, options: { attempts?: number; sleep?: Sleep } = {}) {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(retryDelayMs(attempt));
    }
  }
  throw new Error("unreachable");
}
