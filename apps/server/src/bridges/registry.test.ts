import type { BridgeStatus } from '@milight-studio/shared';
import { describe, expect, it, vi } from 'vitest';

import { BridgeRegistry } from './registry.js';
import { notAnError } from '../../tests/helpers/support.js';
import { noopLogger, type BridgeLogger, type VoiceBridge } from './types.js';

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

function recordingLogger(): { logger: BridgeLogger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const push =
    (level: LogEntry['level']) =>
    (message: string, context?: Record<string, unknown>): void => {
      entries.push({ level, message, ...(context === undefined ? {} : { context }) });
    };
  return { entries, logger: { info: push('info'), warn: push('warn'), error: push('error') } };
}

interface FakeBridgeOptions {
  name: string;
  enabled?: boolean;
  startError?: Error;
  stopError?: Error;
}

function fakeBridge(options: FakeBridgeOptions): VoiceBridge & { started: boolean; stopped: boolean } {
  return {
    name: options.name,
    enabled: options.enabled ?? true,
    started: false,
    stopped: false,
    start(): Promise<void> {
      this.started = true;
      if (options.startError === undefined) return Promise.resolve();
      return Promise.reject(options.startError);
    },
    stop(): Promise<void> {
      this.stopped = true;
      if (options.stopError === undefined) return Promise.resolve();
      return Promise.reject(options.stopError);
    },
    status(): BridgeStatus {
      return { name: options.name, enabled: this.enabled, running: this.started, detail: null };
    },
  };
}

describe('BridgeRegistry', () => {
  it('starts empty', async () => {
    const registry = new BridgeRegistry();
    expect(registry.bridges).toEqual([]);
    expect(registry.statuses()).toEqual([]);
    await expect(registry.startAll()).resolves.toBeUndefined();
    await expect(registry.stopAll()).resolves.toBeUndefined();
  });

  it('accepts bridges through the constructor and through add', () => {
    const first = fakeBridge({ name: 'a' });
    const registry = new BridgeRegistry([first]);
    const second = fakeBridge({ name: 'b' });

    registry.add(second);
    expect(registry.bridges.map((bridge) => bridge.name)).toEqual(['a', 'b']);
  });

  it('starts only the enabled bridges, in order', async () => {
    const enabled = fakeBridge({ name: 'hue' });
    const disabled = fakeBridge({ name: 'matter', enabled: false });
    const { logger, entries } = recordingLogger();
    const registry = new BridgeRegistry([enabled, disabled], logger);

    await registry.startAll();

    expect(enabled.started).toBe(true);
    expect(disabled.started).toBe(false);
    expect(entries).toEqual([{ level: 'info', message: "Bridge 'hue' started" }]);
  });

  it('logs a failing start and carries on with the next bridge', async () => {
    const broken = fakeBridge({ name: 'hue', startError: new Error('port 80 is taken') });
    const healthy = fakeBridge({ name: 'matter' });
    const { logger, entries } = recordingLogger();
    const registry = new BridgeRegistry([broken, healthy], logger);

    await expect(registry.startAll()).resolves.toBeUndefined();

    expect(healthy.started).toBe(true);
    expect(entries[0]).toEqual({
      level: 'error',
      message: "Bridge 'hue' failed to start",
      context: { error: 'port 80 is taken' },
    });
    expect(entries[1]).toEqual({ level: 'info', message: "Bridge 'matter' started" });
  });

  it('stringifies a non-Error start failure', async () => {
    const broken = fakeBridge({ name: 'hue', startError: notAnError('just a string') });
    const { logger, entries } = recordingLogger();

    await new BridgeRegistry([broken], logger).startAll();
    expect(entries[0]?.context).toEqual({ error: 'just a string' });
  });

  it('stops every bridge, enabled or not, on a best effort basis', async () => {
    const enabled = fakeBridge({ name: 'hue' });
    const disabled = fakeBridge({ name: 'matter', enabled: false });
    const registry = new BridgeRegistry([enabled, disabled]);

    await registry.stopAll();

    expect(enabled.stopped).toBe(true);
    expect(disabled.stopped).toBe(true);
  });

  it('logs a failing stop and still stops the rest', async () => {
    const broken = fakeBridge({ name: 'hue', stopError: new Error('socket stuck') });
    const healthy = fakeBridge({ name: 'matter' });
    const { logger, entries } = recordingLogger();
    const registry = new BridgeRegistry([broken, healthy], logger);

    await expect(registry.stopAll()).resolves.toBeUndefined();

    expect(healthy.stopped).toBe(true);
    expect(entries).toEqual([
      {
        level: 'warn',
        message: "Bridge 'hue' failed to stop cleanly",
        context: { error: 'socket stuck' },
      },
    ]);
  });

  it('stringifies a non-Error stop failure', async () => {
    const broken = fakeBridge({ name: 'hue', stopError: notAnError(42) });
    const { logger, entries } = recordingLogger();

    await new BridgeRegistry([broken], logger).stopAll();
    expect(entries[0]?.context).toEqual({ error: '42' });
  });

  it('reports the status of every bridge', async () => {
    const enabled = fakeBridge({ name: 'hue' });
    const disabled = fakeBridge({ name: 'matter', enabled: false });
    const registry = new BridgeRegistry([enabled, disabled]);

    expect(registry.statuses()).toEqual([
      { name: 'hue', enabled: true, running: false, detail: null },
      { name: 'matter', enabled: false, running: false, detail: null },
    ]);

    await registry.startAll();
    expect(registry.statuses()[0]?.running).toBe(true);
    expect(registry.statuses()[1]?.running).toBe(false);
  });

  it('falls back to a logger that does nothing', async () => {
    const broken = fakeBridge({ name: 'hue', startError: new Error('boom') });
    await expect(new BridgeRegistry([broken]).startAll()).resolves.toBeUndefined();
  });
});

describe('noopLogger', () => {
  it('accepts every level without doing anything', () => {
    expect(() => {
      noopLogger.info('a');
      noopLogger.warn('b', { x: 1 });
      noopLogger.error('c');
    }).not.toThrow();
  });

  it('is the default logger a registry uses', async () => {
    const spy = vi.spyOn(noopLogger, 'info');
    await new BridgeRegistry([fakeBridge({ name: 'hue' })]).startAll();
    expect(spy).toHaveBeenCalledWith("Bridge 'hue' started");
    spy.mockRestore();
  });
});
