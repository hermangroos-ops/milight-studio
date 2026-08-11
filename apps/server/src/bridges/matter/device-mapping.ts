/**
 * Pure mapping from our remote-type profiles onto Matter device types, plus the
 * capability-aware command builders that decide what a given bulb protocol can
 * actually be asked to do.
 *
 * Like `attribute-mapping.ts` this module imports nothing from `@matter/main`.
 */

import {
  REMOTE_TYPE_PROFILES,
  clamp,
  type BrightnessMode,
  type LightCommand,
  type PowerState,
  type RemoteType,
} from '@milight-studio/shared';

export type BridgedEntityKind = 'light' | 'group' | 'scene';

/**
 * The Matter device library has no "colour without colour temperature" light: it only
 * defines On/Off (0x0100), Dimmable (0x0101), Colour Temperature (0x010C) and Extended
 * Colour (0x010D) lights, and Extended Colour Light makes the ColorTemperature feature
 * mandatory. RGB-only MiBoxer bulbs are therefore published as Extended Colour Lights
 * as well; `colorTemperatureCommand` degrades a colour-temperature request on such a
 * bulb to "switch to white" rather than pretending it worked.
 */
export type MatterLightKind = 'extendedColor' | 'colorTemperature' | 'dimmable' | 'onOff';

export interface MatterDeviceProfile {
  /** Matter device type used for the bridged endpoint. */
  readonly kind: MatterLightKind;
  /** The protocol accepts an absolute on/off rather than only a blind toggle. */
  readonly supportsPower: boolean;
  readonly supportsToggle: boolean;
  readonly brightnessMode: BrightnessMode;
  readonly supportsColor: boolean;
  readonly supportsColorTemperature: boolean;
  readonly supportsWhiteMode: boolean;
}

/** Scenes are one-shot triggers, so they get the simplest possible endpoint. */
export const SCENE_PROFILE: MatterDeviceProfile = Object.freeze({
  kind: 'onOff',
  supportsPower: true,
  supportsToggle: false,
  brightnessMode: 'none',
  supportsColor: false,
  supportsColorTemperature: false,
  supportsWhiteMode: false,
});

function kindFor(color: boolean, colorTemperature: boolean, brightness: BrightnessMode): MatterLightKind {
  if (color) return 'extendedColor';
  if (colorTemperature) return 'colorTemperature';
  return brightness === 'none' ? 'onOff' : 'dimmable';
}

export function deviceProfileForRemoteType(remoteType: RemoteType): MatterDeviceProfile {
  const profile = REMOTE_TYPE_PROFILES[remoteType];
  const supportsColor = profile.capabilities.includes('color');
  const supportsColorTemperature = profile.capabilities.includes('colorTemperature');

  return {
    kind: kindFor(supportsColor, supportsColorTemperature, profile.brightnessMode),
    supportsPower: profile.capabilities.includes('power'),
    supportsToggle: profile.capabilities.includes('toggle'),
    brightnessMode: profile.brightnessMode,
    supportsColor,
    supportsColorTemperature,
    supportsWhiteMode: profile.capabilities.includes('whiteMode'),
  };
}

/**
 * A group may mix protocols, so its endpoint advertises the union of what its members
 * can do: a group holding one RGB+CCT bulb and one white bulb still deserves a colour
 * picker in the Alexa app, and the members that cannot do colour simply ignore it.
 */
export function deviceProfileForGroup(remoteTypes: readonly RemoteType[]): MatterDeviceProfile {
  const profiles = remoteTypes.map(deviceProfileForRemoteType);
  const supportsColor = profiles.some((profile) => profile.supportsColor);
  const supportsColorTemperature = profiles.some((profile) => profile.supportsColorTemperature);
  const brightnessMode: BrightnessMode = profiles.some((profile) => profile.brightnessMode === 'absolute')
    ? 'absolute'
    : profiles.some((profile) => profile.brightnessMode === 'relative')
      ? 'relative'
      : 'none';

  return {
    // An empty group is still worth exposing as a dimmable light: members can be added
    // later without forcing a restart of the bridge.
    kind:
      remoteTypes.length === 0
        ? 'dimmable'
        : kindFor(supportsColor, supportsColorTemperature, brightnessMode),
    supportsPower: profiles.some((profile) => profile.supportsPower),
    supportsToggle: profiles.some((profile) => profile.supportsToggle),
    brightnessMode,
    supportsColor,
    supportsColorTemperature,
    supportsWhiteMode: profiles.some((profile) => profile.supportsWhiteMode),
  };
}

export function kindHasLevelControl(kind: MatterLightKind): boolean {
  return kind !== 'onOff';
}

export function kindHasColorControl(kind: MatterLightKind): boolean {
  return kind === 'extendedColor' || kind === 'colorTemperature';
}

export function kindHasHueSaturation(kind: MatterLightKind): boolean {
  return kind === 'extendedColor';
}

export function kindHasColorTemperature(kind: MatterLightKind): boolean {
  return kind === 'extendedColor' || kind === 'colorTemperature';
}

/** Endpoint ids double as the lookup key from a Matter command back to our entity. */
export function endpointIdFor(kind: BridgedEntityKind, entityId: string): string {
  return `${kind}-${entityId}`;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * BridgedDeviceBasicInformation.uniqueId is a fixed attribute capped at 32 characters
 * that controllers use to recognise a device across restarts, so it must be derived
 * deterministically from our own id. A UUID with the dashes removed is exactly 32
 * characters; anything else is hashed down to a stable 8-character digest.
 */
export function uniqueIdFor(entityId: string): string {
  const compact = entityId.replace(/[^0-9a-zA-Z]/g, '');
  if (compact.length > 0 && compact.length <= 32) return compact;
  return fnv1a(entityId);
}

/**
 * Absolute on/off where the protocol has it, and a state-aware toggle where it does
 * not: blindly toggling a FUT020 that is already on would turn the strip off.
 */
export function powerCommand(
  profile: MatterDeviceProfile,
  desired: PowerState,
  current: PowerState,
): LightCommand | null {
  if (profile.supportsPower) return { power: desired };
  if (!profile.supportsToggle) return null;
  return current === desired ? null : { power: 'toggle' };
}

/**
 * Matter always sends an absolute level. Protocols that can only step brightness get
 * the difference against our shadow state instead, which is the closest honest
 * translation available.
 */
export function brightnessCommand(
  profile: MatterDeviceProfile,
  targetPercent: number,
  currentPercent: number,
): LightCommand | null {
  const target = clamp(Math.round(targetPercent), 0, 100);
  switch (profile.brightnessMode) {
    case 'absolute':
      return { brightness: target };
    case 'relative': {
      const step = clamp(Math.round(target - currentPercent), -100, 100);
      return step === 0 ? null : { brightnessStep: step };
    }
    case 'none':
      return null;
  }
}

export function colorCommand(
  profile: MatterDeviceProfile,
  hue: number | null,
  saturation: number | null,
): LightCommand | null {
  if (!profile.supportsColor) return null;
  const command: LightCommand = {};
  if (hue !== null) command.hue = hue;
  if (saturation !== null) command.saturation = saturation;
  return Object.keys(command).length === 0 ? null : command;
}

/**
 * RGBW bulbs have a fixed white channel rather than a tunable one, so a colour
 * temperature request is best served by switching to that white instead of failing.
 */
export function colorTemperatureCommand(profile: MatterDeviceProfile, kelvin: number): LightCommand | null {
  if (profile.supportsColorTemperature) return { colorTemperature: kelvin };
  if (profile.supportsWhiteMode) return { whiteMode: true };
  return null;
}

/** Attach a fade duration to a command, leaving it off when there is nothing to fade. */
export function withTransition(command: LightCommand, transitionMs: number | undefined): LightCommand {
  return transitionMs === undefined || transitionMs <= 0 ? command : { ...command, transitionMs };
}
