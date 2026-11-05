import { test, expect } from '@playwright/test';

test('shows the app name', async ({ page }) => {
  await page.goto('/admin/');

  await expect(page.getByRole('link', { name: 'HomeyDash' })).toHaveAttribute(
    'href',
    '/admin/',
  );
});
