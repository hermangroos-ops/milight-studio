import { expect, test, type Page } from '@playwright/test';

import {
  createLightViaApi,
  gotoScreen,
  hubCommandsFor,
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
  await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
  await createLightViaApi(request, { name: 'Eettafel', room: 'Woonkamer', ...EETTAFEL });
});

test.describe('groups', () => {
  test('creates a group and drives every member with one switch', async ({ page, request }) => {
    await openApp(page);
    await gotoScreen(page, 'Groepen');

    await page.getByRole('button', { name: 'Nieuwe groep' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nieuwe groep' });
    await dialog.getByLabel('Naam', { exact: true }).fill('Woonkamer');
    await dialog.getByLabel('Kamer (optioneel)').fill('Beneden');
    await dialog.getByRole('checkbox', { name: /Bank/ }).check();
    await dialog.getByRole('checkbox', { name: /Eettafel/ }).check();
    await dialog.getByRole('button', { name: 'Groep aanmaken' }).click();

    const card = page.getByRole('article', { name: 'Woonkamer' });
    await expect(card).toBeVisible();
    await expect(card.getByText(/2 lampen/)).toBeVisible();

    await resetHub(request);
    await card.getByRole('switch', { name: 'Woonkamer aan of uit' }).click();

    // One radio command per member, each to its own address.
    await expect
      .poll(async () => (await hubCommandsFor(request, BANK)).map((entry) => entry.body))
      .toContainEqual({ status: 'ON' });
    await expect
      .poll(async () => (await hubCommandsFor(request, EETTAFEL)).map((entry) => entry.body))
      .toContainEqual({ status: 'ON' });
    await expect.poll(async () => (await hubCommandsFor(request, BANK)).length).toBe(1);
    await expect.poll(async () => (await hubCommandsFor(request, EETTAFEL)).length).toBe(1);
  });

  test('drives the whole group from the shared controls', async ({ page, request }) => {
    await openApp(page);
    await gotoScreen(page, 'Groepen');
    await createGroupThroughUi(page, 'Woonkamer', ['Bank', 'Eettafel']);

    const card = page.getByRole('article', { name: 'Woonkamer' });
    await card.getByRole('switch', { name: 'Woonkamer aan of uit' }).click();
    await resetHub(request);

    await card.getByRole('button', { name: 'Toon bediening van Woonkamer' }).click();
    await card.getByLabel('Helderheid — Woonkamer').fill('55');

    for (const address of [BANK, EETTAFEL]) {
      await expect
        .poll(async () => (await hubCommandsFor(request, address)).map((entry) => entry.body))
        .toContainEqual({ level: 55 });
    }
  });

  test('edits a group down to one member', async ({ page, request }) => {
    await openApp(page);
    await gotoScreen(page, 'Groepen');
    await createGroupThroughUi(page, 'Woonkamer', ['Bank', 'Eettafel']);

    await page.getByRole('button', { name: 'Bewerk Woonkamer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Woonkamer bewerken' });
    await dialog.getByRole('checkbox', { name: /Eettafel/ }).uncheck();
    await dialog.getByRole('button', { name: 'Groep opslaan' }).click();

    const card = page.getByRole('article', { name: 'Woonkamer' });
    await expect(card.getByText(/1 lampen/)).toBeVisible();

    await resetHub(request);
    await card.getByRole('switch', { name: 'Woonkamer aan of uit' }).click();

    await expect.poll(async () => (await hubCommandsFor(request, BANK)).length).toBe(1);
    await expect.poll(async () => (await hubCommandsFor(request, EETTAFEL)).length).toBe(0);
  });

  test('deletes a group without deleting its lights', async ({ page }) => {
    await openApp(page);
    await gotoScreen(page, 'Groepen');
    await createGroupThroughUi(page, 'Woonkamer', ['Bank']);

    await page.getByRole('button', { name: 'Verwijder Woonkamer' }).click();

    await expect(page.getByText('Nog geen groepen aangemaakt.')).toBeVisible();

    await gotoScreen(page, 'Lampen');
    await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toBeVisible();
  });
});

async function createGroupThroughUi(page: Page, name: string, members: readonly string[]): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe groep' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nieuwe groep' });
  await dialog.getByLabel('Naam', { exact: true }).fill(name);
  for (const member of members) {
    await dialog.getByRole('checkbox', { name: new RegExp(member) }).check();
  }
  await dialog.getByRole('button', { name: 'Groep aanmaken' }).click();
  await expect(page.getByRole('article', { name })).toBeVisible();
}
