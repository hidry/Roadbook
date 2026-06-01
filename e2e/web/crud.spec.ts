import { expect, test } from '@playwright/test';

// Full functional flow against a local Supabase (booted by the e2e-web CI job):
// sign up -> land in the app -> create a roadbook -> open it -> create a route.
// Auth goes to Supabase; the CRUD writes to the on-device store (here: wa-sqlite
// in the browser), exercising the real offline-first write path.
test('sign up, then create a roadbook and a route', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const rbName = `Norwegen ${stamp}`;
  const routeTitle = `Westküste ${stamp}`;

  await page.goto('/');

  // Register a fresh user (local Supabase has email confirmations disabled).
  // Use testIDs: login + sign-up share the email placeholder and the web stack
  // keeps the previous screen mounted, so a placeholder lookup is ambiguous.
  await page.getByText('Registrieren').click();
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('Passw0rd!test');
  await page.getByText('Konto erstellen').click();

  // Landed in the app (Roadbooks screen).
  await expect(page.getByText('Neues Roadbook')).toBeVisible();

  // Create a roadbook and open it.
  await page.getByPlaceholder('z. B. Norwegen 2026').fill(rbName);
  await page.getByText('Anlegen', { exact: true }).click();
  await expect(page.getByText(rbName)).toBeVisible();
  await page.getByText(rbName).click();

  // Create a route inside it.
  await expect(page.getByText('Neue Route')).toBeVisible();
  await page.getByPlaceholder('z. B. Westküste').fill(routeTitle);
  await page.getByText('Route anlegen').click();
  await expect(page.getByText(routeTitle)).toBeVisible();
});
