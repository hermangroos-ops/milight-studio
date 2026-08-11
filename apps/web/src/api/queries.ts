import type {
  BridgeStatus,
  Group,
  Health,
  LightWithState,
  RemoteTypeProfile,
  Scene,
} from '@milight-studio/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './endpoints.js';
import { queryKeys } from './query-keys.js';

export function useLights(): UseQueryResult<LightWithState[]> {
  return useQuery({ queryKey: queryKeys.lights, queryFn: api.listLights });
}

export function useGroups(): UseQueryResult<Group[]> {
  return useQuery({ queryKey: queryKeys.groups, queryFn: api.listGroups });
}

export function useScenes(): UseQueryResult<Scene[]> {
  return useQuery({ queryKey: queryKeys.scenes, queryFn: api.listScenes });
}

export function useHealth(): UseQueryResult<Health> {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 30_000 });
}

export function useBridges(): UseQueryResult<BridgeStatus[]> {
  return useQuery({ queryKey: queryKeys.bridges, queryFn: api.bridges });
}

export function useRemoteTypes(): UseQueryResult<RemoteTypeProfile[]> {
  return useQuery({ queryKey: queryKeys.remoteTypes, queryFn: api.remoteTypes, staleTime: Infinity });
}
