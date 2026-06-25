import type { Page } from '@playwright/test';

import { E2E_ENV } from './env';

const STORAGE_KEY = 'bimdossier.tokens';

// In-process token cache: persists across serial tests in the same worker.
// Keyed by email — avoids repeated login API calls within one test run.
const tokenCache = new Map<string, string>();

/**
 * Log in via the UI form.
 * Used for the first login of each role (visually demonstrates the flow).
 * Caches the resulting tokens so subsequent tests can call injectSavedAuth.
 */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
  { expectedPathPattern = /\/(projects|account)/ }: { expectedPathPattern?: RegExp } = {},
): Promise<void> {
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[loginViaUI] ${msg} (+${Date.now() - t0}ms)`);

  log('goto /en/login');
  await page.goto('/en/login');
  log('goto done');
  await page.waitForLoadState('domcontentloaded');
  log('domcontentloaded');
  // Triple-click selects any existing value before fill so React controlled inputs
  // don't accumulate a doubled value on repeated calls (fill alone can append).
  const emailInput = page.locator('input[name="username"]');
  await emailInput.click({ clickCount: 3 });
  await emailInput.fill(email);
  log('email filled');
  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.fill(password);
  log('password filled');

  // Intercept the login response so rate-limit (429) or credential errors surface
  // immediately rather than timing out after 20 s on a stuck login page.
  const [loginResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/auth/jwt/login') && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  log(`login response status=${loginResp.status()}`);
  if (!loginResp.ok()) {
    const body = await loginResp.text();
    throw new Error(`loginViaUI: POST /auth/jwt/login returned ${loginResp.status()} for ${email}: ${body}`);
  }

  log('waiting for URL redirect');
  await page.waitForURL(expectedPathPattern, { timeout: 20_000 });
  log('redirect done');

  // Cache tokens so subsequent tests can reuse them without an API call.
  const stored = await page.evaluate((key: string) => window.localStorage.getItem(key), STORAGE_KEY);
  if (stored) tokenCache.set(email, stored);
  log('complete');
}

/**
 * Log in via a direct API call and inject the token pair into localStorage.
 * Faster than UI login — skips the visual form for suites that already
 * demonstrated the login flow.
 */
export async function loginViaAPI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Navigate to the portal origin so localStorage is accessible
  await page.goto('/en/login');
  await page.waitForLoadState('domcontentloaded');

  const apiUrl = E2E_ENV.API_URL;
  const body = `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

  // Make the fetch inside the browser so CORS/cookies stay consistent
  const tokens = await page.evaluate(
    async ([url, reqBody]: [string, string]) => {
      const r = await fetch(`${url}/auth/jwt/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: reqBody,
      });
      if (!r.ok) throw new Error(`Login failed: ${r.status}`);
      return r.json();
    },
    [apiUrl, body] as [string, string],
  );

  if (typeof tokens.access_token !== 'string') {
    throw new Error(`loginViaAPI: unexpected response: ${JSON.stringify(tokens)}`);
  }

  const serialized = JSON.stringify(tokens);
  await page.evaluate(
    ([key, value]: [string, string]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, serialized] as [string, string],
  );

  tokenCache.set(email, serialized);
}

/**
 * Inject previously cached tokens into localStorage without making an API call.
 * Use instead of loginViaAPI in subsequent tests for the same user so the
 * login rate limit (5/min) is never exceeded across the 15-test serial suite.
 *
 * Throws if the user has not logged in yet in this test run.
 */
export async function injectSavedAuth(page: Page, email: string): Promise<void> {
  const cached = tokenCache.get(email);
  if (!cached) {
    throw new Error(
      `injectSavedAuth: no cached token for ${email}. ` +
      'Call loginViaUI or loginViaAPI first.',
    );
  }
  await page.goto('/en/login');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    ([key, value]: [string, string]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, cached] as [string, string],
  );
}

/**
 * Read the current tokens from the page's localStorage and update the
 * in-process tokenCache. Call this after an org-switch so that subsequent
 * injectSavedAuth calls carry the correct org-scoped token rather than the
 * stale token from the original loginViaAPI call.
 */
export async function updateTokenCacheFromPage(page: Page, email: string): Promise<void> {
  const stored = await page.evaluate((key: string) => window.localStorage.getItem(key), STORAGE_KEY);
  if (stored) tokenCache.set(email, stored);
}

export async function clearAuth(page: Page): Promise<void> {
  await page.evaluate((key: string) => {
    window.localStorage.removeItem(key);
  }, STORAGE_KEY);
}

/**
 * Return the access_token previously cached for `email` (set by loginViaUI /
 * loginViaAPI / updateTokenCacheFromPage). Used by Node-side helpers that
 * call the admin API directly without going through a Page — e.g. the blog
 * cleanup helper that deletes stale posts before the spec runs.
 *
 * Returns undefined if no login has happened yet for this email this run.
 */
export function getCachedAccessToken(email: string): string | undefined {
  const stored = tokenCache.get(email);
  if (stored === undefined) return undefined;
  try {
    const parsed = JSON.parse(stored) as { access_token?: unknown };
    return typeof parsed.access_token === 'string' ? parsed.access_token : undefined;
  } catch {
    return undefined;
  }
}
