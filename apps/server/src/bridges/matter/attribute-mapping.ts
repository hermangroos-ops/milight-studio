/**
 * Pure conversions between our domain model and the numeric ranges the Matter light
 * clusters use.
 *
 * This module deliberately imports nothing from `@matter/main`: it is the part of the
 * bridge that is worth unit testing, and booting a Matter node in a test run is both
 * slow and requires a network stack.
 */

import {
  byteToPercent,
  clamp,
  kelvinToMired,
  miredToKelvin,
  normaliseHue,
  percentToByte,
  type LightState,
  type PowerState,
} from '@milight-studio/shared';

/** LevelControl on a lighting endpoint refuses 0; 0 means "off", which is OnOff's job. */
export const MATTER_LEVEL_MIN = 1;
export const MATTER_LEVEL_MAX = 254;

/** ColorControl stores hue and saturation as a byte with 255 reserved as "invalid". */
export const MATTER_HUE_MAX = 254;
export const MATTER_SATURATION_MAX = 254;

/** Enhanced hue is the same circle at 16-bit resolution. */
export const MATTER_ENHANCED_HUE_MAX = 65_535;

/** Upper bound of `LightCommand.transitionMs`. */
export const MAX_TRANSITION_MS = 600_000;

/** `ColorControl.ColorMode` — mirrored here so the pure layer stays matter.js free. */
export const COLOR_MODE_HUE_SATURATION = 0;
export const COLOR_MODE_XY = 1;
export const COLOR_MODE_COLOR_TEMPERATURE = 2;

export interface MatterLightAttributes {
  readonly onOff: boolean;
  readonly currentLevel: number;
  readonly currentHue: number;
  readonly currentSaturation: number;
  readonly colorTemperatureMireds: number;
  readonly colorMode: number;
}

export function levelToBrightness(level: number): number {
  return byteToPercent(level);
}

export function brightnessToLevel(brightness: number): number {
  return clamp(percentToByte(brightness), MATTER_LEVEL_MIN, MATTER_LEVEL_MAX);
}

export function matterHueToDegrees(hue: number): number {
  return Math.round((clamp(hue, 0, MATTER_HUE_MAX) / MATTER_HUE_MAX) * 359);
}

export function degreesToMatterHue(degrees: number): number {
  return clamp(Math.round((normaliseHue(degrees) / 359) * MATTER_HUE_MAX), 0, MATTER_HUE_MAX);
}

/**
 * The EnhancedHue feature widens hue to 16 bits. We only ever store whole degrees, so
 * the extra precision is folded away here rather than in the command path.
 */
export function enhancedHueToDegrees(enhancedHue: number): number {
  return Math.round((clamp(enhancedHue, 0, MATTER_ENHANCED_HUE_MAX) / MATTER_ENHANCED_HUE_MAX) * 359);
}

export function matterSaturationToPercent(saturation: number): number {
  return byteToPercent(saturation);
}

export function percentToMatterSaturation(percent: number): number {
  return percentToByte(percent);
}

export function miredsToKelvin(mireds: number): number {
  return miredToKelvin(mireds);
}

export function kelvinToMireds(kelvin: number): number {
  return kelvinToMired(kelvin);
}

/** ColorControl x/y are 16.16 fixed point values in the 0–1 CIE range. */
export function matterXyToUnit(value: number): number {
  return clamp(value, 0, 65_536) / 65_536;
}

/**
 * Matter expresses transition times in tenths of a second; `null` (and the 0xFFFF the
 * spec uses for "use the default") means "as fast as the device can manage", which we
 * signal by omitting `transitionMs` entirely.
 */
export function transitionTimeToMs(transitionTime: number | null | undefined): number | undefined {
  if (transitionTime === null || transitionTime === undefined) return undefined;
  if (!Number.isFinite(transitionTime) || transitionTime <= 0) return undefined;
  if (transitionTime >= 0xffff) return undefined;
  return clamp(Math.round(transitionTime * 100), 0, MAX_TRANSITION_MS);
}

/** Everything a bridged light endpoint needs to reflect our shadow state. */
export function lightStateToMatterAttributes(state: LightState): MatterLightAttributes {
  return {
    onOff: state.power === 'on',
    currentLevel: brightnessToLevel(state.brightness),
    currentHue: degreesToMatterHue(state.hue),
    currentSaturation: percentToMatterSaturation(state.saturation),
    colorTemperatureMireds: kelvinToMireds(state.colorTemperature),
    colorMode: state.colorMode === 'color' ? COLOR_MODE_HUE_SATURATION : COLOR_MODE_COLOR_TEMPERATURE,
  };
}

/**
 * Collapse the states of a group's members into the single state Alexa sees.
 *
 * A group is "on" when any member is on — that matches what a human means by "is the
 * living room on?" — while colour and brightness are taken from a representative member
 * so the values stay internally consistent instead of averaging into a colour nobody
 * asked for.
 */
export function aggregateLightStates(states: readonly LightState[]): LightState | null {
  const first = states[0];
  if (first === undefined) return null;

  const representative = states.find((state) => state.power === 'on') ?? first;
  const power: PowerState = states.some((state) => state.power === 'on') ? 'on' : 'off';
  const lit = states.filter((state) => state.power === 'on');
  const brightnessSource = lit.length > 0 ? lit : states;
  const brightness = Math.round(
    brightnessSource.reduce((total, state) => total + state.brightness, 0) / brightnessSource.length,
  );

  return {
    ...representative,
    power,
    brightness,
    // One unreachable member is enough to make the whole group unreliable.
    reachable: states.every((state) => state.reachable),
    nightMode: states.some((state) => state.nightMode),
    updatedAt: states.reduce((latest, state) => (state.updatedAt > latest ? state.updatedAt : latest), ''),
  };
}

/** Fold a 16-bit enhanced hue back onto the byte-sized hue our model works in. */
export function enhancedHueToMatterHue(enhancedHue: number): number {
  return degreesToMatterHue(enhancedHueToDegrees(enhancedHue));
}
