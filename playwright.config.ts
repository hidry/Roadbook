import { defineConfig, devices } from '@playwright/test';

// Web E2E against the exported Expo web app (dist/). The bundle must be exported
// first (`npm run web:export`) with the Supabase env baked in — the e2e-web CI
// workflow does that against a freshly booted local Supabase. The webServer here
// only serves the already-built dist/ (with COOP/COEP via e2e/serve.mjs).
const PORT = 8080;

export default defineConfig({
  testDir: './e2e/web',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
