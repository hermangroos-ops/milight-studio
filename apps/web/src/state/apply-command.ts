import {
  clamp,
  hexToRgb,
  MAX_EFFECT_INDEX,
  MAX_KELVIN,
  MIN_KELVIN,
  normaliseHue,
  rgbToHsv,
  type LightCommand,
  type LightState,
} from '@milight-studio/shared';

/**
 * Local, optimistic reproduction of the server's command application order.
 *
 * The server remains the source of truth — this only exists so a tap on a toggle
 * or a drag of a slider updates the UI before the round trip completes.
 */
export function applyCommandLocally(state: LightState, command: LightCommand): LightState {
  const next: LightState = { ...state };

  if (command.power === 'on') next.power = 'on';
  else if (command.power === 'off') next.power = 'off';
  else if (command.power === 'toggle') next.power = state.power === 'on' ? 'off' : 'on';

  if (command.brightness !== undefined) {
    next.brightness = Math.round(clamp(command.brightness, 0, 100));
  }
  if (command.brightnessStep !== undefined) {
    next.brightness = Math.round(clamp(state.brightness + command.brightnessStep, 0, 100));
  }

  if (command.hex !== undefined) {
    const rgb = hexToRgb(command.hex);
    if (rgb) {
      const hsv = rgbToHsv(rgb);
      next.hue = hsv.hue;
      next.saturation = hsv.saturation;
      next.colorMode = 'color';
    }
  }
  if (command.hue !== undefined) {
    next.hue = normaliseHue(command.hue);
    next.colorMode = 'color';
  }
  if (command.saturation !== undefined) {
    next.saturation = Math.round(clamp(command.saturation, 0, 100));
    next.colorMode = 'color';
  }

  if (command.colorTemperature !== undefined) {
    next.colorTemperature = Math.round(clamp(command.colorTemperature, MIN_KELVIN, MAX_KELVIN));
    next.colorMode = 'white';
  }
  if (command.whiteMode === true) {
    next.colorMode = 'white';
    next.saturation = 0;
  }

  if (command.nightMode === true) {
    next.nightMode = true;
    next.power = 'on';
  } else if (command.power === 'off') {
    next.nightMode = false;
  }

  if (command.effect === 'next') {
    next.effect = ((state.effect ?? -1) + 1) % (MAX_EFFECT_INDEX + 1);
  } else if (command.effect !== undefined) {
    next.effect = Math.round(clamp(command.effect, 0, MAX_EFFECT_INDEX));
  }

  if (next.power === 'off') next.colorMode = 'off';
  else if (next.colorMode === 'off') next.colorMode = 'white';

  next.updatedAt = new Date().toISOString();
  return next;
}
