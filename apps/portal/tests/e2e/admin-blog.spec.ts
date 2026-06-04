/**
 * Admin Blog Publish Lifecycle E2E
 *
 * Verifies the bilingual blog post lifecycle as a superadmin:
 *
 *   T1. Create EN+NL post via the 3-step wizard (cover + metadata + EN + NL).
 *   T2. Public API exposes the NL row with matching title/description/tags/etc.
 *   T3. Public web at /nl/blog/<slug> renders the post (ISR-aware retry).
 *   T4. Toggle the EN row to draft via the table's eye-off button.
 *   T5. Toggle the NL row to draft.
 *   T6. Public API no longer returns the post (draft hidden).
 *   T7. Toggle EN row back to published.
 *   T8. Toggle NL row back to published.
 *   T9. Public API returns the post again.
 *
 * Hybrid verification: status transitions are asserted via the public API
 * (instant, authoritative). One render check at /nl/blog/<slug> proves the
 * marketing site renders the form data correctly, with a ~75 s polled
 * reload to absorb the 60 s ISR cache window in apps/web/src/lib/api.ts.
 *
 * Slug is derived from slugify(title_en) — the test picks an EN title that
 * cleanly produces `e2e-wkb-filing-test`, avoiding collision with the
 * existing in-repo `wkb-filing-workflow` MDX which would shadow it.
 */

import { expect, test } from '@playwright/test';

import { loginViaUI, injectSavedAuth, getCachedAccessToken } from '../support/auth';
import { E2E_ENV, requireSuperAdminCreds } from '../support/env';
import {
  BLOG_COVER_PATH,
  BLOG_MDX_EN_PATH,
  BLOG_MDX_NL_PATH,
  deletePostBySlugIfExists,
  getPublicPostBySlug,
  listPublicPosts,
} from '../support/blog';

const SLUG = 'e2e-wkb-filing-test';
const TITLE_EN = 'E2E Wkb Filing Test';
const TITLE_NL = 'E2E Wkb Indieningstest';
const DESCRIPTION =
  'E2E coverage of the three mandatory Wkb filings — bouwmelding, '
  + 'informatieplicht, and gereedmelding — driven by Playwright.';
const PUBLISH_DATE = '2026-05-28';
const PUBLISH_AT_ISO = `${PUBLISH_DATE}T00:00:00.000Z`;
const AUTHOR = 'BimDossier';
const TAGS_INPUT = 'wkb, filing, contractors';
const TAGS_ARRAY = ['wkb', 'filing', 'contractors'];

// IDs captured in T1 from the bilingual response; used in T4/T5/T7/T8 to
// assert the PATCH lands on the right row.
const ids: { en?: string; nl?: string } = {};

test.describe.serial('Admin blog publish lifecycle', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);

    // 1. API health — globalSetup should already have started it.
    const health = await fetch(`${E2E_ENV.API_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!health.ok) {
      throw new Error(`API unreachable at ${E2E_ENV.API_URL}/health`);
    }

    // 2. Superadmin login — UI flow once, then token reuse across tests.
    const { email, password } = requireSuperAdminCreds();
    const loginPage = await browser.newPage();
    try {
      await loginPage.goto(`${E2E_ENV.PORTAL_URL}/en/login`);
      await loginPage.waitForLoadState('domcontentloaded');
      await loginViaUI(loginPage, email, password);
    } finally {
      await loginPage.close();
    }

    // 3. Idempotent cleanup — delete any post left from a prior partial run.
    const deleted = await deletePostBySlugIfExists(email, SLUG);
    if (deleted > 0) {
      console.log(`[beforeAll] cleaned ${deleted} stale row(s) for slug=${SLUG}`);
    }

    // 4. Pre-warm the web app — first compile of /nl/blog/[slug] can take
    //    30-60 s and the T3 polling window mustn't get eaten by cold start.
    const warmup = await browser.newPage();
    try {
      await warmup.goto('http://localhost:3000/nl/blog', { timeout: 90_000 });
      await warmup.waitForLoadState('domcontentloaded');
    } catch (err) {
      console.warn('[beforeAll] web pre-warm failed (non-fatal):', err);
    } finally {
      await warmup.close();
    }
  });

  test('T1: superadmin creates a bilingual blog post via the wizard', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /^Blog\b/ }).click();

    const newPostBtn = page.getByRole('button', { name: 'New post' });
    await expect(newPostBtn).toBeVisible({ timeout: 10_000 });
    await newPostBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // --- Step Meta -----------------------------------------------------
    // Cover image: target the hidden file input directly (the Add cover
    // image button opens a native picker we'd have no way to drive).
    const coverInput = dialog.locator('input[type="file"][accept*="image"]').first();
    await coverInput.setInputFiles(BLOG_COVER_PATH);
    // Wait for compression to settle — preview <img> appears once the file
    // is accepted (compressImage may swap it for a smaller version after).
    await expect(dialog.getByAltText('Cover preview')).toBeVisible({ timeout: 10_000 });

    // Date input — fill with YYYY-MM-DD (HTML5 date input format).
    const dateInput = dialog.locator('input[type="date"]');
    await dateInput.fill(PUBLISH_DATE);

    // Description textarea (placeholder from en.json:2104).
    const descTextarea = dialog.getByPlaceholder(
      'A short summary shown on the card and in search results.',
    );
    await descTextarea.click({ clickCount: 3 });
    await descTextarea.fill(DESCRIPTION);

    // Status select — option values are 'published' / 'draft' (not labels).
    // The dialog defaults to 'published' so this is mostly belt-and-braces.
    const statusSelect = dialog.locator('select').first();
    await statusSelect.selectOption('published');

    // Author input — default text is 'BimDossier'; re-fill to be explicit.
    const authorInput = dialog.getByPlaceholder('BimDossier');
    await authorInput.click({ clickCount: 3 });
    await authorInput.fill(AUTHOR);

    // Tags input (placeholder from en.json:2105).
    const tagsInput = dialog.getByPlaceholder('wkb, compliance, regulations');
    await tagsInput.click({ clickCount: 3 });
    await tagsInput.fill(TAGS_INPUT);

    await dialog.getByRole('button', { name: 'Next', exact: true }).click();

    // --- Step English --------------------------------------------------
    // Drop the EN .mdx file into the picker input — handler parses
    // frontmatter and fills title_en + content_en.
    const mdxEnInput = dialog.locator('input[type="file"][accept*="markdown"]').first();
    await mdxEnInput.setInputFiles(BLOG_MDX_EN_PATH);

    // Override the title so the derived slug is deterministic
    // (slugify(TITLE_EN) === SLUG).
    const titleEnInput = dialog.getByPlaceholder('WKB Compliance Explained');
    await expect(titleEnInput).not.toHaveValue('', { timeout: 5_000 });
    await titleEnInput.click({ clickCount: 3 });
    await titleEnInput.fill(TITLE_EN);

    await dialog.getByRole('button', { name: 'Next', exact: true }).click();

    // --- Step Dutch ----------------------------------------------------
    const mdxNlInput = dialog.locator('input[type="file"][accept*="markdown"]').first();
    await mdxNlInput.setInputFiles(BLOG_MDX_NL_PATH);

    const titleNlInput = dialog.getByPlaceholder('Wkb uitgelegd');
    await expect(titleNlInput).not.toHaveValue('', { timeout: 5_000 });
    await titleNlInput.click({ clickCount: 3 });
    await titleNlInput.fill(TITLE_NL);

    // --- Submit + intercept response ----------------------------------
    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/admin/blog/posts/bilingual')
          && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Publish', exact: true }).click(),
    ]);

    if (!createResp.ok()) {
      const body = await createResp.text();
      throw new Error(
        `Bilingual create returned ${createResp.status()}: ${body}`,
      );
    }
    const created = (await createResp.json()) as {
      en: { id: string; slug: string };
      nl: { id: string; slug: string };
    };
    expect(created.en.slug).toBe(SLUG);
    expect(created.nl.slug).toBe(SLUG);
    ids.en = created.en.id;
    ids.nl = created.nl.id;

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test('T2: post visible on the public NL API with matching form data', async () => {
    const post = await getPublicPostBySlug('nl', SLUG);
    expect(post, 'NL post should be exposed publicly').toBeDefined();
    if (post === undefined) return; // narrowing
    expect(post.title).toBe(TITLE_NL);
    expect(post.description).toBe(DESCRIPTION);
    expect(post.author).toBe(AUTHOR);
    expect(post.tags).toEqual(TAGS_ARRAY);
    expect(post.published_at).toMatch(/^2026-05-28T00:00:00/);
    expect(post.locale).toBe('nl');
  });

  test('T3: /nl/blog/<slug> renders the post (ISR-aware)', async ({ page }) => {
    // The /nl/blog list is cached for 60 s; the detail page also has
    // `revalidate = 60`. We poll with reload() until the API-backed render
    // resolves. dynamicParams=true means on-demand render is allowed.
    const url = `http://localhost:3000/nl/blog/${SLUG}`;
    test.setTimeout(120_000);

    // Compute the expected date string the same way the hero formats it,
    // so host-TZ differences don't break the assertion.
    const expectedDate = new Date(PUBLISH_AT_ISO).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let rendered = false;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const resp = await page.goto(url, { timeout: 30_000 });
        if (resp !== null && resp.ok()) {
          const heading = page.getByRole('heading', { level: 1 });
          // Heading might still resolve to the "Post not found" fallback in
          // generateMetadata's 404 path — gate on the actual title text.
          await heading.waitFor({ state: 'visible', timeout: 5_000 });
          const headingText = (await heading.textContent()) ?? '';
          if (headingText.includes(TITLE_NL)) {
            rendered = true;
            break;
          }
        }
      } catch {
        // swallow — retry below
      }
      await page.waitForTimeout(5_000);
    }
    expect(rendered, `Expected post page at ${url} to render within 90s`).toBe(true);

    // Verify all the form-submitted data appears on the page. Scope to the
    // <main> region — 'BimDossier' and tag strings also appear in the site
    // footer/nav, which would trigger strict-mode multi-match errors.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: TITLE_NL })).toBeVisible();
    await expect(main.getByText(DESCRIPTION)).toBeVisible();
    await expect(main.getByText(AUTHOR, { exact: true }).first()).toBeVisible();
    for (const tag of TAGS_ARRAY) {
      await expect(main.getByText(tag, { exact: true }).first()).toBeVisible();
    }
    await expect(
      main.locator('time', { hasText: expectedDate }).first(),
    ).toBeVisible();
  });

  test('T4: unpublish the EN row via the table eye-off button', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);
    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /^Blog\b/ }).click();

    const row = findRow(page, 'EN');
    const unpublishBtn = row.getByRole('button', {
      name: `Move post "${TITLE_EN}" to draft`,
    });
    await expect(unpublishBtn).toBeVisible({ timeout: 10_000 });

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/admin/blog/posts/${ids.en}`)
          && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      ),
      unpublishBtn.click(),
    ]);
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as { status: string };
    expect(updated.status).toBe('draft');

    // Row badge flips to Draft (string from en.json:2043).
    await expect(row.getByText('Draft', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('T5: unpublish the NL row via the table eye-off button', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);
    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /^Blog\b/ }).click();

    const row = findRow(page, 'NL');
    const unpublishBtn = row.getByRole('button', {
      name: `Move post "${TITLE_NL}" to draft`,
    });
    await expect(unpublishBtn).toBeVisible({ timeout: 10_000 });

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/admin/blog/posts/${ids.nl}`)
          && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      ),
      unpublishBtn.click(),
    ]);
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as { status: string };
    expect(updated.status).toBe('draft');

    await expect(row.getByText('Draft', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('T6: both rows now drafted — public API hides the post (both locales)', async () => {
    const nlList = await listPublicPosts('nl');
    expect(nlList.find((p) => p.slug === SLUG), 'NL row hidden').toBeUndefined();
    const enList = await listPublicPosts('en');
    expect(enList.find((p) => p.slug === SLUG), 'EN row hidden').toBeUndefined();
    expect(
      await getPublicPostBySlug('nl', SLUG),
      'detail 404 on NL',
    ).toBeUndefined();
  });

  test('T7: republish the EN row via the eye button', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);
    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /^Blog\b/ }).click();
    // Make sure drafts are visible in the table filter — defaults to "all"
    // which already shows drafts, but be explicit.
    await page
      .getByLabel('Filter posts by status')
      .selectOption('all');

    const row = findRow(page, 'EN');
    const publishBtn = row.getByRole('button', {
      name: `Publish post "${TITLE_EN}"`,
    });
    await expect(publishBtn).toBeVisible({ timeout: 10_000 });

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/admin/blog/posts/${ids.en}`)
          && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      ),
      publishBtn.click(),
    ]);
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as { status: string };
    expect(updated.status).toBe('published');

    await expect(row.getByText('Published', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('T8: republish the NL row via the eye button', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);
    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /^Blog\b/ }).click();
    await page
      .getByLabel('Filter posts by status')
      .selectOption('all');

    const row = findRow(page, 'NL');
    const publishBtn = row.getByRole('button', {
      name: `Publish post "${TITLE_NL}"`,
    });
    await expect(publishBtn).toBeVisible({ timeout: 10_000 });

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/admin/blog/posts/${ids.nl}`)
          && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      ),
      publishBtn.click(),
    ]);
    expect(patchResp.status()).toBe(200);
    const updated = (await patchResp.json()) as { status: string };
    expect(updated.status).toBe('published');

    await expect(row.getByText('Published', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('T9: public API exposes the post again after republish', async () => {
    const post = await getPublicPostBySlug('nl', SLUG);
    expect(post, 'NL post should be public again').toBeDefined();
    if (post === undefined) return;
    expect(post.title).toBe(TITLE_NL);
    expect(post.tags).toEqual(TAGS_ARRAY);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the BlogPostsTable row that contains both our slug and the given
 * locale badge ('EN' | 'NL'). The cell renders <slug> in a small caption
 * below the title and the locale badge in its own cell, so filtering by
 * both narrows down to exactly one row even when EN and NL share a slug.
 */
function findRow(page: import('@playwright/test').Page, locale: 'EN' | 'NL') {
  return page
    .getByRole('row')
    .filter({ hasText: SLUG })
    .filter({ hasText: locale });
}

// Silence the unused-import warning if injectSavedAuth/getCachedAccessToken
// shift around during refactors — both are used above.
void getCachedAccessToken;
