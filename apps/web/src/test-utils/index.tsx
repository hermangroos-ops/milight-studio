import {
  createDefaultLightState,
  type Group,
  type LightState,
  type LightWithState,
  type RemoteType,
  type Scene,
} from '@milight-studio/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { ToastProvider } from '../components/Toast.js';

let counter = 0;

export function makeState(overrides: Partial<LightState> = {}): LightState {
  return { ...createDefaultLightState(new Date('2024-01-01T00:00:00.000Z')), ...overrides };
}

export function makeLight(overrides: Partial<LightWithState> = {}): LightWithState {
  counter += 1;
  const remoteType: RemoteType = overrides.remoteType ?? 'rgb_cct';
  return {
    id: `light-${counter}`,
    name: `Lamp ${counter}`,
    room: 'Woonkamer',
    deviceId: '0x1f2a',
    remoteType,
    groupId: 1,
    exposeToVoice: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    state: makeState(),
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<Group> = {}): Group {
  counter += 1;
  return {
    id: `group-${counter}`,
    name: `Groep ${counter}`,
    room: 'Woonkamer',
    lightIds: [],
    exposeToVoice: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeScene(overrides: Partial<Scene> = {}): Scene {
  counter += 1;
  return {
    id: `scene-${counter}`,
    name: `Scène ${counter}`,
    room: null,
    steps: [{ targetType: 'light', targetId: 'light-1', command: { power: 'on' } }],
    exposeToVoice: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export interface Harness {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => ReactElement;
}

/** Wraps a tree in the providers the app relies on. */
export function createHarness(client: QueryClient = makeQueryClient()): Harness {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}

export function renderWithProviders(ui: ReactElement, client: QueryClient = makeQueryClient()): RenderResult {
  const { wrapper } = createHarness(client);
  return render(ui, { wrapper });
}
