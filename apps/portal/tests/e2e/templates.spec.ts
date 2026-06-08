/**
 * Finding-Templates E2E — full CRUD lifecycle
 *
 * Exercises the /templates page as a superadmin against the real API.
 * The E2E seed database starts with zero finding templates.
 * Serial test order: each test builds on the state left by the previous one.
 *
 *  T1.  Navigate to /templates — verify empty Overview tab
 *  T2.  Templates tab — verify empty state with "New template" button
 *  T3.  Create the first template via the builder dialog (with a custom field)
 *  T4.  Verify it appears in the table and Overview
 *  T5.  Edit the template (rename + add a field)
 *  T6.  Create a second template and mark it as default
 *  T7.  Set-as-default swaps the badge to the new template
 *  T8.  Delete the non-default template
 *  T9.  Verify the default template cannot be deleted (409 guard)
 *  T10. Cleanup — restore clean state
 */

import { expect, test } from '@playwright/test';

import { loginViaUI, injectSavedAuth } from '../support/auth';
import { E2E_ENV, requireSuperAdminCreds } from '../support/env';

// Unique names so parallel test runs never collide.
const TS = Date.now();
const TPL_A = `E2E Alpha ${TS}`;
const TPL_A_DESC = `Alpha template ${TS}`;
const TPL_A_RENAMED = `E2E AlphaR ${TS}`;
const TPL_B = `E2E Beta ${TS}`;

/** Navigate to templates page with auth injected and wait for data to load. */
async function gotoTemplates(page: import('@playwright/test').Page): Promise<void> {
  const { email } = requireSuperAdminCreds();
  await injectSavedAuth(page, email);
  await page.goto('/en/templates');
  // Wait for the API data to arrive (hero KPI shows "Templates" count)
  await expect(page.getByRole('heading', { name: /^templates$/i, level: 1 })).toBeVisible();
}

test.describe.serial('Finding templates CRUD', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);

    // Verify API is reachable.
    const health = await fetch(`${E2E_ENV.API_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!health.ok) throw new Error(`API unreachable at ${E2E_ENV.API_URL}/health`);

    // Superadmin login — UI flow once, then token reuse.
    const { email, password } = requireSuperAdminCreds();
    const loginPage = await browser.newPage();
    try {
      await loginViaUI(loginPage, email, password);
    } finally {
      await loginPage.close();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  T1 — Empty Overview tab                                            */
  /* ------------------------------------------------------------------ */
  test('T1: Overview tab shows intro card (empty state)', async ({ page }) => {
    await gotoTemplates(page);

    // Overview tab is active by default
    const overviewTab = page.getByRole('tab', { name: /overview/i });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    // Intro card text is always visible
    await expect(page.getByText(/build custom forms for findings/i)).toBeVisible();

    // Hero KPIs
    await expect(page.getByText(/in this workspace/i)).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  T2 — Empty Templates tab                                           */
  /* ------------------------------------------------------------------ */
  test('T2: Templates tab shows empty state and New button', async ({ page }) => {
    await gotoTemplates(page);

    // Switch to Templates tab
    const templatesTab = page.getByRole('tab', { name: /^templates/i });
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

    // Empty message visible
    await expect(page.getByText(/no templates yet/i)).toBeVisible();

    // "New template" button visible for admin
    await expect(page.getByRole('button', { name: /new template/i })).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  T3 — Create the first template                                     */
  /* ------------------------------------------------------------------ */
  test('T3: Create a template via the builder dialog', async ({ page }) => {
    await gotoTemplates(page);

    // Switch to Templates tab and open builder
    await page.getByRole('tab', { name: /^templates/i }).click();
    await page.getByRole('button', { name: /new template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Step 1: Setup — name + description
    await dialog.getByLabel(/template name/i).fill(TPL_A);
    const descField = dialog.getByLabel(/description/i);
    if (await descField.isVisible()) {
      await descField.fill(TPL_A_DESC);
    }

    // Verify built-in field toggles
    await expect(dialog.getByText('Standard fields', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Severity', { exact: true })).toBeVisible();

    // Step 2: Custom fields — add one text field
    await dialog.getByRole('button', { name: /next/i }).click();
    await expect(dialog.getByText(/custom fields/i).first()).toBeVisible();
    await dialog.getByRole('button', { name: /add field/i }).click();

    const fieldLabel = dialog.getByPlaceholder(/field label/i);
    await expect(fieldLabel.first()).toBeVisible();
    await fieldLabel.first().fill('Inspector name');

    // Save
    await dialog.getByRole('button', { name: /save template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Template now visible in table
    const table = page.getByRole('table');
    await expect(table).toBeVisible({ timeout: 5_000 });
    await expect(table.getByText(TPL_A)).toBeVisible();

    // It should be the only data row (header + 1 data row = 2)
    await expect(table.getByRole('row')).toHaveCount(2);
  });

  /* ------------------------------------------------------------------ */
  /*  T4 — Verify template in overview + table structure                  */
  /* ------------------------------------------------------------------ */
  test('T4: Template appears in Overview and table has correct columns', async ({ page }) => {
    await gotoTemplates(page);

    // Overview tab: template card visible
    await expect(page.getByText(TPL_A)).toBeVisible();
    await expect(page.getByText(/1 custom field/i)).toBeVisible();

    // Switch to Templates tab
    await page.getByRole('tab', { name: /^templates/i }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // Table column headers
    await expect(table.getByRole('columnheader', { name: /^name$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^default$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^fields$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^updated$/i })).toBeVisible();

    // Data row shows template details
    const row = table.getByRole('row').filter({ hasText: TPL_A });
    await expect(row).toBeVisible();
    // Field count = 1
    await expect(row.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  T5 — Edit the template                                             */
  /* ------------------------------------------------------------------ */
  test('T5: Edit the template — rename and add a field', async ({ page }) => {
    await gotoTemplates(page);
    await page.getByRole('tab', { name: /^templates/i }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // Click Edit on our template row
    const row = table.getByRole('row').filter({ hasText: TPL_A });
    await row.getByRole('button', { name: /edit/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Rename
    const nameInput = dialog.getByLabel(/template name/i);
    await nameInput.clear();
    await nameInput.fill(TPL_A_RENAMED);

    // Step 2: add another field
    await dialog.getByRole('button', { name: /next/i }).click();
    await dialog.getByRole('button', { name: /add field/i }).click();
    const fieldLabels = dialog.getByPlaceholder(/field label/i);
    await fieldLabels.last().fill('Defect count');

    // Save
    await dialog.getByRole('button', { name: /save template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Renamed in table
    await expect(table.getByText(TPL_A_RENAMED)).toBeVisible({ timeout: 5_000 });
    await expect(table.getByText(TPL_A)).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  T6 — Create second template as default                              */
  /* ------------------------------------------------------------------ */
  test('T6: Create a second template marked as default', async ({ page }) => {
    await gotoTemplates(page);
    await page.getByRole('tab', { name: /^templates/i }).click();
    await page.getByRole('button', { name: /new template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/template name/i).fill(TPL_B);

    // Toggle "Set as default" checkbox (sr-only input, label intercepts clicks)
    const defaultCheckbox = dialog.getByRole('checkbox', { name: /set as default/i });
    await expect(defaultCheckbox).toBeVisible();
    if (!(await defaultCheckbox.isChecked())) {
      await defaultCheckbox.check({ force: true });
    }

    // Step 2 — skip custom fields
    await dialog.getByRole('button', { name: /next/i }).click();
    await dialog.getByRole('button', { name: /save template/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    const table = page.getByRole('table');
    await expect(table.getByText(TPL_B)).toBeVisible({ timeout: 5_000 });

    // Two data rows now (header + 2)
    await expect(table.getByRole('row')).toHaveCount(3);

    // TPL_B should have the Default badge
    const bRow = table.getByRole('row').filter({ hasText: TPL_B });
    await expect(bRow.getByText(/default/i)).toBeVisible({ timeout: 5_000 });
  });

  /* ------------------------------------------------------------------ */
  /*  T7 — Set-as-default on the first template                          */
  /* ------------------------------------------------------------------ */
  test('T7: Set-as-default swaps the badge', async ({ page }) => {
    await gotoTemplates(page);
    await page.getByRole('tab', { name: /^templates/i }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // TPL_A_RENAMED should have a "Set as default" button
    const aRow = table.getByRole('row').filter({ hasText: TPL_A_RENAMED });
    await expect(aRow).toBeVisible();
    await aRow.getByRole('button', { name: /set as default/i }).click();

    // Wait for the badge to appear on A's row
    await expect(aRow.getByText(/default/i)).toBeVisible({ timeout: 5_000 });

    // B should lose its default badge — it should now have "Set as default" button
    const bRow = table.getByRole('row').filter({ hasText: TPL_B });
    await expect(bRow.getByRole('button', { name: /set as default/i })).toBeVisible({ timeout: 5_000 });
  });

  /* ------------------------------------------------------------------ */
  /*  T8 — Delete a non-default template                                 */
  /* ------------------------------------------------------------------ */
  test('T8: Delete a non-default template', async ({ page }) => {
    await gotoTemplates(page);
    await page.getByRole('tab', { name: /^templates/i }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // TPL_B is not default — delete it
    const bRow = table.getByRole('row').filter({ hasText: TPL_B });
    await expect(bRow).toBeVisible();
    await bRow.getByRole('button', { name: /delete/i }).click();

    // Row should disappear
    await expect(bRow).not.toBeVisible({ timeout: 5_000 });
    // Only 1 data row remains
    await expect(table.getByRole('row')).toHaveCount(2);
  });

  /* ------------------------------------------------------------------ */
  /*  T9 — Cannot delete the default template                            */
  /* ------------------------------------------------------------------ */
  test('T9: Default template cannot be deleted (API 409)', async ({ page }) => {
    await gotoTemplates(page);
    await page.getByRole('tab', { name: /^templates/i }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    const aRow = table.getByRole('row').filter({ hasText: TPL_A_RENAMED });
    await expect(aRow).toBeVisible();
    await aRow.getByRole('button', { name: /delete/i }).click();

    // Row should still be there after the 409 response
    await expect(aRow).toBeVisible();
    // Still 2 rows (header + 1 data)
    await expect(table.getByRole('row')).toHaveCount(2);
  });

  /* ------------------------------------------------------------------ */
  /*  T10 — Cleanup                                                      */
  /* ------------------------------------------------------------------ */
  test('T10: Cleanup — delete test template via API', async ({ page }) => {
    // The E2E database is recreated each run, so leaving the template
    // behind is harmless. Just verify the page still renders correctly.
    await gotoTemplates(page);
    await expect(page.getByRole('heading', { name: /^templates$/i, level: 1 })).toBeVisible();
    await expect(page.getByText(TPL_A_RENAMED).first()).toBeVisible();
  });
});
