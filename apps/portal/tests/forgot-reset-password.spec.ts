import { expect, test } from '@playwright/test';

test.describe('forgot password screen', () => {
  test('renders email field and send button', async ({ page }) => {
    await page.goto('/forgot-password');

    await expect(page.getByRole('heading', { name: /forgot your password/i })).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('shows confirmation state after submitting', async ({ page }) => {
    await page.route('**/auth/forgot-password', async (route) => {
      await route.fulfill({ status: 202 });
    });

    await page.goto('/forgot-password');
    await page.getByLabel(/work email/i).fill('user@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
    await expect(page.locator('a[href="/login"]', { hasText: /back to sign in/i })).toBeVisible();
  });

  test('shows confirmation even when the API errors — never leaks email existence', async ({
    page,
  }) => {
    await page.route('**/auth/forgot-password', async (route) => {
      await route.fulfill({ status: 500 });
    });

    await page.goto('/forgot-password');
    await page.getByLabel(/work email/i).fill('nobody@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
  });
});

test.describe('reset password screen', () => {
  test('shows token-missing error when URL has no token', async ({ page }) => {
    await page.goto('/reset-password');

    await expect(
      page.getByRole('alert').filter({ hasText: /reset link is missing the token/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /update password/i })).not.toBeVisible();
  });

  test('renders password fields when a token is present in the URL', async ({ page }) => {
    await page.goto('/reset-password?token=a-signed-reset-token');

    await expect(page.getByRole('heading', { name: /choose a new password/i })).toBeVisible();
    await expect(page.getByLabel(/^new password$/i)).toBeVisible();
    await expect(page.getByLabel(/confirm password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /update password/i })).toBeVisible();
  });

  test('shows mismatch error client-side without calling the API', async ({ page }) => {
    const apiCalls: string[] = [];
    await page.route('**/auth/reset-password', async (route) => {
      apiCalls.push(route.request().url());
      await route.continue();
    });

    await page.goto('/reset-password?token=a-signed-reset-token');
    await page.getByLabel(/^new password$/i).fill('correct-horse-battery-1');
    await page.getByLabel(/confirm password/i).fill('wrong-horse-staple-99');
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page.getByRole('alert').filter({ hasText: /passwords do not match/i })).toBeVisible();
    expect(apiCalls).toHaveLength(0);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('shows reset-failed error when the API rejects the token', async ({ page }) => {
    await page.route('**/auth/reset-password', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'RESET_PASSWORD_BAD_TOKEN' }),
      });
    });

    await page.goto('/reset-password?token=expired-token');
    await page.getByLabel(/^new password$/i).fill('correct-horse-battery-1');
    await page.getByLabel(/confirm password/i).fill('correct-horse-battery-1');
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page.getByRole('alert').filter({ hasText: /password reset failed/i })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('redirects to /login?reset=1 on successful password reset', async ({ page }) => {
    await page.route('**/auth/reset-password', async (route) => {
      await route.fulfill({ status: 200 });
    });

    await page.goto('/reset-password?token=valid-token');
    await page.getByLabel(/^new password$/i).fill('correct-horse-battery-1');
    await page.getByLabel(/confirm password/i).fill('correct-horse-battery-1');
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page).toHaveURL(/\/login\?reset=1/);
  });
});
