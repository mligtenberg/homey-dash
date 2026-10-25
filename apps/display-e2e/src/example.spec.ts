import { test, expect } from '@playwright/test';

test('shows the display root', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hd-display')).toBeVisible();
});
