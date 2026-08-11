/**
 * Remote (bulb protocol) profiles.
 *
 * MiBoxer / Mi-Light hardware speaks a handful of incompatible 2.4 GHz protocols.
 * `esp8266_milight_hub` calls each of them a "remote type" and exposes the list at
 * `GET /remote_configs`. The table below mirrors that list and adds the capability
 * metadata the UI needs so it can render only the controls a bulb actually supports.
 */

export const REMOTE_TYPES = ['rgbw', 'cct', 'rgb_cct', 'rgb', 'fut089', 'fut091', 'fut020'] as const;

export type RemoteType = (typeof REMOTE_TYPES)[number];

export const LIGHT_CAPABILITIES = [
  'power',
  'toggle',
  'brightness',
  'color',
  'colorTemperature',
  'whiteMode',
  'nightMode',
  'effects',
] as const;

export type LightCapability = (typeof LIGHT_CAPABILITIES)[number];

/** How a protocol lets us change brightness. */
export type BrightnessMode = 'absolute' | 'relative' | 'none';

export interface RemoteTypeProfile {
  readonly id: RemoteType;
  /** Human readable name, e.g. shown in the "add light" wizard. */
  readonly label: string;
  /** Short hint describing which hardware uses this protocol. */
  readonly hint: string;
  /**
   * Highest addressable group number. Group 0 is the broadcast address ("all zones")
   * for protocols where `supportsBroadcast` is true; protocols with `maxGroupId === 0`
   * only have the single group 0, which then addresses the one and only device.
   */
  readonly maxGroupId: number;
  readonly supportsBroadcast: boolean;
  readonly brightnessMode: BrightnessMode;
  readonly capabilities: readonly LightCapability[];
  /** Number of built-in dynamic "disco" modes, 0 when unsupported. */
  readonly effectCount: number;
}

const profile = (p: RemoteTypeProfile): RemoteTypeProfile => Object.freeze(p);

export const REMOTE_TYPE_PROFILES: Readonly<Record<RemoteType, RemoteTypeProfile>> = Object.freeze({
  rgb_cct: profile({
    id: 'rgb_cct',
    label: 'RGB + CCT (FUT005 / FUT006 / FUT007)',
    hint: 'Full colour bulbs that also do warm-to-cool white. The most common MiBoxer bulb.',
    maxGroupId: 4,
    supportsBroadcast: true,
    brightnessMode: 'absolute',
    capabilities: ['power', 'brightness', 'color', 'colorTemperature', 'whiteMode', 'nightMode', 'effects'],
    effectCount: 9,
  }),
  fut089: profile({
    id: 'fut089',
    label: 'RGB + CCT, 8 zones (FUT089)',
    hint: 'Same capabilities as RGB+CCT but addressable across 8 zones instead of 4.',
    maxGroupId: 8,
    supportsBroadcast: true,
    brightnessMode: 'absolute',
    capabilities: ['power', 'brightness', 'color', 'colorTemperature', 'whiteMode', 'nightMode', 'effects'],
    effectCount: 9,
  }),
  rgbw: profile({
    id: 'rgbw',
    label: 'RGBW (FUT096 style)',
    hint: 'Colour plus a single fixed white channel. No adjustable colour temperature.',
    maxGroupId: 4,
    supportsBroadcast: true,
    brightnessMode: 'absolute',
    capabilities: ['power', 'brightness', 'color', 'whiteMode', 'nightMode', 'effects'],
    effectCount: 9,
  }),
  cct: profile({
    id: 'cct',
    label: 'Dual white / CCT (FUT035)',
    hint: 'Warm-to-cool white only, no colour.',
    maxGroupId: 4,
    supportsBroadcast: true,
    brightnessMode: 'absolute',
    capabilities: ['power', 'brightness', 'colorTemperature', 'nightMode'],
    effectCount: 0,
  }),
  fut091: profile({
    id: 'fut091',
    label: 'Dual white / CCT (FUT091)',
    hint: 'Newer CCT remote protocol. Same capabilities as CCT.',
    maxGroupId: 4,
    supportsBroadcast: true,
    brightnessMode: 'absolute',
    capabilities: ['power', 'brightness', 'colorTemperature', 'nightMode'],
    effectCount: 0,
  }),
  rgb: profile({
    id: 'rgb',
    label: 'RGB only (FUT098 style)',
    hint: 'Colour only, single zone. Brightness can only be stepped up or down, not set directly.',
    maxGroupId: 0,
    supportsBroadcast: false,
    brightnessMode: 'relative',
    capabilities: ['power', 'brightness', 'color', 'effects'],
    effectCount: 9,
  }),
  fut020: profile({
    id: 'fut020',
    label: 'RGB strip controller (FUT020)',
    hint: 'Small strip controller. Power is toggle-only and brightness is not addressable.',
    maxGroupId: 0,
    supportsBroadcast: false,
    brightnessMode: 'none',
    capabilities: ['toggle', 'color', 'effects'],
    effectCount: 9,
  }),
});

export const REMOTE_TYPE_PROFILE_LIST: readonly RemoteTypeProfile[] = Object.freeze(
  REMOTE_TYPES.map((id) => REMOTE_TYPE_PROFILES[id]),
);

export function isRemoteType(value: unknown): value is RemoteType {
  return typeof value === 'string' && (REMOTE_TYPES as readonly string[]).includes(value);
}

export function getRemoteTypeProfile(type: RemoteType): RemoteTypeProfile {
  return REMOTE_TYPE_PROFILES[type];
}

export function supportsCapability(type: RemoteType, capability: LightCapability): boolean {
  return REMOTE_TYPE_PROFILES[type].capabilities.includes(capability);
}

/**
 * Every group id that can be addressed for a remote type, broadcast group included.
 * For single-zone protocols this is just `[0]`.
 */
export function groupIdsFor(type: RemoteType): readonly number[] {
  const { maxGroupId } = REMOTE_TYPE_PROFILES[type];
  return Array.from({ length: maxGroupId + 1 }, (_, index) => index);
}

export function isValidGroupId(type: RemoteType, groupId: number): boolean {
  if (!Number.isInteger(groupId) || groupId < 0) return false;
  return groupId <= REMOTE_TYPE_PROFILES[type].maxGroupId;
}

/** True when this group id addresses every zone at once rather than one bulb. */
export function isBroadcastGroup(type: RemoteType, groupId: number): boolean {
  return groupId === 0 && REMOTE_TYPE_PROFILES[type].supportsBroadcast;
}
