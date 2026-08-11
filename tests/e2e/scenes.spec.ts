import { expect, test, type Page } from '@playwright/test';

import {
  createGroupViaApi,
  createLightViaApi,
  gotoScreen,
  hubCommandsFor,
  mergedHubBody,
  openApp,
  resetHub,
  resetServerState,
} from './helpers.js';

/**
 * The service worker is exercised in offline.spec.ts. Everywhere else it is blocked:
 * a fresh context would otherwise re-install it and re-download the whole precache on
 * every single test, which is both slow and enough traffic to trip the server's
 * 600-requests-per-minute rate limiter.
 */
test.use({ serviceWorkers: 'block' });

const BANK = { deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 } as const;
const EETTAFEL = { deviceId: '0x0002', remoteType: 'rgb_cct', groupId: 2 } as const;

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await resetHub(request);
});

async function saveScene(page: Page, name: string, targets: readonly string[]): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe scène' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nieuwe scène' });
  await dialog.getByLabel('Naam', { exact: true }).fill(name);
  for (const target of targets) {
    await dialog.getByRole('checkbox', { name: target }).check();
  }
  await dialog.getByRole('button', { name: 'Scène opslaan' }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}

test.describe('scenes', () => {
  test('captures the current state of a light and replays it on activation', async ({ page, request }) => {
    const lightId = await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await request.put(`/api/v1/lights/${lightId}/state`, {
      data: { power: 'on', brightness: 40 },
    });

    await openApp(page);
    await gotoScreen(page, 'Scènes');
    await saveScene(page, 'Filmavond', ['Bank']);

    // Move the light away from the captured state, then bring it back with one tap.
    await request.put(`/api/v1/lights/${lightId}/state`, { data: { power: 'off' } });
    await resetHub(request);

    await page.getByRole('button', { name: 'Activeer Filmavond' }).click();

    await expect
      .poll(async () => await mergedHubBody(request, BANK))
      .toMatchObject({ status: 'ON', level: 40 });

    await expect(page.getByText(/Scène "Filmavond" geactiveerd/)).toBeVisible();

    await gotoScreen(page, 'Lampen');
    await expect(page.getByRole('switch', { name: 'Bank aan of uit' })).toBeChecked();
  });

  test('captures a colour and replays hue and saturation', async ({ page, request }) => {
    const lightId = await createLightViaApi(request, { name: 'Bank', ...BANK });
    await request.put(`/api/v1/lights/${lightId}/state`, {
      data: { power: 'on', hue: 210, saturation: 80 },
    });

    await openApp(page);
    await gotoScreen(page, 'Scènes');
    await saveScene(page, 'Blauw uur', ['Bank']);

    await resetHub(request);
    await page.getByRole('button', { name: 'Activeer Blauw uur' }).click();

    await expect
      .poll(async () => await mergedHubBody(request, BANK))
      .toMatchObject({ status: 'ON', hue: 210, saturation: 80 });
  });

  test('activates a scene that targets a whole group', async ({ page, request }) => {
    const bankId = await createLightViaApi(request, { name: 'Bank', ...BANK });
    const tafelId = await createLightViaApi(request, { name: 'Eettafel', ...EETTAFEL });
    await createGroupViaApi(request, { name: 'Woonkamer', lightIds: [bankId, tafelId] });
    await request.put(`/api/v1/lights/${bankId}/state`, { data: { power: 'on', brightness: 70 } });

    await openApp(page);
    await gotoScreen(page, 'Scènes');
    await saveScene(page, 'Avond', ['Woonkamer']);

    await resetHub(request);
    await page.getByRole('button', { name: 'Activeer Avond' }).click();

    for (const address of [BANK, EETTAFEL]) {
      await expect
        .poll(async () => await mergedHubBody(request, address))
        .toMatchObject({ status: 'ON', level: 70 });
    }
  });

  test('refuses to save a scene without a name or a target', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', ...BANK });

    await openApp(page);
    await gotoScreen(page, 'Scènes');
    await page.getByRole('button', { name: 'Nieuwe scène' }).click();

    const dialog = page.getByRole('dialog', { name: 'Nieuwe scène' });
    await dialog.getByRole('button', { name: 'Scène opslaan' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Geef de scène een naam.');

    await dialog.getByLabel('Naam', { exact: true }).fill('Leeg');
    await dialog.getByRole('button', { name: 'Scène opslaan' }).click();
    await expect(dialog.getByRole('alert')).toContainText('minstens één lamp of groep');

    expect(await hubCommandsFor(request, BANK)).toHaveLength(0);
  });

  test('deletes a scene', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', ...BANK });

    await openApp(page);
    await gotoScreen(page, 'Scènes');
    await saveScene(page, 'Filmavond', ['Bank']);

    await page.getByRole('button', { name: 'Verwijder Filmavond' }).click();

    await expect(page.getByText('Nog geen scènes opgeslagen.')).toBeVisible();
  });
});
