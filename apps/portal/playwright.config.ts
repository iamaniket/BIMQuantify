import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/support/global-setup.ts',
  globalTeardown: './tests/support/global-teardown.ts',
  testDir: './tests',
  /* The login.spec.ts tests can run in parallel; the multitenant journey is
   * serial by design (test.describe.serial). Setting fullyParallel: false and
   * workers: 1 ensures the sequential journey never runs alongside itself. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: './test-results',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    /* Always reuse a running server — avoids starting a second Next.js
     * instance when the dev server is already up. */
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
