/** Central list of React Query cache keys so optimistic updates and the event stream agree. */
export const queryKeys = {
  lights: ['lights'] as const,
  groups: ['groups'] as const,
  scenes: ['scenes'] as const,
  health: ['health'] as const,
  bridges: ['bridges'] as const,
  remoteTypes: ['remote-types'] as const,
};
