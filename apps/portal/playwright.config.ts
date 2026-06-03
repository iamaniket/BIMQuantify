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
  /* 120 s per test — gives headroom in --ui mode where the Playwright UI
   * browser competes for resources during the first Next.js cold compile. */
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:3001',
    /* First navigation in --ui mode triggers lazy Next.js page compilation.
     * Default 30 s is too tight on slower machines; 60 s covers cold starts. */
    navigationTimeout: 60_000,
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
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3001',
      /* Always reuse a running server — avoids starting a second Next.js
       * instance when the dev server is already up. */
      reuseExistingServer: true,
      timeout: 120_000,
    },
    /* The marketing web app on port 3000 is only needed by admin-blog.spec.ts
     * (one render check at /nl/blog/<slug>). Reuse any running instance so
     * `pnpm --filter=web dev` in another terminal isn't duplicated. */
    {
      command: 'pnpm --filter=web dev',
      cwd: '../..',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: process.env['E2E_API_URL']
          ?? process.env['NEXT_PUBLIC_API_URL']
          ?? 'http://localhost:8000',
      },
    },
  ],
});
