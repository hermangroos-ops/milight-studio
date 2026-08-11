import { expect, type APIRequestContext, type APIResponse, type Locator, type Page } from '@playwright/test';

import { HUB_URL } from '../../playwright.config.js';

export interface HubRequest {
  method: string;
  path: string;
  body?: Record<string, unknown> | string;
}

export interface CreateLightOptions {
  name: string;
  room?: string;
  deviceId: string;
  remoteType: 'rgbw' | 'cct' | 'rgb_cct' | 'rgb' | 'fut089' | 'fut091' | 'fut020';
  groupId: number;
}

interface Identified {
  id: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The server rate-limits to 600 requests a minute in production mode, which a long
 * run can brush against. Back off and retry rather than failing a test for it.
 */
async function withRateLimitRetry(send: () => Promise<APIResponse>, attempts = 4): Promise<APIResponse> {
  let response = await send();
  for (let attempt = 1; attempt < attempts && response.status() === 429; attempt += 1) {
    await sleep(1_000 * attempt);
    response = await send();
  }
  return response;
}

/** Enough headroom for the heaviest single test (a few page loads plus its API calls). */
const MIN_RATE_LIMIT_HEADROOM = 120;

/**
 * Pause before a test if the server's rate-limit budget is nearly spent.
 *
 * A full two-project run makes more than 600 requests a minute, and the browser's own
 * requests cannot be retried — a throttled asset just yields a blank page. Waiting for
 * the window to roll over keeps the suite deterministic instead of mysteriously flaky.
 */
export async function awaitRateLimitHeadroom(request: APIRequestContext): Promise<void> {
  const response = await withRateLimitRetry(() => request.get('/api/v1/health'));
  const headers = response.headers();
  const remaining = Number(headers['x-ratelimit-remaining'] ?? MIN_RATE_LIMIT_HEADROOM);
  if (Number.isNaN(remaining) || remaining >= MIN_RATE_LIMIT_HEADROOM) return;

  const resetSeconds = Number(headers['x-ratelimit-reset'] ?? 60);
  await sleep((Number.isNaN(resetSeconds) ? 60 : resetSeconds) * 1_000 + 500);
}

/** Wipe every light, group and scene so specs can run in any order. */
export async function resetServerState(request: APIRequestContext): Promise<void> {
  await awaitRateLimitHeadroom(request);

  const scenes = await readList<Identified>(request, 'scenes');
  for (const scene of scenes) await request.delete(`/api/v1/scenes/${scene.id}`);

  const groups = await readList<Identified>(request, 'groups');
  for (const group of groups) await request.delete(`/api/v1/groups/${group.id}`);

  const lights = await readList<Identified>(request, 'lights');
  for (const light of lights) await request.delete(`/api/v1/lights/${light.id}`);
}

async function readList<T>(request: APIRequestContext, resource: string): Promise<T[]> {
  const response = await withRateLimitRetry(() => request.get(`/api/v1/${resource}`));
  const payload = (await response.json()) as Record<string, T[]>;
  return payload[resource] ?? [];
}

/** Forget everything the fake hub has recorded so far. */
export async function resetHub(request: APIRequestContext): Promise<void> {
  await request.post(`${HUB_URL}/__reset`);
}

/**
 * Commands the fake hub received, excluding the `/about` health probes the server
 * fires on a timer — those are noise for every assertion in this suite.
 */
export async function hubCommands(request: APIRequestContext): Promise<HubRequest[]> {
  const response = await request.get(`${HUB_URL}/__requests`);
  const all = (await response.json()) as HubRequest[];
  return all.filter((entry) => entry.path !== '/about');
}

/** Hub commands sent to one specific radio address. */
export async function hubCommandsFor(
  request: APIRequestContext,
  address: { deviceId: string; remoteType: string; groupId: number },
): Promise<HubRequest[]> {
  const path = `/gateways/${address.deviceId}/${address.remoteType}/${address.groupId}`;
  return (await hubCommands(request)).filter((entry) => entry.path === path);
}

/** The merged body of every command sent to an address, latest value winning. */
export async function mergedHubBody(
  request: APIRequestContext,
  address: { deviceId: string; remoteType: string; groupId: number },
): Promise<Record<string, unknown>> {
  const commands = await hubCommandsFor(request, address);
  return commands.reduce<Record<string, unknown>>(
    (merged, entry) => (typeof entry.body === 'object' ? { ...merged, ...entry.body } : merged),
    {},
  );
}

export async function createLightViaApi(
  request: APIRequestContext,
  options: CreateLightOptions,
): Promise<string> {
  const response = await withRateLimitRetry(() => request.post('/api/v1/lights', { data: options }));
  expect(response.status(), await response.text()).toBe(201);
  const light = (await response.json()) as Identified;
  return light.id;
}

export async function createGroupViaApi(
  request: APIRequestContext,
  group: { name: string; room?: string; lightIds: string[] },
): Promise<string> {
  const response = await withRateLimitRetry(() => request.post('/api/v1/groups', { data: group }));
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as Identified;
  return created.id;
}

/** Navigate to one of the four screens through the bottom navigation. */
export async function gotoScreen(
  page: Page,
  screen: 'Lampen' | 'Groepen' | 'Scènes' | 'Instellingen',
): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('button', { name: screen })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: screen })).toBeVisible();
}

/** Open the app and wait until the first screen has finished its initial fetch. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Milight Studio' })).toBeVisible();
  await expect(page.getByText('Bezig met laden…')).toHaveCount(0);
}

/**
 * Fill in the add-light wizard on the settings screen and submit it.
 * Returns once the light is listed on the Lampen screen.
 */
export async function addLightThroughWizard(page: Page, options: CreateLightOptions): Promise<void> {
  await gotoScreen(page, 'Instellingen');

  await page.getByLabel('Naam', { exact: true }).fill(options.name);
  if (options.room !== undefined) {
    await page.getByLabel('Kamer (optioneel)').fill(options.room);
  }
  await page.getByLabel('Type afstandsbediening').selectOption(options.remoteType);
  await page.getByLabel('Apparaat-id').fill(options.deviceId);
  await page.getByLabel('Groep (zone)').fill(String(options.groupId));
  await page.getByRole('button', { name: 'Lamp toevoegen' }).click();

  await gotoScreen(page, 'Lampen');
  await expect(page.getByRole('heading', { level: 3, name: options.name })).toBeVisible();
}

/** Expand a light card so its capability-gated controls are rendered. */
export async function expandLight(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Toon instellingen van ${name}` }).click();
}

/**
 * Send a key to a control, first waiting for it to be enabled.
 *
 * A light card disables its controls while a command is in flight and drops any input
 * that arrives meanwhile, so back-to-back key presses are only reliable once the
 * previous command has settled.
 */
export async function pressWhenIdle(control: Locator, key: string): Promise<void> {
  await expect(control).toBeEnabled();
  await control.press(key);
}

/**
 * Press Tab until the given element has focus, the way a keyboard-only user reaches a
 * control. Fails the test rather than looping forever if the element is unreachable.
 */
export async function tabTo(page: Page, target: Locator, maxPresses = 25): Promise<void> {
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Could not reach the target with ${maxPresses} Tab presses`);
}
