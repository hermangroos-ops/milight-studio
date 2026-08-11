import type {
  CreateGroupInput,
  CreateLightInput,
  CreateSceneInput,
  Group,
  LightCommand,
  LightWithState,
  Scene,
  UpdateGroupInput,
  UpdateLightInput,
} from '@milight-studio/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useToast } from '../components/Toast.js';
import { applyCommandLocally } from '../state/apply-command.js';

import { ApiError } from './client.js';
import { api, type GroupCommandResult, type SceneActivationResult } from './endpoints.js';
import { queryKeys } from './query-keys.js';

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.fullMessage;
  if (error instanceof Error) return error.message;
  return 'Er ging iets mis.';
}

interface OptimisticContext {
  previous: LightWithState[] | undefined;
}

function patchLights(
  lights: readonly LightWithState[],
  ids: readonly string[],
  command: LightCommand,
): LightWithState[] {
  const targets = new Set(ids);
  return lights.map((light) =>
    targets.has(light.id) ? { ...light, state: applyCommandLocally(light.state, command) } : light,
  );
}

/** Sends a command to one light, updating the cache before the request resolves. */
export function useLightCommand(): UseMutationResult<
  LightWithState,
  unknown,
  { lightId: string; command: LightCommand },
  OptimisticContext
> {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ lightId, command }) => api.setLightState(lightId, command),
    onMutate: async ({ lightId, command }) => {
      await client.cancelQueries({ queryKey: queryKeys.lights });
      const previous = client.getQueryData<LightWithState[]>(queryKeys.lights);
      if (previous) {
        client.setQueryData(queryKeys.lights, patchLights(previous, [lightId], command));
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.lights, context.previous);
      toast.show(describeError(error), 'error');
    },
    onSuccess: (light) => {
      client.setQueryData<LightWithState[]>(queryKeys.lights, (current) =>
        current?.map((candidate) => (candidate.id === light.id ? light : candidate)),
      );
    },
  });
}

/** Sends a command to every member of a group and surfaces per-light failures. */
export function useGroupCommand(): UseMutationResult<
  GroupCommandResult,
  unknown,
  { groupId: string; lightIds: readonly string[]; command: LightCommand },
  OptimisticContext
> {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ groupId, command }) => api.setGroupState(groupId, command),
    onMutate: async ({ lightIds, command }) => {
      await client.cancelQueries({ queryKey: queryKeys.lights });
      const previous = client.getQueryData<LightWithState[]>(queryKeys.lights);
      if (previous) {
        client.setQueryData(queryKeys.lights, patchLights(previous, lightIds, command));
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.lights, context.previous);
      toast.show(describeError(error), 'error');
    },
    onSuccess: (result) => {
      client.setQueryData<LightWithState[]>(queryKeys.lights, (current) => {
        if (!current) return current;
        const updated = new Map(result.lights.map((light) => [light.id, light]));
        return current.map((light) => updated.get(light.id) ?? light);
      });
      for (const failure of result.failed) {
        toast.show(`Lamp ${failure.lightId}: ${failure.message}`, 'error');
      }
    },
  });
}

function useInvalidating<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  keys: readonly (readonly string[])[],
  successMessage?: string,
): UseMutationResult<TData, unknown, TVariables> {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onError: (error) => {
      toast.show(describeError(error), 'error');
    },
    onSuccess: () => {
      for (const key of keys) void client.invalidateQueries({ queryKey: key });
      if (successMessage !== undefined) toast.show(successMessage, 'success');
    },
  });
}

export function useCreateLight(): UseMutationResult<LightWithState, unknown, CreateLightInput> {
  return useInvalidating(
    (input: CreateLightInput) => api.createLight(input),
    [queryKeys.lights],
    'Lamp toegevoegd.',
  );
}

export function useUpdateLight(): UseMutationResult<
  LightWithState,
  unknown,
  { id: string; input: UpdateLightInput }
> {
  return useInvalidating(
    ({ id, input }) => api.updateLight(id, input),
    [queryKeys.lights],
    'Lamp bijgewerkt.',
  );
}

export function useDeleteLight(): UseMutationResult<void, unknown, string> {
  return useInvalidating(
    (id: string) => api.deleteLight(id),
    [queryKeys.lights, queryKeys.groups],
    'Lamp verwijderd.',
  );
}

export function usePairLight(): UseMutationResult<void, unknown, { id: string; pair: boolean }> {
  return useInvalidating(
    ({ id, pair }) => (pair ? api.pairLight(id) : api.unpairLight(id)),
    [queryKeys.lights],
    'Commando verstuurd. Zet de lamp binnen 3 seconden aan.',
  );
}

export function useCreateGroup(): UseMutationResult<Group, unknown, CreateGroupInput> {
  return useInvalidating(
    (input: CreateGroupInput) => api.createGroup(input),
    [queryKeys.groups],
    'Groep aangemaakt.',
  );
}

export function useUpdateGroup(): UseMutationResult<Group, unknown, { id: string; input: UpdateGroupInput }> {
  return useInvalidating(
    ({ id, input }) => api.updateGroup(id, input),
    [queryKeys.groups],
    'Groep bijgewerkt.',
  );
}

export function useDeleteGroup(): UseMutationResult<void, unknown, string> {
  return useInvalidating((id: string) => api.deleteGroup(id), [queryKeys.groups], 'Groep verwijderd.');
}

export function useCreateScene(): UseMutationResult<Scene, unknown, CreateSceneInput> {
  return useInvalidating(
    (input: CreateSceneInput) => api.createScene(input),
    [queryKeys.scenes],
    'Scène opgeslagen.',
  );
}

export function useDeleteScene(): UseMutationResult<void, unknown, string> {
  return useInvalidating((id: string) => api.deleteScene(id), [queryKeys.scenes], 'Scène verwijderd.');
}

export function useActivateScene(): UseMutationResult<SceneActivationResult, unknown, string> {
  const client = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (sceneId: string) => api.activateScene(sceneId),
    onError: (error) => {
      toast.show(describeError(error), 'error');
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: queryKeys.lights });
      toast.show(
        `Scène "${result.scene.name}" geactiveerd (${result.appliedSteps} stappen).`,
        result.failed.length > 0 ? 'error' : 'success',
      );
    },
  });
}
