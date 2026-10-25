import { test, expect } from '@playwright/test';

test('shows the app name', async ({ page }) => {
  await page.goto('/');

  expect(await page.locator('h1').innerText()).toContain('HomeyDash');
});
