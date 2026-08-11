import { expect, test } from '@playwright/test';

import { createLightViaApi, gotoScreen, openApp, resetHub, resetServerState } from './helpers.js';

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

test.describe('realtime updates', () => {
  test('mirrors a light switched on in one tab to another tab', async ({ browser, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });

    const first = await browser.newContext({ serviceWorkers: 'block' });
    const second = await browser.newContext({ serviceWorkers: 'block' });

    try {
      const driver = await first.newPage();
      const observer = await second.newPage();
      await openApp(driver);
      await openApp(observer);

      const observed = observer.getByRole('switch', { name: 'Bank aan of uit' });
      await expect(observed).not.toBeChecked();

      // The observer never reloads: the change has to arrive over the WebSocket.
      const navigations: string[] = [];
      observer.on('framenavigated', (frame) => {
        if (frame === observer.mainFrame()) navigations.push(frame.url());
      });

      await driver.getByRole('switch', { name: 'Bank aan of uit' }).click();
      await expect(driver.getByRole('switch', { name: 'Bank aan of uit' })).toBeChecked();

      await expect(observed).toBeChecked({ timeout: 5_000 });
      expect(navigations).toHaveLength(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('mirrors a light created and renamed elsewhere', async ({ browser, request }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });

    try {
      const page = await context.newPage();
      await openApp(page);
      await expect(page.getByText('Nog geen lampen. Voeg er een toe bij Instellingen.')).toBeVisible();

      const lightId = await createLightViaApi(request, { name: 'Bank', ...BANK });
      await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toBeVisible({
        timeout: 5_000,
      });

      await request.patch(`/api/v1/lights/${lightId}`, { data: { name: 'Leeslamp' } });
      await expect(page.getByRole('heading', { level: 3, name: 'Leeslamp' })).toBeVisible({
        timeout: 5_000,
      });

      await request.delete(`/api/v1/lights/${lightId}`);
      await expect(page.getByRole('heading', { level: 3, name: 'Leeslamp' })).toHaveCount(0, {
        timeout: 5_000,
      });
    } finally {
      await context.close();
    }
  });

  test('mirrors a brightness change to a second tab', async ({ browser, request }) => {
    const lightId = await createLightViaApi(request, { name: 'Bank', ...BANK });
    await request.put(`/api/v1/lights/${lightId}/state`, { data: { power: 'on', brightness: 10 } });

    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await openApp(page);
      await page.getByRole('button', { name: 'Toon instellingen van Bank' }).click();
      await expect(page.getByLabel('Helderheid — Bank')).toHaveValue('10');

      await request.put(`/api/v1/lights/${lightId}/state`, { data: { brightness: 85 } });

      await expect(page.getByLabel('Helderheid — Bank')).toHaveValue('85', { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  test('shows no stale connection warning while the socket is up', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await openApp(page);
      await gotoScreen(page, 'Instellingen');

      await expect(page.getByText('Geen live verbinding')).toHaveCount(0);
      await expect(page.getByText('Verbinden…')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
