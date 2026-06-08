import { expect, test, type Locator } from '@playwright/test';

/**
 * Reliably replace the value in a React Hook Form `register()`-managed input.
 * Playwright's `.fill()` sometimes appends to the existing value when RHF's
 * uncontrolled refs interfere. Selecting all text first guarantees the old
 * value is replaced.
 */
async function clearAndFill(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.press('ControlOrMeta+a');
  if (value === '') {
    await locator.press('Backspace');
  } else {
    await locator.fill(value);
  }
}

test.describe('login screen', () => {
  test('renders email and password fields', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('shows validation errors when submitting empty form', async ({ page }) => {
    await page.goto('/login');

    // Dev mode pre-fills credentials from NEXT_PUBLIC_DEV_LOGIN_* env vars.
    // Select-all + delete to clear, so RHF sees the change.
    const emailInput = page.locator('input[name="username"]');
    const passwordInput = page.locator('input[name="password"]');
    await clearAndFill(emailInput, '');
    await clearAndFill(passwordInput, '');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByText(/email is required/i)).toBeVisible();
    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test('shows API error on invalid credentials', async ({ page }) => {
    await page.route('**/auth/jwt/login', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'LOGIN_BAD_CREDENTIALS' }),
      });
    });

    await page.goto('/login');
    const emailInput = page.locator('input[name="username"]');
    const passwordInput = page.locator('input[name="password"]');
    await clearAndFill(emailInput, 'nobody@example.com');
    await clearAndFill(passwordInput, 'wrongpass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('redirects to projects on successful login', async ({ page }) => {
    await page.route('**/auth/jwt/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          token_type: 'bearer',
        }),
      });
    });

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          email: 'user@example.com',
          full_name: 'Test User',
          is_superuser: false,
          memberships: [{ organization_id: 'org-1', organization_name: 'Test Org', role: 'admin' }],
          pending_invitations_count: 0,
        }),
      });
    });

    // Intercept all API calls (port 8010) that fire after login so the
    // projects page can render without hitting the real server with a fake token.
    await page.route(/localhost:8010\/(?!auth)/, async (route) => {
      const url = route.request().url();
      if (url.includes('/notifications/unread-count')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      }
    });

    await page.goto('/login');
    const emailInput = page.locator('input[name="username"]');
    const passwordInput = page.locator('input[name="password"]');
    await clearAndFill(emailInput, 'user@example.com');
    await clearAndFill(passwordInput, 'correctpass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByRole('heading', { name: /^projects$/i }),
    ).toBeVisible();
  });
});
