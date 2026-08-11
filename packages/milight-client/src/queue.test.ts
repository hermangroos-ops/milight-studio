import { describe, expect, it } from 'vitest';

import { QueueOverflowError, SerialQueue } from './queue.js';

interface Gate {
  promise: Promise<void>;
  open: () => void;
  fail: (error: Error) => void;
}

/** A promise a test can settle by hand, without a timer in sight. */
function gate(): Gate {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = () => {
      resolve();
    };
    fail = reject;
  });
  return { promise, open, fail };
}

/** A fake clock whose only source of elapsed time is the queue's own sleeping. */
function fakeTimers(startAt = 10_000): {
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
  now: () => number;
} {
  const sleeps: number[] = [];
  let time = startAt;
  return {
    sleeps,
    now: () => time,
    sleep: (ms: number) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

describe('SerialQueue', () => {
  it('runs tasks in strict FIFO order', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        queue.run(async () => {
          await Promise.resolve();
          order.push(n);
          return n * 2;
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never lets two tasks overlap', async () => {
    const queue = new SerialQueue();
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        queue.run(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // Yield several times: any concurrency would show up here.
          await Promise.resolve();
          await new Promise((resolve) => setImmediate(resolve));
          await Promise.resolve();
          inFlight -= 1;
        }),
      ),
    );

    expect(maxInFlight).toBe(1);
    expect(inFlight).toBe(0);
  });

  it('holds the next task until the whole previous one settled', async () => {
    const queue = new SerialQueue();
    const blocked = gate();
    const order: string[] = [];

    const first = queue.run(async () => {
      order.push('first:start');
      await blocked.promise;
      order.push('first:end');
    });
    const second = queue.run(() => {
      order.push('second');
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    blocked.open();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('waits out minGapMs between tasks using the injected clock', async () => {
    const timers = fakeTimers();
    const queue = new SerialQueue({ minGapMs: 40, ...timers });

    await queue.run(() => Promise.resolve('a'));
    expect(timers.sleeps).toEqual([]);

    await queue.run(() => Promise.resolve('b'));
    await queue.run(() => Promise.resolve('c'));
    expect(timers.sleeps).toEqual([40, 40]);
  });

  it('does not sleep when the gap already elapsed', async () => {
    const sleeps: number[] = [];
    let time = 10_000;
    const queue = new SerialQueue({
      minGapMs: 40,
      now: () => time,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await queue.run(() => Promise.resolve());
    time += 500;
    await queue.run(() => Promise.resolve());

    expect(sleeps).toEqual([]);
  });

  it('sleeps only for the remaining part of the gap', async () => {
    const sleeps: number[] = [];
    let time = 10_000;
    const queue = new SerialQueue({
      minGapMs: 100,
      now: () => time,
      sleep: (ms) => {
        sleeps.push(ms);
        time += ms;
        return Promise.resolve();
      },
    });

    await queue.run(() => Promise.resolve());
    time += 30;
    await queue.run(() => Promise.resolve());

    expect(sleeps).toEqual([70]);
  });

  it('never sleeps at all when minGapMs is left at its default of zero', async () => {
    const timers = fakeTimers();
    const queue = new SerialQueue(timers);

    await queue.run(() => Promise.resolve());
    await queue.run(() => Promise.resolve());

    expect(timers.sleeps).toEqual([]);
  });

  it('does not let a rejecting task poison the queue', async () => {
    const queue = new SerialQueue();
    const order: string[] = [];

    const failing = queue.run(() => {
      order.push('boom');
      return Promise.reject(new Error('boom'));
    });
    const after = queue.run(() => {
      order.push('after');
      return Promise.resolve('ok');
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
    expect(order).toEqual(['boom', 'after']);
    expect(queue.pending).toBe(0);
  });

  it('keeps running after a task throws synchronously', async () => {
    const queue = new SerialQueue();
    await expect(
      queue.run(() => {
        throw new Error('sync boom');
      }),
    ).rejects.toThrow('sync boom');
    await expect(queue.run(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('tracks the pending counter accurately', async () => {
    const queue = new SerialQueue();
    expect(queue.pending).toBe(0);

    const gates = [gate(), gate(), gate()];
    const running = gates.map((entry) => queue.run(() => entry.promise));
    expect(queue.pending).toBe(3);

    gates[0]!.open();
    await running[0];
    expect(queue.pending).toBe(2);

    gates[1]!.fail(new Error('nope'));
    await expect(running[1]).rejects.toThrow('nope');
    expect(queue.pending).toBe(1);

    gates[2]!.open();
    await running[2];
    expect(queue.pending).toBe(0);
  });

  it('rejects with QueueOverflowError once maxPending is reached', async () => {
    const queue = new SerialQueue({ maxPending: 2 });
    const blocked = gate();

    const first = queue.run(() => blocked.promise);
    const second = queue.run(() => Promise.resolve());
    expect(queue.pending).toBe(2);

    await expect(queue.run(() => Promise.resolve())).rejects.toBeInstanceOf(QueueOverflowError);
    await expect(queue.run(() => Promise.resolve())).rejects.toThrow(
      'Hub request queue is full (2 pending requests)',
    );

    blocked.open();
    await Promise.all([first, second]);

    // Once the backlog drains, new work is accepted again.
    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('does not count an overflowing call towards pending', async () => {
    const queue = new SerialQueue({ maxPending: 1 });
    const blocked = gate();
    const first = queue.run(() => blocked.promise);

    await expect(queue.run(() => Promise.resolve())).rejects.toBeInstanceOf(QueueOverflowError);
    expect(queue.pending).toBe(1);

    blocked.open();
    await first;
    expect(queue.pending).toBe(0);
  });

  it('drains an empty queue immediately', async () => {
    await expect(new SerialQueue().drain()).resolves.toBeUndefined();
  });

  it('drain resolves only once every queued task settled', async () => {
    const queue = new SerialQueue();
    const blocked = gate();
    const finished: string[] = [];

    const first = queue.run(async () => {
      await blocked.promise;
      finished.push('first');
    });
    const second = queue.run(() => {
      finished.push('second');
      return Promise.reject(new Error('second failed'));
    });
    second.catch(() => undefined);

    let drained = false;
    const draining = queue.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    blocked.open();
    await first;
    await draining;

    expect(drained).toBe(true);
    expect(finished).toEqual(['first', 'second']);
    expect(queue.pending).toBe(0);
  });
});

describe('QueueOverflowError', () => {
  it('carries a helpful name and message', () => {
    const error = new QueueOverflowError(16);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('QueueOverflowError');
    expect(error.message).toContain('16');
  });
});
