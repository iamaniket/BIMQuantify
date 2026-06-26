/**
 * Org-Templates E2E — finding-template CRUD lifecycle
 *
 * Exercises the unified /templates page (orgTemplates feature) as a superadmin
 * against the real API. The E2E seed database starts with zero templates.
 * Serial test order: each test builds on the state left by the previous one.
 *
 * The builder is a multi-step wizard. For a finding template the steps are:
 *   1. Type   — choose "Finding template" vs "Report template"
 *   2. Setup  — name, description, "Set as default", built-in field toggles
 *   3. Custom fields — add/remove custom fields
 * Create flows open on step 1 (Type); edit flows open on step 2 (Setup).
 *
 *  T1.  Navigate to /templates — verify Overview tab renders its sections
 *  T2.  Templates tab — verify empty state with "New template" button
 *  T3.  Create the first template via the builder wizard (with a custom field)
 *  T4.  Verify it appears in the table and Overview
 *  T5.  Edit the template (rename + add a field)
 *  T6.  Create a second template and mark it as default
 *  T7.  Set-as-default swaps the badge to the new template
 *  T8.  Delete the non-default template
 *  T9.  Verify the default template cannot be deleted (409 guard)
 *  T10. Cleanup — verify the page still renders
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
  // Wait for the hero to render (heading shows the page title).
  await expect(page.getByRole('heading', { name: /^templates$/i, level: 1 })).toBeVisible();
}

/**
 * Advance the create wizard from the Type step to the Setup step by selecting
 * the "Finding template" type and clicking Next. (Create flows open on Type;
 * edit flows already open on Setup.)
 */
async function pickFindingTypeAndContinue(
  dialog: import('@playwright/test').Locator,
): Promise<void> {
  await dialog.getByRole('button', { name: /finding template/i }).click();
  await dialog.getByRole('button', { name: /^next$/i }).click();
}

test.describe.serial('Org templates — finding CRUD', () => {
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
  /*  T1 — Overview tab (empty state)                                    */
  /* ------------------------------------------------------------------ */
  test('T1: Overview tab renders Finding + Report sections (empty state)', async ({ page }) => {
    await gotoTemplates(page);

    // Overview tab is active by default
    const overviewTab = page.getByRole('tab', { name: /overview/i });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    // The redesigned Overview is a KPI + charts dashboard (StatCards +
    // ChartSections, no section headings). Assert the Finding-templates KPI card
    // renders — exact match so it doesn't substring-hit "No finding templates yet.".
    await expect(page.getByText('Finding templates', { exact: true })).toBeVisible();
    // …and the empty report-section message, which renders in two chart sections
    // when the org has no templates — match the first.
    await expect(page.getByText(/no report templates created yet/i).first()).toBeVisible();

    // Hero KPI sub copy
    await expect(page.getByText(/across all types/i)).toBeVisible();
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
  test('T3: Create a template via the builder wizard', async ({ page }) => {
    await gotoTemplates(page);

    // Switch to Templates tab and open builder
    await page.getByRole('tab', { name: /^templates/i }).click();
    await page.getByRole('button', { name: /new template/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Step 1: Type — choose finding template, continue to Setup
    await pickFindingTypeAndContinue(dialog);

    // Step 2: Setup — name + description
    await dialog.getByLabel(/template name/i).fill(TPL_A);
    const descField = dialog.getByLabel(/description/i);
    if (await descField.isVisible()) {
      await descField.fill(TPL_A_DESC);
    }

    // Built-in field toggles live on the Setup step
    await expect(dialog.getByText('Standard fields', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Severity', { exact: true })).toBeVisible();

    // Step 3: Custom fields — add one text field
    await dialog.getByRole('button', { name: /^next$/i }).click();
    await expect(dialog.getByText(/custom fields/i).first()).toBeVisible();
    await dialog.getByRole('button', { name: /add field/i }).click();

    const fieldLabel = dialog.getByPlaceholder(/field label/i);
    await expect(fieldLabel.first()).toBeVisible();
    await fieldLabel.first().fill('Inspector name');

    // Save (wizard primary button on the last step)
    await dialog.getByRole('button', { name: /^save$/i }).click();
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

    // Overview tab: finding template card visible with its custom-field count.
    await expect(page.getByText(TPL_A)).toBeVisible();
    // The redesigned Overview renders each template's field count as a labeled bar
    // in the "Custom fields per template" section (name + numeric count, not the
    // old "N custom fields" prose). TPL_A has one custom field → its bar value
    // cell (the row's last span) shows "1".
    const tplFieldRow = page.getByText(TPL_A, { exact: true }).locator('..');
    await expect(tplFieldRow.locator('span').last()).toHaveText('1');

    // Switch to Templates tab
    await page.getByRole('tab', { name: /^templates/i }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // Table column headers — Name / Type / Default / Updated (no Fields column)
    await expect(table.getByRole('columnheader', { name: /^name$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^type$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^default$/i })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /^updated$/i })).toBeVisible();

    // Data row shows the template, typed as a Finding
    const row = table.getByRole('row').filter({ hasText: TPL_A });
    await expect(row).toBeVisible();
    await expect(row.getByText('Finding', { exact: true })).toBeVisible();
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

    // Edit opens on the Setup step — rename
    const nameInput = dialog.getByLabel(/template name/i);
    await nameInput.clear();
    await nameInput.fill(TPL_A_RENAMED);

    // Custom fields step — add another field
    await dialog.getByRole('button', { name: /^next$/i }).click();
    await dialog.getByRole('button', { name: /add field/i }).click();
    const fieldLabels = dialog.getByPlaceholder(/field label/i);
    await fieldLabels.last().fill('Defect count');

    // Save
    await dialog.getByRole('button', { name: /^save$/i }).click();
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

    // Step 1: Type — choose finding template, continue to Setup
    await pickFindingTypeAndContinue(dialog);

    // Step 2: Setup — name + default toggle
    await dialog.getByLabel(/template name/i).fill(TPL_B);

    // Toggle "Set as default" (sr-only checkbox, label intercepts clicks)
    const defaultCheckbox = dialog.getByRole('checkbox', { name: /set as default/i });
    if (!(await defaultCheckbox.isChecked())) {
      await defaultCheckbox.check({ force: true });
    }

    // Step 3 — skip custom fields, then save
    await dialog.getByRole('button', { name: /^next$/i }).click();
    await dialog.getByRole('button', { name: /^save$/i }).click();
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
  test('T10: Page still renders after the lifecycle', async ({ page }) => {
    // The E2E database is recreated each run, so leaving the template
    // behind is harmless. Just verify the page still renders correctly.
    await gotoTemplates(page);
    await expect(page.getByRole('heading', { name: /^templates$/i, level: 1 })).toBeVisible();
    await expect(page.getByText(TPL_A_RENAMED).first()).toBeVisible();
  });
});
