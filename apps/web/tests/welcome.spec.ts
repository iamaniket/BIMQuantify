import { expect, test } from '@playwright/test';

test.describe('welcome screen', () => {
  test('renders heading and sign-in link', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /welcome to bimquantify/i }),
    ).toBeVisible();

    const signIn = page.getByRole('link', { name: /sign in/i });
    await expect(signIn).toBeVisible();

    await signIn.click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
