import { defineConfig, devices } from '@playwright/test';

/* The marketing web app (port 3000) is only needed by admin-blog.spec.ts. When
 * it is started for every run, a `--ui` session for any other suite has to wait
 * for its (cold, sometimes minutes-long) compile before the test tree even
 * loads — Playwright blocks on every configured webServer's `url` becoming
 * reachable. That is a second, separate cause of "UI mode hangs on Loading…".
 * Only include it when the run targets admin-blog, or when no specific spec is
 * named (a full `playwright test` run, which does include admin-blog). */
const argv = process.argv.join(' ');
const includeWebApp = !/\.spec\.ts\b/.test(argv) || argv.includes('admin-blog');

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
    /* Cap per-action waits.  Playwright's default actionTimeout is 0 (unbounded),
     * so a click/fill on an element that never appears — e.g. a tab on a route
     * that is still cold-compiling or silently redirected to /login in --ui mode
     * — auto-waits until the whole 120 s *test* timeout, surfacing as an opaque
     * "Test timeout of 120000ms exceeded" with no hint which action hung.  A
     * bounded actionTimeout instead fails fast with the exact locator
     * ("locator.click: Timeout 30000ms … waiting for getByRole('tab', …)"),
     * which is the difference between a debuggable run and a 2-minute mystery.
     * 30 s is generous enough that a slow-but-working --ui render still passes. */
    actionTimeout: 30_000,
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
     * (one render check at /nl/blog/<slug>). Included only when the run targets
     * it (see `includeWebApp`) so other suites' --ui sessions don't block on its
     * compile. Reuse any running instance so a `pnpm --filter=web dev` in
     * another terminal isn't duplicated. */
    ...(includeWebApp
      ? [{
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
        }]
      : []),
  ],
});
