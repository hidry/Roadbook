import { expect, test } from '@playwright/test';

// Boot smoke test — needs no backend. Proves the whole web stack comes up in a
// real browser: bundle loads, expo-sqlite (wa-sqlite) initialises, Expo Router
// resolves, and the logged-out gate lands on the login screen.
test('boots to the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Anmelden')).toBeVisible();
  await expect(page.getByPlaceholder('du@example.com')).toBeVisible();
});
