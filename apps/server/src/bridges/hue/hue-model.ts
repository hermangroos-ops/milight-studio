import {
  byteToPercent,
  clamp,
  getRemoteTypeProfile,
  kelvinToMired,
  miredToKelvin,
  percentToByte,
  rgbToHsv,
  type Group,
  type LightCommand,
  type LightState,
  type LightWithState,
  type Scene,
} from '@milight-studio/shared';

/** Anything we are willing to show to Alexa as a "Hue light". */
export type HueTargetKind = 'light' | 'group' | 'scene';

export interface HueTarget {
  kind: HueTargetKind;
  /** Our internal uuid. */
  id: string;
  /** Numeric id Alexa remembers. Stable for a given uuid. */
  hueId: string;
  name: string;
  state: LightState | null;
  supportsColor: boolean;
  supportsTemperature: boolean;
  supportsBrightness: boolean;
}

const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;

/** Deterministic 32-bit FNV-1a so a uuid always maps to the same numeric Hue id. */
export function fnv1a(value: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Alexa keys its device cache on the numeric Hue id, so the mapping must be stable
 * across restarts. Deriving it from a hash of the uuid achieves that without extra
 * persistence; collisions are resolved by probing upwards, deterministically.
 */
export function assignHueIds(ids: string[]): Map<string, string> {
  const taken = new Set<number>();
  const result = new Map<string, string>();

  for (const id of [...ids].sort()) {
    let candidate = (fnv1a(id) % 9000) + 1;
    while (taken.has(candidate)) candidate = (candidate % 9000) + 1;
    taken.add(candidate);
    result.set(id, String(candidate));
  }

  return result;
}

export interface BuildTargetsInput {
  lights: LightWithState[];
  groups: Group[];
  scenes: Scene[];
  /** Group state is derived from members, so we need to resolve them. */
  membersOf: (groupId: string) => LightWithState[];
}

/**
 * Alexa never discovers Hue *groups*, only lights. Our groups and scenes are therefore
 * published as extra "lights" so "Alexa, zet woonkamer aan" and "Alexa, zet filmavond
 * aan" both work.
 */
export function buildHueTargets(input: BuildTargetsInput): HueTarget[] {
  const exposedLights = input.lights.filter((light) => light.exposeToVoice);
  const exposedGroups = input.groups.filter((group) => group.exposeToVoice);
  const exposedScenes = input.scenes.filter((scene) => scene.exposeToVoice);

  const keys = [
    ...exposedLights.map((light) => `light:${light.id}`),
    ...exposedGroups.map((group) => `group:${group.id}`),
    ...exposedScenes.map((scene) => `scene:${scene.id}`),
  ];
  const hueIds = assignHueIds(keys);

  const targets: HueTarget[] = [];

  for (const light of exposedLights) {
    const profile = getRemoteTypeProfile(light.remoteType);
    targets.push({
      kind: 'light',
      id: light.id,
      hueId: hueIds.get(`light:${light.id}`) ?? '1',
      name: light.name,
      state: light.state,
      supportsColor: profile.capabilities.includes('color'),
      supportsTemperature: profile.capabilities.includes('colorTemperature'),
      supportsBrightness: profile.brightnessMode !== 'none',
    });
  }

  for (const group of exposedGroups) {
    const members = input.membersOf(group.id);
    targets.push({
      kind: 'group',
      id: group.id,
      hueId: hueIds.get(`group:${group.id}`) ?? '1',
      name: group.name,
      state: aggregateState(members.map((member) => member.state)),
      supportsColor: members.some((m) => getRemoteTypeProfile(m.remoteType).capabilities.includes('color')),
      supportsTemperature: members.some((m) =>
        getRemoteTypeProfile(m.remoteType).capabilities.includes('colorTemperature'),
      ),
      supportsBrightness: members.some((m) => getRemoteTypeProfile(m.remoteType).brightnessMode !== 'none'),
    });
  }

  for (const scene of exposedScenes) {
    targets.push({
      kind: 'scene',
      id: scene.id,
      hueId: hueIds.get(`scene:${scene.id}`) ?? '1',
      name: scene.name,
      state: null,
      supportsColor: false,
      supportsTemperature: false,
      supportsBrightness: false,
    });
  }

  return targets;
}

/** A group is "on" when any member is on; brightness is the mean of the lit members. */
export function aggregateState(states: LightState[]): LightState | null {
  if (states.length === 0) return null;
  const on = states.filter((state) => state.power === 'on');
  const base = on[0] ?? states[0];
  if (base === undefined) return null;

  const brightness =
    on.length === 0
      ? base.brightness
      : Math.round(on.reduce((sum, state) => sum + state.brightness, 0) / on.length);

  return { ...base, power: on.length > 0 ? 'on' : 'off', brightness };
}

export function hueLightType(target: HueTarget): string {
  if (target.supportsColor && target.supportsTemperature) return 'Extended color light';
  if (target.supportsColor) return 'Color light';
  if (target.supportsTemperature) return 'Color temperature light';
  if (target.supportsBrightness) return 'Dimmable light';
  return 'On/Off plug-in unit';
}

export function hueModelId(target: HueTarget): string {
  if (target.supportsColor && target.supportsTemperature) return 'LCT015';
  if (target.supportsColor) return 'LST002';
  if (target.supportsTemperature) return 'LTW012';
  return 'LWB010';
}

/** Build the `state` object of a Hue light resource. */
export function toHueState(target: HueTarget): Record<string, unknown> {
  const state = target.state;
  const on = state?.power === 'on';
  const colormode = state?.colorMode === 'color' ? 'hs' : 'ct';

  const base: Record<string, unknown> = {
    on,
    reachable: state?.reachable ?? true,
    alert: 'none',
    mode: 'homeautomation',
  };

  if (target.supportsBrightness) {
    base.bri = clamp(percentToByte(state?.brightness ?? 100), 1, 254);
  }
  if (target.supportsColor) {
    base.hue = Math.round(((state?.hue ?? 0) / 360) * 65_535);
    base.sat = percentToByte(state?.saturation ?? 0);
    base.effect = 'none';
    base.xy = [0.3227, 0.329];
  }
  if (target.supportsTemperature) {
    base.ct = kelvinToMired(state?.colorTemperature ?? 4000);
  }
  if (target.supportsColor || target.supportsTemperature) {
    base.colormode = colormode;
  }

  return base;
}

export function toHueLight(target: HueTarget, bridgeId: string): Record<string, unknown> {
  return {
    state: toHueState(target),
    type: hueLightType(target),
    name: target.name,
    modelid: hueModelId(target),
    manufacturername: 'Signify Netherlands B.V.',
    productname: 'Milight Studio',
    uniqueid: `${bridgeId.slice(0, 12).replace(/(..)/g, '$1:').slice(0, 17).toLowerCase()}-${target.hueId}`,
    swversion: '1.104.2',
  };
}

/** Convert CIE 1931 xy (plus brightness) into hue/saturation. */
export function xyToHueSat(x: number, y: number): { hue: number; saturation: number } {
  const safeY = y === 0 ? 0.000_001 : y;
  const z = 1 - x - safeY;
  const bigY = 1;
  const bigX = (bigY / safeY) * x;
  const bigZ = (bigY / safeY) * z;

  let r = bigX * 1.656_492 - bigY * 0.354_851 - bigZ * 0.255_038;
  let g = -bigX * 0.707_196 + bigY * 1.655_397 + bigZ * 0.036_152;
  let b = bigX * 0.051_713 - bigY * 0.121_364 + bigZ * 1.011_53;

  const gamma = (v: number): number =>
    v <= 0.003_130_8 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;

  const max = Math.max(r, g, b, 1);
  r = gamma(r / max);
  g = gamma(g / max);
  b = gamma(b / max);

  const hsv = rgbToHsv({ r: clamp(r * 255, 0, 255), g: clamp(g * 255, 0, 255), b: clamp(b * 255, 0, 255) });
  return { hue: hsv.hue, saturation: hsv.saturation };
}

/**
 * Translate a Hue `PUT /lights/:id/state` body into our own command vocabulary.
 * Returns `null` when the body contains nothing we can act on.
 */
export function hueStateToCommand(body: Record<string, unknown>, current?: LightState): LightCommand | null {
  const command: LightCommand = {};

  if (typeof body.on === 'boolean') command.power = body.on ? 'on' : 'off';

  if (typeof body.bri === 'number') command.brightness = clamp(byteToPercent(body.bri), 1, 100);
  else if (typeof body.bri_inc === 'number' && body.bri_inc !== 0) {
    command.brightnessStep = clamp(Math.round((body.bri_inc / 254) * 100), -100, 100);
  }

  if (typeof body.ct === 'number') command.colorTemperature = miredToKelvin(body.ct);

  if (Array.isArray(body.xy) && body.xy.length === 2) {
    const [x, y] = body.xy as [number, number];
    if (typeof x === 'number' && typeof y === 'number') {
      const { hue, saturation } = xyToHueSat(x, y);
      command.hue = hue;
      command.saturation = saturation;
      delete command.colorTemperature;
    }
  } else if (typeof body.hue === 'number' || typeof body.sat === 'number') {
    const hue = typeof body.hue === 'number' ? body.hue : ((current?.hue ?? 0) / 360) * 65_535;
    const sat = typeof body.sat === 'number' ? body.sat : percentToByte(current?.saturation ?? 100);
    command.hue = Math.round((clamp(hue, 0, 65_535) / 65_535) * 359);
    command.saturation = byteToPercent(sat);
    delete command.colorTemperature;
  }

  if (typeof body.transitiontime === 'number') {
    // Hue expresses transition time in deciseconds.
    command.transitionMs = clamp(Math.round(body.transitiontime * 100), 0, 600_000);
  }

  return Object.keys(command).length === 0 ? null : command;
}

/** Hue answers a state PUT with one success entry per field that was applied. */
export function hueSuccessResponse(hueId: string, body: Record<string, unknown>): unknown[] {
  return Object.entries(body).map(([key, value]) => ({
    success: { [`/lights/${hueId}/state/${key}`]: value },
  }));
}
