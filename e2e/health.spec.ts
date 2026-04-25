import { test, expect } from '@playwright/test';

test('login page loads', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Goody POS/i);
});
