import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Landing smoke: the unauthenticated entry point must render, and it must not carry a
 * critical axe violation. `/` is the real entry — the SPA resolves an unauthenticated
 * visitor to the login landing surface, so the first assertion is that redirect, not a
 * direct visit to `/login`.
 */
test.describe('landing page', () => {
  test('renders the login landing with no critical accessibility violations', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations
      .filter((violation) => violation.impact === 'critical')
      .map((violation) => ({ id: violation.id, nodes: violation.nodes.length }));

    expect(critical).toEqual([]);
  });
});
