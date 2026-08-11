import type { AppConfig } from '../../config.js';
import type { Services } from '../../container.js';
import type { BridgeLogger } from '../types.js';

export interface MatterRuntimeDeps {
  config: AppConfig;
  services: Services;
  logger: BridgeLogger;
}

export interface MatterRuntime {
  stop: () => Promise<void>;
  detail: string;
}

/**
 * Boots the Matter server node and mirrors our lights, groups and scenes onto it.
 * Implemented in a separate module so `@matter/main` is only loaded when the bridge is
 * actually switched on.
 */
export async function startMatterRuntime(deps: MatterRuntimeDeps): Promise<MatterRuntime> {
  const { buildMatterNode } = await import('./matter-node.js');
  return buildMatterNode(deps);
}
