import { MilightHubUnreachableError } from '@milight-studio/milight-client';
import type { ServerEvent } from '@milight-studio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeClock, FakeHub } from '../../tests/helpers/support.js';
import { EventBus } from './event-bus.js';
import { HubMonitor } from './hub-monitor.js';

interface Setup {
  hub: FakeHub;
  clock: FakeClock;
  monitor: HubMonitor;
  emitted: ServerEvent[];
}

function setup(intervalMs?: number): Setup {
  const hub = new FakeHub();
  const clock = new FakeClock();
  const events = new EventBus();
  const emitted: ServerEvent[] = [];
  events.subscribe((event) => emitted.push(event));

  const monitor = new HubMonitor({
    hub: hub.client,
    events,
    clock,
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });

  return { hub, clock, monitor, emitted };
}

describe('HubMonitor.check', () => {
  it('starts out believing the hub is unreachable', () => {
    expect(setup().monitor.status).toEqual({ reachable: false, version: null, checkedAt: null });
  });

  it('reports the firmware version on a successful probe', async () => {
    const { hub, clock, monitor, emitted } = setup();
    hub.aboutPayload = { firmware: '1.11.0' };

    const status = await monitor.check();

    expect(status).toEqual({ reachable: true, version: '1.11.0', checkedAt: clock.iso() });
    expect(monitor.status).toEqual(status);
    expect(emitted).toEqual([
      { type: 'hub.status', reachable: true, version: '1.11.0', checkedAt: clock.iso() },
    ]);
  });

  it('falls back to the `version` field when there is no firmware field', async () => {
    const { hub, monitor } = setup();
    hub.aboutPayload = { version: '2.0.0' };
    expect((await monitor.check()).version).toBe('2.0.0');
  });

  it('prefers firmware over version', async () => {
    const { hub, monitor } = setup();
    hub.aboutPayload = { firmware: '1.11.0', version: '2.0.0' };
    expect((await monitor.check()).version).toBe('1.11.0');
  });

  it('reports a null version when the hub answers without one', async () => {
    const { hub, monitor } = setup();
    hub.aboutPayload = {};
    expect(await monitor.check()).toMatchObject({ reachable: true, version: null });
  });

  it('reports unreachable when the probe fails, without throwing', async () => {
    const { hub, clock, monitor, emitted } = setup();
    hub.failWith = new MilightHubUnreachableError('down');

    await expect(monitor.check()).resolves.toEqual({
      reachable: false,
      version: null,
      checkedAt: clock.iso(),
    });
    expect(emitted).toEqual([]);
  });

  it('only emits when reachability actually flips', async () => {
    const { hub, monitor, emitted } = setup();

    await monitor.check();
    await monitor.check();
    await monitor.check();
    expect(emitted).toHaveLength(1);

    hub.failWith = new MilightHubUnreachableError('down');
    await monitor.check();
    await monitor.check();
    expect(emitted).toHaveLength(2);
    expect(emitted.at(-1)).toMatchObject({ type: 'hub.status', reachable: false });

    hub.failWith = null;
    await monitor.check();
    expect(emitted).toHaveLength(3);
    expect(emitted.at(-1)).toMatchObject({ type: 'hub.status', reachable: true });
  });

  it('also emits when only the version changed', async () => {
    const { hub, monitor, emitted } = setup();
    await monitor.check();

    hub.aboutPayload = { firmware: '1.12.0' };
    await monitor.check();

    expect(emitted).toHaveLength(2);
    expect(emitted.at(-1)).toMatchObject({ reachable: true, version: '1.12.0' });
  });

  it('stamps checkedAt from the injected clock even when nothing changed', async () => {
    const { clock, monitor } = setup();
    await monitor.check();

    clock.advance(30_000);
    expect((await monitor.check()).checkedAt).toBe(clock.iso());
  });
});

describe('HubMonitor.start / stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('probes immediately and then on every interval', async () => {
    const { hub, monitor } = setup(30_000);

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hub.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(hub.calls).toHaveLength(5);

    monitor.stop();
  });

  it('is idempotent: starting twice does not double the polling', async () => {
    const { hub, monitor } = setup(30_000);

    monitor.start();
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hub.calls).toHaveLength(2);

    monitor.stop();
  });

  it('stops polling on stop and tolerates stopping twice', async () => {
    const { hub, monitor } = setup(1000);

    monitor.start();
    await vi.advanceTimersByTimeAsync(1000);
    const seen = hub.calls.length;

    monitor.stop();
    monitor.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(hub.calls).toHaveLength(seen);
  });

  it('can be restarted after being stopped', async () => {
    const { hub, monitor } = setup(1000);

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    monitor.stop();

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.calls).toHaveLength(2);

    monitor.stop();
  });

  it('does nothing at all when the interval is zero', async () => {
    const { hub, monitor } = setup(0);

    monitor.start();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(hub.calls).toEqual([]);
    expect(monitor.status.checkedAt).toBeNull();
    monitor.stop();
  });

  it('stopping a monitor that never started is harmless', () => {
    expect(() => {
      setup(0).monitor.stop();
    }).not.toThrow();
  });

  it('defaults to a thirty second interval', async () => {
    const { hub, monitor } = setup();

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(hub.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(hub.calls).toHaveLength(2);

    monitor.stop();
  });
});
