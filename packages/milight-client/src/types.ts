import type { RemoteType } from '@milight-studio/shared';

/** Physical radio address of a bulb or zone. */
export interface HubAddress {
  deviceId: string;
  remoteType: RemoteType;
  groupId: number;
}

/**
 * Commands the hub accepts in the `commands` array of a gateway PUT.
 * See the "Device Control" section of the hub's OpenAPI document.
 */
export const HUB_COMMANDS = [
  'set_white',
  'night_mode',
  'pair',
  'unpair',
  'level_up',
  'level_down',
  'temperature_up',
  'temperature_down',
  'next_mode',
  'previous_mode',
  'mode_speed_up',
  'mode_speed_down',
  'toggle',
] as const;

export type HubCommand = (typeof HUB_COMMANDS)[number];

/**
 * Request body for `PUT /gateways/:device-id/:remote-type/:group-id`.
 *
 * Key order matters: the hub applies fields in the order they appear in the JSON
 * document, so `status` must be serialised before `level`, and colour before effects.
 */
export interface HubCommandBody {
  status?: 'ON' | 'OFF';
  commands?: HubCommand[];
  level?: number;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  mode?: number;
  transition?: number;
}

/** Response body of `GET /gateways/:device-id/:remote-type/:group-id`. */
export interface HubGroupState {
  state?: 'ON' | 'OFF';
  status?: 'ON' | 'OFF';
  level?: number;
  brightness?: number;
  hue?: number;
  saturation?: number;
  color_temp?: number;
  kelvin?: number;
  mode?: number;
  bulb_mode?: string;
  color_mode?: string;
  computed_color?: { r: number; g: number; b: number } | string;
  effect?: string;
  device_id?: number | string;
  group_id?: number;
  device_type?: string;
}

export interface HubAbout {
  firmware?: string;
  version?: string;
  ip_address?: string;
  reset_reason?: string;
  free_heap?: number;
  arduino_version?: string;
  queue_stats?: Record<string, unknown>;
}

export interface HubAlias {
  id: number;
  alias: string;
  device_id: number;
  group_id: number;
  device_type: string;
}

export interface HubAliasList {
  aliases: HubAlias[];
  page?: number;
  count?: number;
  num_pages?: number;
}
