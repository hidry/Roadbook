import { expect, test } from '@playwright/test';

// Full functional flow against a local Supabase (booted by the e2e-web CI job):
// sign up -> land in the app -> create a trip (Reise) -> open it -> add a stop.
// Auth goes to Supabase; the CRUD writes to the on-device store (here: wa-sqlite
// in the browser), exercising the real offline-first write path.
test('sign up, then create a trip and a stop', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const tripName = `Norwegen ${stamp}`;
  const stopName = `Westküste ${stamp}`;

  // Surface in-browser errors (e.g. a swallowed SQLite write failure) into the
  // test stdout so the CI diagnostic comment shows the real runtime cause.
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  // create() runs in an onPress handler; a thrown error becomes an UNHANDLED
  // rejection (not a pageerror), so capture those too.
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (e) => {
      const r = (e as PromiseRejectionEvent).reason;
      console.error('[unhandledrejection] ' + (r && r.message ? r.message : String(r)));
    });
  });

  await page.goto('/');

  // Register a fresh user (local Supabase has email confirmations disabled).
  // Use testIDs: login + sign-up share the email placeholder and the web stack
  // keeps the previous screen mounted, so a placeholder lookup is ambiguous.
  await page.getByText('Registrieren').click();
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('Passw0rd!test');
  await page.getByText('Konto erstellen').click();

  // Landed in the app (Reisen screen).
  await expect(page.getByText('Neue Reise')).toBeVisible();

  // Create a trip and open it.
  await page.getByPlaceholder('z. B. Norwegen 2026').fill(tripName);
  await page.getByText('Anlegen', { exact: true }).click();
  await expect(page.getByText(tripName)).toBeVisible();
  await page.getByText(tripName).click();

  // Add a stop inside it.
  await expect(page.getByText('Stopp hinzufügen')).toBeVisible();
  await page.getByPlaceholder('Name des Stopps').fill(stopName);
  await page.getByText('Hinzufügen', { exact: true }).click();
  await expect(page.getByText(stopName)).toBeVisible();
});
