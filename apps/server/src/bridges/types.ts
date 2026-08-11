import type { BridgeStatus } from '@milight-studio/shared';

/**
 * A voice-assistant bridge exposes the lights, groups and scenes we manage to an
 * external ecosystem (Alexa via Matter, Alexa via emulated Hue, ...).
 *
 * Bridges are strictly optional and must never be on the critical path of the REST API:
 * a failing bridge logs and reports `running: false`, it does not break light control.
 */
export interface VoiceBridge {
  readonly name: string;
  readonly enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): BridgeStatus;
}

export interface BridgeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export const noopLogger: BridgeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
