import {
  clamp,
  getRemoteTypeProfile,
  hexToRgb,
  hubPercentageToKelvin,
  kelvinToMired,
  miredToKelvin,
  normaliseHue,
  rgbToHsv,
  type LightCapability,
  type LightCommand,
  type LightState,
  type RemoteType,
} from '@milight-studio/shared';

import type { HubCommand, HubCommandBody, HubGroupState } from './types.js';

export interface TranslationResult {
  body: HubCommandBody;
  /** Capabilities that were requested but the protocol cannot do; silently dropped. */
  unsupported: LightCapability[];
}

export interface CommandIssue {
  path: string;
  message: string;
}

/**
 * Semantic checks that a schema cannot express: a bulb is either showing a colour or a
 * white tone, never both, and relative and absolute brightness are mutually exclusive.
 */
export function validateCommand(command: LightCommand): CommandIssue[] {
  const issues: CommandIssue[] = [];

  const wantsColor = command.hue !== undefined || command.hex !== undefined;
  if (wantsColor && command.colorTemperature !== undefined) {
    issues.push({
      path: 'colorTemperature',
      message: 'Cannot set a colour and a colour temperature in the same command',
    });
  }
  if (wantsColor && command.whiteMode === true) {
    issues.push({ path: 'whiteMode', message: 'Cannot set a colour and switch to white mode at once' });
  }
  if (command.brightness !== undefined && command.brightnessStep !== undefined) {
    issues.push({
      path: 'brightnessStep',
      message: 'Use either an absolute brightness or a brightness step, not both',
    });
  }
  if (command.hex !== undefined && (command.hue !== undefined || command.saturation !== undefined)) {
    issues.push({ path: 'hex', message: 'Use either hex or hue/saturation, not both' });
  }
  if (command.brightnessStep === 0) {
    issues.push({ path: 'brightnessStep', message: 'Brightness step must not be zero' });
  }

  return issues;
}

/** Resolve the hue/saturation a command asks for, whatever notation it used. */
export function resolveColor(command: LightCommand): { hue: number; saturation: number } | null {
  if (command.hex !== undefined) {
    const rgb = hexToRgb(command.hex);
    if (!rgb) return null;
    const hsv = rgbToHsv(rgb);
    return { hue: hsv.hue, saturation: hsv.saturation };
  }
  if (command.hue === undefined && command.saturation === undefined) return null;
  return {
    hue: normaliseHue(command.hue ?? 0),
    saturation: clamp(Math.round(command.saturation ?? 100), 0, 100),
  };
}

/** How many level_up / level_down presses approximate a percentage step. */
function stepCount(step: number): number {
  // The MiLight remotes move roughly 10% per press; keep it to a sane number of packets.
  return clamp(Math.round(Math.abs(step) / 10), 1, 10);
}

/**
 * Translate a device-independent command into a single hub request body.
 *
 * Key insertion order is deliberate — the hub applies fields in document order, so
 * power comes first, then brightness, then colour/temperature, and night mode last
 * because it overrides brightness.
 */
export function buildHubCommandBody(command: LightCommand, remoteType: RemoteType): TranslationResult {
  const profile = getRemoteTypeProfile(remoteType);
  const can = (capability: LightCapability): boolean => profile.capabilities.includes(capability);

  const body: HubCommandBody = {};
  const commands: HubCommand[] = [];
  const unsupported: LightCapability[] = [];

  if (command.power !== undefined) {
    if (command.power === 'toggle' || !can('power')) {
      commands.push('toggle');
    } else {
      body.status = command.power === 'on' ? 'ON' : 'OFF';
    }
  }

  if (command.brightness !== undefined) {
    if (profile.brightnessMode === 'absolute') {
      body.level = clamp(Math.round(command.brightness), 0, 100);
    } else if (profile.brightnessMode === 'relative') {
      // Best effort: nudge towards the requested level without knowing the current one.
      const presses = stepCount(command.brightness >= 50 ? 100 - command.brightness : -command.brightness);
      for (let i = 0; i < presses; i += 1) {
        commands.push(command.brightness >= 50 ? 'level_up' : 'level_down');
      }
    } else {
      unsupported.push('brightness');
    }
  }

  if (command.brightnessStep !== undefined && command.brightnessStep !== 0) {
    if (profile.brightnessMode === 'none') {
      unsupported.push('brightness');
    } else {
      const presses = stepCount(command.brightnessStep);
      for (let i = 0; i < presses; i += 1) {
        commands.push(command.brightnessStep > 0 ? 'level_up' : 'level_down');
      }
    }
  }

  if (command.whiteMode === true) {
    if (can('whiteMode') || can('colorTemperature')) commands.push('set_white');
    else unsupported.push('whiteMode');
  }

  if (command.colorTemperature !== undefined) {
    if (can('colorTemperature')) body.color_temp = kelvinToMired(command.colorTemperature);
    else unsupported.push('colorTemperature');
  }

  const color = resolveColor(command);
  if (color) {
    if (can('color')) {
      body.hue = color.hue;
      body.saturation = color.saturation;
    } else {
      unsupported.push('color');
    }
  }

  if (command.effect !== undefined) {
    if (!can('effects')) {
      unsupported.push('effects');
    } else if (command.effect === 'next') {
      commands.push('next_mode');
    } else {
      body.mode = clamp(Math.round(command.effect), 0, Math.max(0, profile.effectCount - 1));
    }
  }

  if (command.effectSpeed !== undefined) {
    if (can('effects')) commands.push(command.effectSpeed === 'up' ? 'mode_speed_up' : 'mode_speed_down');
    else unsupported.push('effects');
  }

  if (command.nightMode === true) {
    if (can('nightMode')) commands.push('night_mode');
    else unsupported.push('nightMode');
  }

  if (commands.length > 0) body.commands = commands;

  if (command.transitionMs !== undefined && command.transitionMs > 0) {
    // The hub expresses transition duration in seconds (fractional values allowed).
    body.transition = Math.round((command.transitionMs / 1000) * 10) / 10;
  }

  return { body, unsupported };
}

/** Apply a command to our shadow state so the UI updates before the radio does. */
export function applyCommandToState(
  state: LightState,
  command: LightCommand,
  remoteType: RemoteType,
  now: Date = new Date(),
): LightState {
  const profile = getRemoteTypeProfile(remoteType);
  const can = (capability: LightCapability): boolean => profile.capabilities.includes(capability);
  const next: LightState = { ...state, updatedAt: now.toISOString() };

  if (command.power === 'on') next.power = 'on';
  else if (command.power === 'off') next.power = 'off';
  else if (command.power === 'toggle') next.power = state.power === 'on' ? 'off' : 'on';

  if (command.brightness !== undefined && profile.brightnessMode !== 'none') {
    next.brightness = clamp(Math.round(command.brightness), 0, 100);
    next.nightMode = false;
  }

  if (command.brightnessStep !== undefined && profile.brightnessMode !== 'none') {
    next.brightness = clamp(Math.round(state.brightness + command.brightnessStep), 0, 100);
    next.nightMode = false;
  }

  if (command.whiteMode === true && (can('whiteMode') || can('colorTemperature'))) {
    next.colorMode = 'white';
    next.saturation = 0;
    next.effect = null;
  }

  if (command.colorTemperature !== undefined && can('colorTemperature')) {
    next.colorTemperature = clamp(Math.round(command.colorTemperature), 2700, 6500);
    next.colorMode = 'white';
    next.effect = null;
  }

  const color = resolveColor(command);
  if (color && can('color')) {
    next.hue = color.hue;
    next.saturation = color.saturation;
    next.colorMode = 'color';
    next.effect = null;
  }

  if (command.effect !== undefined && can('effects')) {
    if (command.effect === 'next') {
      const current = state.effect ?? -1;
      next.effect = (current + 1) % Math.max(1, profile.effectCount);
    } else {
      next.effect = clamp(Math.round(command.effect), 0, Math.max(0, profile.effectCount - 1));
    }
  }

  if (command.nightMode === true && can('nightMode')) {
    next.nightMode = true;
    next.power = 'on';
    next.brightness = 1;
  }

  // Anything that actually lights the bulb implies it is on — but only if the protocol
  // can carry out that part of the command in the first place.
  const litSomething =
    (command.brightness !== undefined && profile.brightnessMode !== 'none') ||
    (color !== null && can('color')) ||
    (command.colorTemperature !== undefined && can('colorTemperature'));

  if (next.power === 'off' && command.power === undefined && litSomething) {
    next.power = 'on';
  }

  if (next.power === 'off') next.colorMode = 'off';
  else if (next.colorMode === 'off') next.colorMode = next.saturation > 0 ? 'color' : 'white';

  return next;
}

/**
 * Fold whatever the hub reports back into our shadow state. The hub's payload varies by
 * firmware build and by which `group_state_fields` are enabled, so every field is optional.
 */
export function mergeHubState(state: LightState, hub: HubGroupState, now: Date = new Date()): LightState {
  const next: LightState = { ...state, updatedAt: now.toISOString(), reachable: true };

  const power = hub.state ?? hub.status;
  if (power === 'ON') next.power = 'on';
  else if (power === 'OFF') next.power = 'off';

  if (typeof hub.level === 'number') next.brightness = clamp(Math.round(hub.level), 0, 100);
  else if (typeof hub.brightness === 'number')
    next.brightness = clamp(Math.round((hub.brightness / 255) * 100), 0, 100);

  if (typeof hub.hue === 'number') next.hue = normaliseHue(hub.hue);
  if (typeof hub.saturation === 'number') next.saturation = clamp(Math.round(hub.saturation), 0, 100);

  if (typeof hub.color_temp === 'number') next.colorTemperature = miredToKelvin(hub.color_temp);
  else if (typeof hub.kelvin === 'number') next.colorTemperature = hubPercentageToKelvin(hub.kelvin);

  if (typeof hub.mode === 'number') next.effect = clamp(Math.round(hub.mode), 0, 8);

  const bulbMode = hub.bulb_mode ?? hub.color_mode;
  if (bulbMode === 'color' || bulbMode === 'rgb') next.colorMode = 'color';
  else if (bulbMode === 'white' || bulbMode === 'color_temp') next.colorMode = 'white';
  else if (bulbMode === 'night') next.nightMode = true;
  if (bulbMode !== undefined && bulbMode !== 'night') next.nightMode = false;
  if (bulbMode === 'scene') next.colorMode = 'color';

  if (next.power === 'off') next.colorMode = 'off';

  return next;
}
