import { expect, test } from '@playwright/test';

import { gotoScreen, openApp, resetHub, resetServerState } from './helpers.js';

/**
 * The service worker is exercised in offline.spec.ts. Everywhere else it is blocked:
 * a fresh context would otherwise re-install it and re-download the whole precache on
 * every single test, which is both slow and enough traffic to trip the server's
 * 600-requests-per-minute rate limiter.
 */
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await resetHub(request);
});

test.describe('smoke', () => {
  test('serves the app shell with its Dutch metadata', async ({ page }) => {
    await openApp(page);

    await expect(page).toHaveTitle('Milight Studio');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeVisible();
  });

  test('shows the empty state when nothing is configured', async ({ page }) => {
    await openApp(page);

    await expect(page.getByRole('heading', { level: 2, name: 'Lampen' })).toBeVisible();
    await expect(page.getByText('Nog geen lampen. Voeg er een toe bij Instellingen.')).toBeVisible();

    await gotoScreen(page, 'Groepen');
    await expect(page.getByText('Nog geen groepen aangemaakt.')).toBeVisible();

    await gotoScreen(page, 'Scènes');
    await expect(page.getByText('Nog geen scènes opgeslagen.')).toBeVisible();
  });

  test('reports the hub as reachable on the settings screen', async ({ page }) => {
    await openApp(page);
    await gotoScreen(page, 'Instellingen');

    const hubSection = page.getByRole('region', { name: 'Hub' });
    await expect(hubSection.getByText('Bereikbaar')).toBeVisible();
    await expect(hubSection.getByText('In orde')).toBeVisible();
    await expect(hubSection.getByText('http://127.0.0.1:8099')).toBeVisible();

    await expect(page.getByRole('heading', { level: 3, name: 'Bruggen' })).toBeVisible();
  });

  test('keeps the selected screen after a reload', async ({ page }) => {
    await openApp(page);
    await gotoScreen(page, 'Scènes');

    await page.reload();

    await expect(page.getByRole('heading', { level: 2, name: 'Scènes' })).toBeVisible();
  });
});
