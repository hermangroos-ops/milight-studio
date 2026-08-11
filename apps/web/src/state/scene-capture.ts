import type { LightCommand, LightWithState, SceneStep } from '@milight-studio/shared';

import { capabilitiesOf, capabilitiesOfAll } from './capabilities.js';

/** Turns the light's current state into the smallest command that reproduces it. */
export function commandFromLight(light: LightWithState): LightCommand {
  const capabilities = capabilitiesOf(light.remoteType);
  const state = light.state;

  if (state.power === 'off') return { power: 'off' };

  const command: LightCommand = { power: 'on' };
  if (capabilities.has('brightness') && capabilities.brightnessMode === 'absolute') {
    command.brightness = state.brightness;
  }
  if (state.effect !== null && capabilities.has('effects')) {
    command.effect = state.effect;
    return command;
  }
  if (state.colorMode === 'color' && capabilities.has('color')) {
    command.hue = state.hue;
    command.saturation = state.saturation;
  } else if (capabilities.has('colorTemperature')) {
    command.colorTemperature = state.colorTemperature;
  } else if (capabilities.has('whiteMode')) {
    command.whiteMode = true;
  }
  return command;
}

/** Same idea for a group: capture the state of a representative member. */
export function commandFromGroup(members: readonly LightWithState[]): LightCommand | null {
  const representative = members.find((light) => light.state.power === 'on') ?? members[0];
  if (!representative) return null;

  const capabilities = capabilitiesOfAll(members.map((light) => light.remoteType));
  const captured = commandFromLight(representative);
  if (captured.brightness !== undefined && capabilities.brightnessMode !== 'absolute') {
    const { brightness: _brightness, ...rest } = captured;
    return rest;
  }
  return captured;
}

export interface SceneCaptureInput {
  lights: readonly LightWithState[];
  selectedLightIds: readonly string[];
  groups: readonly { id: string; lightIds: readonly string[] }[];
  selectedGroupIds: readonly string[];
}

/** Builds the scene steps for everything the user ticked. */
export function captureSceneSteps({
  lights,
  selectedLightIds,
  groups,
  selectedGroupIds,
}: SceneCaptureInput): SceneStep[] {
  const byId = new Map(lights.map((light) => [light.id, light]));
  const steps: SceneStep[] = [];

  for (const lightId of selectedLightIds) {
    const light = byId.get(lightId);
    if (light) steps.push({ targetType: 'light', targetId: light.id, command: commandFromLight(light) });
  }

  for (const groupId of selectedGroupIds) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) continue;
    const members = group.lightIds.flatMap((id) => {
      const light = byId.get(id);
      return light ? [light] : [];
    });
    const command = commandFromGroup(members);
    if (command) steps.push({ targetType: 'group', targetId: group.id, command });
  }

  return steps;
}
