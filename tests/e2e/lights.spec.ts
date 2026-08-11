import { expect, test } from '@playwright/test';

import {
  addLightThroughWizard,
  createLightViaApi,
  expandLight,
  gotoScreen,
  hubCommandsFor,
  mergedHubBody,
  openApp,
  pressWhenIdle,
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

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await resetHub(request);
});

test.describe('lights', () => {
  test('adds an rgb_cct light through the wizard and drives it on the radio', async ({ page, request }) => {
    await openApp(page);
    await addLightThroughWizard(page, {
      name: 'Bank',
      room: 'Woonkamer',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
    });

    const card = page.getByRole('article', { name: 'Bank' });
    await expect(card.getByText(/Woonkamer/)).toBeVisible();
    await expect(card.getByText('Onbereikbaar')).toHaveCount(0);
    await resetHub(request);

    // Power on.
    await card.getByRole('switch', { name: 'Bank aan of uit' }).click();
    await expect(card.getByRole('switch', { name: 'Bank aan of uit' })).toBeChecked();
    await expect
      .poll(async () => (await hubCommandsFor(request, BANK)).map((entry) => entry.body))
      .toContainEqual({ status: 'ON' });

    // Brightness.
    await resetHub(request);
    await expandLight(page, 'Bank');
    await card.getByLabel('Helderheid — Bank').fill('40');
    await expect.poll(async () => (await mergedHubBody(request, BANK)).level).toBe(40);

    // Colour.
    await resetHub(request);
    const wheel = card.getByRole('slider', { name: 'Kleurenwiel — Bank' });
    await pressWhenIdle(wheel, 'ArrowUp');
    await expect(wheel).toHaveAttribute('aria-valuetext', /verzadiging 5 procent/);
    await pressWhenIdle(wheel, 'ArrowUp');
    await expect(wheel).toHaveAttribute('aria-valuetext', /verzadiging 10 procent/);
    await pressWhenIdle(wheel, 'ArrowRight');
    await expect(wheel).toHaveAttribute('aria-valuenow', '5');

    await expect
      .poll(async () => {
        const body = await mergedHubBody(request, BANK);
        return { hue: body.hue, saturation: body.saturation };
      })
      .toEqual({ hue: 5, saturation: 10 });
  });

  test('renders a temperature slider but no colour picker for a cct light', async ({ page, request }) => {
    await createLightViaApi(request, {
      name: 'Plafond',
      room: 'Keuken',
      deviceId: '0x0002',
      remoteType: 'cct',
      groupId: 2,
    });

    await openApp(page);
    await expandLight(page, 'Plafond');

    const card = page.getByRole('article', { name: 'Plafond' });
    await expect(card.getByLabel('Kleurtemperatuur — Plafond')).toBeVisible();
    await expect(card.getByRole('slider', { name: 'Kleurenwiel — Plafond' })).toHaveCount(0);
    await expect(card.getByLabel('Effect')).toHaveCount(0);

    await resetHub(request);
    await card.getByLabel('Kleurtemperatuur — Plafond').fill('5000');

    await expect
      .poll(async () =>
        Object.keys(await mergedHubBody(request, { deviceId: '0x0002', remoteType: 'cct', groupId: 2 })),
      )
      .toContain('color_temp');
  });

  test('renders a colour picker but no temperature slider for an rgb light', async ({ page, request }) => {
    await createLightViaApi(request, {
      name: 'Strip',
      deviceId: '0x0003',
      remoteType: 'rgb',
      groupId: 0,
    });

    await openApp(page);
    await expandLight(page, 'Strip');

    const card = page.getByRole('article', { name: 'Strip' });
    await expect(card.getByRole('slider', { name: 'Kleurenwiel — Strip' })).toBeVisible();
    await expect(card.getByLabel('Kleurtemperatuur — Strip')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Feller' })).toBeVisible();
  });

  test('deletes a light from its edit dialog', async ({ page, request }) => {
    await createLightViaApi(request, {
      name: 'Bank',
      room: 'Woonkamer',
      deviceId: '0x0001',
      remoteType: 'rgb_cct',
      groupId: 1,
    });

    await openApp(page);
    await page.getByRole('button', { name: 'Bewerk Bank' }).click();

    const dialog = page.getByRole('dialog', { name: 'Bank bewerken' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Lamp verwijderen' }).click();

    await expect(page.getByRole('article', { name: 'Bank' })).toHaveCount(0);
    await expect(page.getByText('Nog geen lampen. Voeg er een toe bij Instellingen.')).toBeVisible();

    await gotoScreen(page, 'Lampen');
    await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toHaveCount(0);
  });

  test('rejects an invalid device id in the wizard', async ({ page }) => {
    await openApp(page);
    await gotoScreen(page, 'Instellingen');

    await page.getByLabel('Naam', { exact: true }).fill('Kapot');
    await page.getByLabel('Apparaat-id').fill('nonsens');
    await page.getByRole('button', { name: 'Lamp toevoegen' }).click();

    await expect(page.getByRole('alert').filter({ hasText: '0x1F2A' })).toBeVisible();

    await gotoScreen(page, 'Lampen');
    await expect(page.getByRole('heading', { level: 3, name: 'Kapot' })).toHaveCount(0);
  });
});
