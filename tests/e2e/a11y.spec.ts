import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  createLightViaApi,
  gotoScreen,
  hubCommandsFor,
  openApp,
  resetHub,
  resetServerState,
  tabTo,
} from './helpers.js';

/**
 * The service worker is exercised in offline.spec.ts. Everywhere else it is blocked:
 * a fresh context would otherwise re-install it and re-download the whole precache on
 * every single test, which is both slow and enough traffic to trip the server's
 * 600-requests-per-minute rate limiter.
 */
// Reduced motion removes the entry animations, so axe never samples an element
// mid-fade and reports a colour-contrast failure that no user would ever see.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BANK = { deviceId: '0x0001', remoteType: 'rgb_cct', groupId: 1 } as const;

async function analyse(page: Page): Promise<Awaited<ReturnType<AxeBuilder['analyze']>>> {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

function describeViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>): string {
  return results.violations
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
    .join('\n');
}

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await resetHub(request);
});

test.describe('accessibility', () => {
  test('has no WCAG violations on any screen', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    const tafelId = await createLightViaApi(request, {
      name: 'Eettafel',
      room: 'Woonkamer',
      deviceId: '0x0002',
      remoteType: 'cct',
      groupId: 2,
    });
    await request.post('/api/v1/groups', {
      data: { name: 'Woonkamer', room: 'Beneden', lightIds: [tafelId] },
    });
    await request.post('/api/v1/scenes', {
      data: {
        name: 'Filmavond',
        steps: [{ targetType: 'group', targetId: tafelId, command: { power: 'on' } }],
      },
    });

    await openApp(page);

    // Lampen, including an expanded card so every control is analysed.
    await page.getByRole('button', { name: 'Toon instellingen van Bank' }).click();
    await expect(page.getByRole('slider', { name: 'Kleurenwiel — Bank' })).toBeVisible();
    expect(describeViolations(await analyse(page))).toBe('');

    for (const screen of ['Groepen', 'Scènes', 'Instellingen'] as const) {
      await gotoScreen(page, screen);
      expect(describeViolations(await analyse(page)), `violations on ${screen}`).toBe('');
    }
  });

  test('has no WCAG violations with a modal open', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);

    await page.getByRole('button', { name: 'Bewerk Bank' }).click();
    await expect(page.getByRole('dialog', { name: 'Bank bewerken' })).toBeVisible();

    expect(describeViolations(await analyse(page))).toBe('');
  });

  test('has no WCAG violations on the group dialog', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);
    await gotoScreen(page, 'Groepen');

    await page.getByRole('button', { name: 'Nieuwe groep' }).click();
    await expect(page.getByRole('dialog', { name: 'Nieuwe groep' })).toBeVisible();

    expect(describeViolations(await analyse(page))).toBe('');
  });

  test('can be driven with the keyboard alone', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);

    const toggle = page.getByRole('switch', { name: 'Bank aan of uit' });
    const expand = page.getByRole('button', { name: 'Toon instellingen van Bank' });

    // Tab from the document start until focus lands on the light's switch.
    await tabTo(page, toggle);
    await expect(toggle).toBeFocused();

    await resetHub(request);
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => (await hubCommandsFor(request, BANK)).map((entry) => entry.body))
      .toContainEqual({ status: 'ON' });

    // Reveal the controls with the keyboard.
    await tabTo(page, expand);
    await page.keyboard.press('Enter');

    const brightness = page.getByLabel('Helderheid — Bank');
    await expect(brightness).toBeVisible();
    await expect(brightness).toBeEnabled();

    await tabTo(page, brightness);
    const before = Number(await brightness.inputValue());

    await resetHub(request);
    await page.keyboard.press('ArrowLeft');

    await expect(brightness).toHaveValue(String(before - 1));
    await expect
      .poll(async () =>
        (await hubCommandsFor(request, BANK))
          .map((entry) => (typeof entry.body === 'object' ? entry.body.level : undefined))
          .filter((level) => level !== undefined),
      )
      .toContain(before - 1);
  });

  test('drives the colour wheel with the arrow keys', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);
    await page.getByRole('button', { name: 'Toon instellingen van Bank' }).click();

    const wheel = page.getByRole('slider', { name: 'Kleurenwiel — Bank' });
    await expect(wheel).toBeEnabled();
    await tabTo(page, wheel);
    await expect(wheel).toHaveAttribute('aria-valuenow', '0');

    await resetHub(request);
    await page.keyboard.press('ArrowRight');

    await expect(wheel).toHaveAttribute('aria-valuenow', '5');
    await expect(wheel).toHaveAttribute('aria-valuetext', /Tint 5 graden/);
    await expect
      .poll(async () => (await hubCommandsFor(request, BANK)).map((entry) => entry.body))
      .toContainEqual({ hue: 5, saturation: 0 });
  });

  /**
   * Regression guard: controls used to be disabled while a command was in flight, which
   * blurred whatever the user was operating and swallowed keys pressed during the round
   * trip. Commands are optimistic, so the controls now stay enabled.
   */
  test('keeps focus on a control after using it', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);
    await page.getByRole('button', { name: 'Toon instellingen van Bank' }).click();

    const brightness = page.getByLabel('Helderheid — Bank');
    await brightness.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    await expect(brightness).toBeFocused({ timeout: 2_000 });
    await expect(brightness).toHaveValue('98', { timeout: 2_000 });
  });

  test('traps focus in a dialog and closes it with Escape', async ({ page, request }) => {
    await createLightViaApi(request, { name: 'Bank', room: 'Woonkamer', ...BANK });
    await openApp(page);

    const trigger = page.getByRole('button', { name: 'Bewerk Bank' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Bank bewerken' });
    await expect(dialog.getByRole('button', { name: 'Sluiten' })).toBeFocused();

    // Tabbing all the way round stays inside the dialog.
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
      expect(inside, `focus escaped the dialog after ${step + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
