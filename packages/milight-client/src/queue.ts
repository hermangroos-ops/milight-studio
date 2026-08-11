/**
 * A strictly serial task queue with a minimum gap between tasks.
 *
 * The ESP8266 running the hub has a single-threaded web server and a radio that needs
 * a few milliseconds between packets. Firing concurrent requests at it produces dropped
 * commands and connection resets, so every hub call goes through here.
 */
export interface SerialQueueOptions {
  /** Minimum milliseconds between the end of one task and the start of the next. */
  minGapMs?: number;
  /** Reject new work once this many tasks are already waiting. */
  maxPending?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class QueueOverflowError extends Error {
  constructor(maxPending: number) {
    super(`Hub request queue is full (${maxPending} pending requests)`);
    this.name = 'QueueOverflowError';
  }
}

export class SerialQueue {
  readonly #minGapMs: number;
  readonly #maxPending: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;

  #chain: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #lastFinishedAt = 0;

  constructor(options: SerialQueueOptions = {}) {
    this.#minGapMs = options.minGapMs ?? 0;
    this.#maxPending = options.maxPending ?? 256;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
  }

  get pending(): number {
    return this.#pending;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#pending >= this.#maxPending) {
      throw new QueueOverflowError(this.#maxPending);
    }

    this.#pending += 1;

    const result = this.#chain.then(async () => {
      const waitFor = this.#minGapMs - (this.#now() - this.#lastFinishedAt);
      if (waitFor > 0) await this.#sleep(waitFor);
      try {
        return await task();
      } finally {
        this.#lastFinishedAt = this.#now();
        this.#pending -= 1;
      }
    });

    // Keep the chain alive even when a task rejects, otherwise one failure would
    // permanently poison every queued request behind it.
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  /** Resolves once everything currently queued has settled. */
  async drain(): Promise<void> {
    await this.#chain;
  }
}
