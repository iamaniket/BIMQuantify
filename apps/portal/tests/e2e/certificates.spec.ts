import { resolve } from 'path';

import { expect, test, type Page } from '@playwright/test';

import { injectSavedAuth, loginViaUI } from '../support/auth';

// ── Credentials ────────────────────────────────────────────────────────
// The Certificate Library at /en/certificates is backed by the org-admin-only
// /org-certificates API, so the suite runs as the seeded Acme org admin —
// the same account viewer.spec.ts uses.

const ACME_ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? 'admin@acme.dev';
const ACME_ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? 'Admin123!';

// ── Fixtures ───────────────────────────────────────────────────────────
// Real files committed under assets/certificaat/. `.pdf/.png/.jpg` are all in
// the allowed upload extension set, so these exercise the full browser upload
// path. The image extensions are intentionally UPPERCASE (cert.PNG / cert.JPG)
// — the API lowercases before validating, so they must still be accepted.

const CERTS_DIR = resolve(__dirname, '../../../../assets/certificaat');
const PDF_KOMO = resolve(CERTS_DIR, 'NL_MKT_DOC_Wienerberger_Kirchkimmen_KOMO_certificaat.pdf');
const PDF_GLASS = resolve(CERTS_DIR, 'Beoordeling-meerbladig-isolatieglas-bij-oplevering.pdf');
const IMG_PNG = resolve(CERTS_DIR, 'cert.PNG');
const IMG_JPG = resolve(CERTS_DIR, 'cert.JPG');
const PDF_KOMO_NAME = 'NL_MKT_DOC_Wienerberger_Kirchkimmen_KOMO_certificaat.pdf';
const IMG_PNG_NAME = 'cert.PNG';

// Unique per run so reruns against the same E2E DB never collide.
const RUN = Date.now().toString(36);
const PRODUCT_A = `Brick Facade ${RUN}`; // PDF, product,           far-future expiry → "Valid"
const PRODUCT_B = `Insulating Glass ${RUN}`; // PDF, warranty,       ~+10d expiry      → "Expiring"
const PRODUCT_C = `Roof Membrane ${RUN}`; // PNG, inspection,        no expiry          → "No expiry"
const PRODUCT_D = `Window Seal ${RUN}`; // JPG, installation_test,   past expiry        → "Expired"
const SUPPLIER_A = `Wienerberger ${RUN}`;

type CertificateType =
  | 'product'
  | 'installation_test'
  | 'inspection'
  | 'warranty'
  | 'other';

/** ISO yyyy-mm-dd `offsetDays` from now (UTC). Date text is never asserted —
 * only the derived expiry badge — so the timezone of the boundary is irrelevant. */
function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The toolbar's certificate-type filter. Scoped by its unique "All types"
 * option text so it is never confused with the pagination footer's page-size
 * `<select>` (both expose role=combobox). */
function typeFilter(page: Page) {
  return page.locator('select').filter({ hasText: 'All types' });
}

// ── Shared navigation / upload helpers ─────────────────────────────────

/** Inject the cached admin token, open /en/certificates, and switch to the
 * Certificates tab (the table + toolbar only mount on that tab). */
async function gotoCertificatesTab(page: Page): Promise<void> {
  await injectSavedAuth(page, ACME_ADMIN_EMAIL);
  await page.goto('/en/certificates');
  // The Certificates tab carries a count Badge, so match on the substring.
  await page.getByRole('tab', { name: /Certificates/ }).click();
  await expect(page.getByRole('button', { name: 'Upload certificate' })).toBeVisible();
}

/** Drive the real upload dialog: pick a file, fill the metadata, submit, and
 * wait for the two-phase upload to land its terminal `complete` callback. */
async function uploadCertificate(
  page: Page,
  opts: {
    filePath: string;
    product: string;
    type: CertificateType;
    supplier?: string;
    validFrom?: string;
    validUntil?: string;
    tags?: string;
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Upload certificate' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles(opts.filePath);
  // The dialog's only <select> is the certificate-type picker (option value = enum).
  await dialog.locator('select').selectOption(opts.type);
  await dialog.getByPlaceholder('e.g. Isover Cavity Batt 32').fill(opts.product);
  if (opts.supplier !== undefined) {
    await dialog.getByPlaceholder('e.g. Saint-Gobain Isover').fill(opts.supplier);
  }
  if (opts.validFrom !== undefined) {
    await dialog.locator('input[type="date"]').nth(0).fill(opts.validFrom);
  }
  if (opts.validUntil !== undefined) {
    await dialog.locator('input[type="date"]').nth(1).fill(opts.validUntil);
  }
  if (opts.tags !== undefined) {
    await dialog.getByPlaceholder('e.g. insulation, CE, KOMO').fill(opts.tags);
  }

  // Submit and wait for the terminal `complete` callback (covers SHA → initiate
  // → presigned PUT → complete). `exact` avoids matching the toolbar's
  // "Upload certificate" button.
  const [completeResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/org-certificates/')
        && r.url().endsWith('/complete')
        && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    dialog.getByRole('button', { name: 'Upload', exact: true }).click(),
  ]);
  expect(completeResp.ok(), `complete callback failed: ${completeResp.status()}`).toBe(true);
  await expect(dialog).toBeHidden();
}

/** The table row whose product/file cell contains `text`. Uses `.filter()` —
 * `getByRole()` does not accept a `has`/`hasText` option, so filtering must be a
 * separate step or the role match is unconstrained (every <tr>, header included). */
function rowFor(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text });
}

// ── Suite ──────────────────────────────────────────────────────────────

test.describe.serial('Certificates — org library lifecycle', () => {
  test('renders the Certificate Library overview', async ({ page }) => {
    // First login of the run goes through the UI form and caches the token.
    await loginViaUI(page, ACME_ADMIN_EMAIL, ACME_ADMIN_PASSWORD);
    await page.goto('/en/certificates');

    await expect(page.getByText('Certificate Library')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Certificates/ })).toBeVisible();
    // Overview aggregate cards.
    await expect(page.getByText('Certificates by type')).toBeVisible();
    await expect(page.getByText('Expiry status')).toBeVisible();
  });

  test('shows the Certificates tab toolbar', async ({ page }) => {
    await gotoCertificatesTab(page);

    await expect(page.getByRole('button', { name: 'Upload certificate' })).toBeVisible();
    await expect(page.getByPlaceholder(/Search certificates/)).toBeVisible();
    await expect(typeFilter(page)).toBeVisible();
  });

  test('uploads a PDF certificate through the dialog', async ({ page }) => {
    await gotoCertificatesTab(page);

    await uploadCertificate(page, {
      filePath: PDF_KOMO,
      product: PRODUCT_A,
      supplier: SUPPLIER_A,
      type: 'product',
      validUntil: isoDate(365 * 4), // far future → "Valid"
      tags: 'KOMO, brick',
    });

    const row = rowFor(page, PRODUCT_A);
    await expect(row).toBeVisible();
    await expect(row.getByText(SUPPLIER_A)).toBeVisible();
    await expect(row.getByText('Valid', { exact: true })).toBeVisible();
  });

  test('uploads a second PDF certificate with a near-future expiry', async ({ page }) => {
    await gotoCertificatesTab(page);

    await uploadCertificate(page, {
      filePath: PDF_GLASS,
      product: PRODUCT_B,
      type: 'warranty',
      validUntil: isoDate(10), // within 30 days → "Expiring"
    });

    const row = rowFor(page, PRODUCT_B);
    await expect(row).toBeVisible();
    await expect(row.getByText('Expiring', { exact: true })).toBeVisible();
  });

  test('uploads a PNG image certificate through the dialog', async ({ page }) => {
    await gotoCertificatesTab(page);

    // No expiry date → "No expiry" badge. UPPERCASE .PNG must be accepted.
    await uploadCertificate(page, {
      filePath: IMG_PNG,
      product: PRODUCT_C,
      type: 'inspection',
    });

    const row = rowFor(page, PRODUCT_C);
    await expect(row).toBeVisible();
    await expect(row.getByText('No expiry', { exact: true })).toBeVisible();
  });

  test('uploads a JPG image certificate through the dialog', async ({ page }) => {
    await gotoCertificatesTab(page);

    // Past expiry → "Expired" badge. UPPERCASE .JPG must be accepted.
    await uploadCertificate(page, {
      filePath: IMG_JPG,
      product: PRODUCT_D,
      type: 'installation_test',
      validUntil: isoDate(-5),
    });

    const row = rowFor(page, PRODUCT_D);
    await expect(row).toBeVisible();
    await expect(row.getByText('Expired', { exact: true })).toBeVisible();
  });

  test('filters the table by search', async ({ page }) => {
    await gotoCertificatesTab(page);

    await page.getByPlaceholder(/Search certificates/).fill(PRODUCT_A);

    await expect(page.getByText(PRODUCT_A)).toBeVisible();
    await expect(page.getByText(PRODUCT_B)).toBeHidden();
  });

  test('filters the table by certificate type', async ({ page }) => {
    await gotoCertificatesTab(page);

    // Type filter is the toolbar select; option value = enum.
    await typeFilter(page).selectOption('warranty');

    await expect(page.getByText(PRODUCT_B)).toBeVisible();
    await expect(page.getByText(PRODUCT_A)).toBeHidden();
  });

  test('opens the certificate viewer dialog for a PDF', async ({ page }) => {
    await gotoCertificatesTab(page);

    // The viewer fetches an inline presigned URL, then renders the PDF in an
    // iframe titled with the original filename.
    const [viewResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/org-certificates/')
          && r.url().includes('disposition=inline')
          && r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      rowFor(page, PRODUCT_A).getByTitle('View').click(),
    ]);
    expect(viewResp.ok()).toBe(true);

    await expect(
      page.locator(`iframe[title="${PDF_KOMO_NAME}"]`),
    ).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
  });

  test('previews an image certificate inline', async ({ page }) => {
    await gotoCertificatesTab(page);

    // Image certificates render as an <img> (not an iframe) in the viewer.
    const [viewResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/org-certificates/')
          && r.url().includes('disposition=inline')
          && r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      rowFor(page, PRODUCT_C).getByTitle('View').click(),
    ]);
    expect(viewResp.ok()).toBe(true);

    await expect(
      page.locator(`img[alt="${IMG_PNG_NAME}"]`),
    ).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
  });

  test('downloads a certificate', async ({ page }) => {
    await gotoCertificatesTab(page);

    // The row Download button asks the API for a (non-inline) presigned URL,
    // then window.open()s it. Assert on the API call — robust under headless.
    const [downloadResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/org-certificates/')
          && r.url().includes('/download')
          && !r.url().includes('disposition=inline')
          && r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      rowFor(page, PRODUCT_A).getByTitle('Download').click(),
    ]);
    expect(downloadResp.ok()).toBe(true);
  });

  test('deletes a certificate', async ({ page }) => {
    await gotoCertificatesTab(page);

    // Remove fires DELETE immediately — there is no confirm step.
    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/org-certificates/')
          && r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      rowFor(page, PRODUCT_B).getByTitle('Remove').click(),
    ]);
    expect(deleteResp.ok()).toBe(true);

    await expect(page.getByText(PRODUCT_B)).toBeHidden();
  });

  test('rejects an unsupported file format', async ({ page }) => {
    await gotoCertificatesTab(page);

    await page.getByRole('button', { name: 'Upload certificate' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // A `.txt` is not in the allowed extension set. Pass an in-memory payload so
    // no junk fixture has to be committed. setInputFiles bypasses the input's
    // `accept` filter, so the bytes reach the two-phase upload and the server
    // is the thing that must reject them.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'malware.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a certificate'),
    });
    await dialog.locator('select').selectOption('other');
    await dialog.getByPlaceholder('e.g. Isover Cavity Batt 32').fill(`Bogus ${RUN}`);

    // The upload must fail at `initiate` (400 INVALID_FILE_EXTENSION) — it never
    // reaches the presigned PUT or `complete`.
    const [initResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/org-certificates/initiate')
          && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Upload', exact: true }).click(),
    ]);
    expect(initResp.status(), 'unsupported format should be rejected at initiate').toBe(400);

    // The dialog stays open (no success → no close), an error toast surfaces,
    // and the bogus product is never added to the library.
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByText(`Bogus ${RUN}`)).toHaveCount(0);
  });

  test('disables Upload when the validity window is inverted', async ({ page }) => {
    await gotoCertificatesTab(page);

    await page.getByRole('button', { name: 'Upload certificate' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // A file is required to isolate the validity-window reason for the disabled state.
    await dialog.locator('input[type="file"]').setInputFiles(PDF_KOMO);
    await dialog.locator('input[type="date"]').nth(0).fill(isoDate(365)); // valid_from in the future
    await dialog.locator('input[type="date"]').nth(1).fill(isoDate(-365)); // valid_until in the past

    await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled();

    await page.keyboard.press('Escape');
  });
});
