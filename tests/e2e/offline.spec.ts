import { expect, test, type Page } from '@playwright/test';

import { createLightViaApi, resetHub, resetServerState } from './helpers.js';

const BANK = { deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 } as const;

/** Resolves once a service worker controls this page, so a reload can be served from cache. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return registration.active !== null && navigator.serviceWorker.controller !== null;
    },
    undefined,
    { timeout: 15_000 },
  );
}

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await resetHub(request);
});

test.describe('progressive web app', () => {
  test('registers a service worker and ships an installable manifest', async ({ page }) => {
    await page.goto('/');
    await waitForServiceWorker(page);

    const scriptUrl = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.scriptURL ?? null;
    });
    expect(scriptUrl).toContain('/sw.js');

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) return null;
      const response = await fetch(link.href);
      return (await response.json()) as { name: string; theme_color: string; icons: unknown[] };
    });
    expect(manifest).not.toBeNull();

    expect(manifest?.name).toBe('Milight Studio');
    expect(manifest?.theme_color).toBe('#12141a');
    expect(manifest?.icons.length).toBeGreaterThan(0);
  });

  test('still renders the app shell after going offline and reloading', async ({
    page,
    context,
    request,
  }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });

    await page.goto('/');
    await waitForServiceWorker(page);
    await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toBeVisible();

    await context.setOffline(true);
    try {
      await page.reload();

      // Served entirely from the precache: no network reached the server.
      await expect(page.getByRole('heading', { level: 1, name: 'Milight Studio' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Instellingen' })).toBeVisible();

      // The data is gone, so the screen degrades to a readable error rather than a blank page.
      await expect(page.getByRole('alert').filter({ hasText: /niet bereikbaar/i })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test('recovers its data once the network returns', async ({ page, context, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });

    await page.goto('/');
    await waitForServiceWorker(page);
    await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Milight Studio' })).toBeVisible();

    await context.setOffline(false);
    await page.reload();

    await expect(page.getByRole('heading', { level: 3, name: 'Bank' })).toBeVisible();
  });
});
