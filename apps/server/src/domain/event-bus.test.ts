import type { ServerEvent } from '@milight-studio/shared';
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './event-bus.js';

const hello: ServerEvent = { type: 'hello', serverTime: '2024-01-01T00:00:00.000Z', version: '1.0.0' };
const deleted: ServerEvent = { type: 'light.deleted', lightId: 'abc' };

describe('EventBus', () => {
  it('delivers an event to every subscriber', () => {
    const bus = new EventBus();
    const first: ServerEvent[] = [];
    const second: ServerEvent[] = [];

    bus.subscribe((event) => first.push(event));
    bus.subscribe((event) => second.push(event));
    bus.emit(hello);

    expect(first).toEqual([hello]);
    expect(second).toEqual([hello]);
  });

  it('stops delivering after the returned unsubscribe is called', () => {
    const bus = new EventBus();
    const received: ServerEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.emit(hello);
    unsubscribe();
    bus.emit(deleted);

    expect(received).toEqual([hello]);
  });

  it('tolerates unsubscribing twice', () => {
    const bus = new EventBus();
    const unsubscribe = bus.subscribe(() => undefined);
    unsubscribe();
    expect(() => {
      unsubscribe();
    }).not.toThrow();
    expect(bus.listenerCount).toBe(0);
  });

  it('registers the same listener only once', () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.subscribe(listener);
    bus.subscribe(listener);
    expect(bus.listenerCount).toBe(1);

    bus.emit(hello);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports the listener count as listeners come and go', () => {
    const bus = new EventBus();
    expect(bus.listenerCount).toBe(0);

    const stopA = bus.subscribe(() => undefined);
    const stopB = bus.subscribe(() => undefined);
    expect(bus.listenerCount).toBe(2);

    stopA();
    expect(bus.listenerCount).toBe(1);
    stopB();
    expect(bus.listenerCount).toBe(0);
  });

  it('keeps delivering to the other listeners when one throws, and reports it', () => {
    const errors: unknown[] = [];
    const bus = new EventBus((error) => errors.push(error));
    const before: ServerEvent[] = [];
    const after: ServerEvent[] = [];
    const failure = new Error('listener exploded');

    bus.subscribe((event) => before.push(event));
    bus.subscribe(() => {
      throw failure;
    });
    bus.subscribe((event) => after.push(event));

    expect(() => {
      bus.emit(hello);
    }).not.toThrow();

    expect(before).toEqual([hello]);
    expect(after).toEqual([hello]);
    expect(errors).toEqual([failure]);
  });

  it('keeps a throwing listener subscribed for the next event', () => {
    const errors: unknown[] = [];
    const bus = new EventBus((error) => errors.push(error));
    bus.subscribe(() => {
      throw new Error('always');
    });

    bus.emit(hello);
    bus.emit(deleted);
    expect(errors).toHaveLength(2);
  });

  it('swallows a listener failure when no error handler was given', () => {
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error('quiet');
    });
    expect(() => {
      bus.emit(hello);
    }).not.toThrow();
  });

  it('is unaffected by a listener that unsubscribes during delivery', () => {
    const bus = new EventBus();
    const received: ServerEvent[] = [];

    const stop = bus.subscribe(() => {
      stop();
    });
    bus.subscribe((event) => received.push(event));

    bus.emit(hello);
    expect(received).toEqual([hello]);
    expect(bus.listenerCount).toBe(1);

    bus.emit(deleted);
    expect(received).toEqual([hello, deleted]);
  });

  it('does not deliver to a listener added while an event is being delivered', () => {
    const bus = new EventBus();
    const late: ServerEvent[] = [];

    bus.subscribe(() => {
      bus.subscribe((event) => late.push(event));
    });

    bus.emit(hello);
    expect(late).toEqual([]);

    bus.emit(deleted);
    expect(late).toEqual([deleted]);
  });

  it('drops every listener on clear', () => {
    const bus = new EventBus();
    const received: ServerEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.clear();
    bus.emit(hello);

    expect(bus.listenerCount).toBe(0);
    expect(received).toEqual([]);
  });

  it('emits to nobody without complaining', () => {
    expect(() => {
      new EventBus().emit(hello);
    }).not.toThrow();
  });
});
