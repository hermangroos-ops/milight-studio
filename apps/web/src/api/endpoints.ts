import type {
  BridgeStatus,
  CreateGroupInput,
  CreateLightInput,
  CreateSceneInput,
  Group,
  Health,
  LightCommand,
  LightWithState,
  RemoteTypeProfile,
  Scene,
  UpdateGroupInput,
  UpdateLightInput,
  UpdateSceneInput,
} from '@milight-studio/shared';

import { request, requestVoid } from './client.js';

export interface CommandFailure {
  lightId: string;
  code: string;
  message: string;
}

export interface GroupCommandResult {
  group: Group;
  lights: LightWithState[];
  failed: CommandFailure[];
}

export interface SceneActivationResult {
  scene: Scene;
  appliedSteps: number;
  failed: CommandFailure[];
}

export const api = {
  health: () => request<Health>('/health'),
  remoteTypes: () =>
    request<{ remoteTypes: RemoteTypeProfile[] }>('/remote-types').then((data) => data.remoteTypes),
  bridges: () => request<{ bridges: BridgeStatus[] }>('/bridges').then((data) => data.bridges),

  listLights: () => request<{ lights: LightWithState[] }>('/lights').then((data) => data.lights),
  getLight: (id: string) => request<LightWithState>(`/lights/${id}`),
  createLight: (input: CreateLightInput) =>
    request<LightWithState>('/lights', { method: 'POST', body: input }),
  updateLight: (id: string, input: UpdateLightInput) =>
    request<LightWithState>(`/lights/${id}`, { method: 'PATCH', body: input }),
  deleteLight: (id: string) => requestVoid(`/lights/${id}`, { method: 'DELETE' }),
  setLightState: (id: string, command: LightCommand) =>
    request<LightWithState>(`/lights/${id}/state`, { method: 'PUT', body: command }),
  refreshLight: (id: string) => request<LightWithState>(`/lights/${id}/refresh`, { method: 'POST' }),
  pairLight: (id: string) => requestVoid(`/lights/${id}/pair`, { method: 'POST' }),
  unpairLight: (id: string) => requestVoid(`/lights/${id}/unpair`, { method: 'POST' }),

  listGroups: () => request<{ groups: Group[] }>('/groups').then((data) => data.groups),
  getGroup: (id: string) => request<Group>(`/groups/${id}`),
  groupLights: (id: string) =>
    request<{ lights: LightWithState[] }>(`/groups/${id}/lights`).then((data) => data.lights),
  createGroup: (input: CreateGroupInput) => request<Group>('/groups', { method: 'POST', body: input }),
  updateGroup: (id: string, input: UpdateGroupInput) =>
    request<Group>(`/groups/${id}`, { method: 'PATCH', body: input }),
  deleteGroup: (id: string) => requestVoid(`/groups/${id}`, { method: 'DELETE' }),
  setGroupState: (id: string, command: LightCommand) =>
    request<GroupCommandResult>(`/groups/${id}/state`, { method: 'PUT', body: command }),

  listScenes: () => request<{ scenes: Scene[] }>('/scenes').then((data) => data.scenes),
  createScene: (input: CreateSceneInput) => request<Scene>('/scenes', { method: 'POST', body: input }),
  updateScene: (id: string, input: UpdateSceneInput) =>
    request<Scene>(`/scenes/${id}`, { method: 'PATCH', body: input }),
  deleteScene: (id: string) => requestVoid(`/scenes/${id}`, { method: 'DELETE' }),
  activateScene: (id: string) => request<SceneActivationResult>(`/scenes/${id}/activate`, { method: 'POST' }),
} as const;
