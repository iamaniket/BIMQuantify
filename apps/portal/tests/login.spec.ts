import { expect, test } from '@playwright/test';

test.describe('login screen', () => {
  test('renders email and password fields', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('shows validation errors when submitting empty form', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /sign in/i }).click();

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
    await page.getByLabel(/email/i).fill('nobody@example.com');
    await page.getByLabel(/password/i).fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('redirects to dashboard on successful login', async ({ page }) => {
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

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByLabel(/password/i).fill('correctpass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/dashboard');
    await expect(
      page.getByRole('heading', { name: /welcome to bimstitch/i }),
    ).toBeVisible();
  });
});
