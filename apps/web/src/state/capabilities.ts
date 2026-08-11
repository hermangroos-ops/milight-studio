import {
  REMOTE_TYPE_PROFILES,
  type BrightnessMode,
  type LightCapability,
  type RemoteType,
} from '@milight-studio/shared';

export interface CapabilitySet {
  has: (capability: LightCapability) => boolean;
  brightnessMode: BrightnessMode;
  effectCount: number;
}

/** Capabilities of a single light. */
export function capabilitiesOf(remoteType: RemoteType): CapabilitySet {
  const profile = REMOTE_TYPE_PROFILES[remoteType];
  return {
    has: (capability) => profile.capabilities.includes(capability),
    brightnessMode: profile.brightnessMode,
    effectCount: profile.effectCount,
  };
}

/**
 * Union of the capabilities of every member of a group.
 *
 * A group can mix protocols, so we offer every control at least one member
 * understands; the server reports per-light failures for the rest.
 */
export function capabilitiesOfAll(remoteTypes: readonly RemoteType[]): CapabilitySet {
  const profiles = remoteTypes.map((type) => REMOTE_TYPE_PROFILES[type]);
  const modes = new Set<BrightnessMode>(profiles.map((profile) => profile.brightnessMode));
  const brightnessMode: BrightnessMode = modes.has('absolute')
    ? 'absolute'
    : modes.has('relative')
      ? 'relative'
      : 'none';

  return {
    has: (capability) => profiles.some((profile) => profile.capabilities.includes(capability)),
    brightnessMode,
    effectCount: profiles.reduce((max, profile) => Math.max(max, profile.effectCount), 0),
  };
}
