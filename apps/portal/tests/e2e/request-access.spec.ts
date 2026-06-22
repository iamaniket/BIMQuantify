/**
 * Request-Access E2E Journey
 *
 * Six sequential tests covering the full intended lifecycle:
 *   R1. Anonymous user submits the access-request form on /en/request-access.
 *   R2. Super admin logs in and sees the new request on /admin/access-requests.
 *   R3. Super admin opens the approve dialog, supplies an org name, and submits.
 *   R4. Activation email arrives in MailHog; we extract the /activate link.
 *   R5. The requester sets a password on /activate and is redirected to /login.
 *   R6. The requester logs in and lands inside the newly-provisioned tenant.
 *
 * Independent from `multitenant.spec.ts` — uses its own module-local state so
 * either suite can run on its own. Reuses the existing helpers in
 * `tests/support/` (auth, mailhog, env).
 *
 * Prerequisites are handled automatically by `globalSetup` (see
 * global-setup.ts) — fresh `bimstitch_e2e` database, API on port 8000,
 * Redis and MailHog cleared.
 */

import { expect, test } from '@playwright/test';

import { clearAuth, loginViaAPI, loginViaUI } from '../support/auth';
import { E2E_ENV, requireSuperAdminCreds } from '../support/env';
import { clearAllEmails, extractUrlFromEmail, waitForEmail } from '../support/mailhog';

// Module-local run-state — keeps this file independent of the shared `state`
// singleton used by multitenant.spec.ts.
const RUN = Date.now().toString(36);

// The form's full-name regex requires unicode letters only (no digits), so
// derive a digit-free token from the run timestamp by mapping 0-9 to a-j.
const RUN_LETTERS = RUN.replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)));

const runState = {
  requesterName: `Lieke ${RUN_LETTERS}`,
  // Email local-part may contain digits; the regex only constrains structure.
  // Use a real-looking non-free TLD — `.test` is a reserved TLD that the
  // API's email-validator rejects, and the request-access endpoint
  // separately blocklists common free-mail domains.
  requesterEmail: `e2e-ar-${RUN}@bimdossier-e2e.nl`,
  requesterCompany: `Heijmans ${RUN_LETTERS}`,
  orgName: `E2E-AR-Org-${RUN}`,
  requesterPassword: 'E2EReqAccess123!',
  activationPath: '',
};

test.describe.serial('Request-access journey', () => {
  test.beforeAll(async () => {
    // Health gate so a missing API surfaces immediately, not as a confusing
    // 30-second timeout on the first navigation.
    const healthRes = await fetch(`${E2E_ENV.API_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).catch((err: unknown) => {
      throw new Error(
        `API unreachable at ${E2E_ENV.API_URL}/health — is globalSetup running? ` +
          `(${err instanceof Error ? err.message : err})`,
      );
    });
    if (!healthRes.ok) {
      throw new Error(`API returned HTTP ${healthRes.status} — expected 200`);
    }

    // Isolate this run's activation email from anything previous tests left
    // in MailHog.
    await clearAllEmails();
  });

  // ===========================================================================
  // R1. Anonymous submission
  // ===========================================================================

  test('R1: anonymous user submits the access-request form', async ({ page }) => {
    await page.goto('/en/request-access');

    // The form's FormField wrapper renders <label> without htmlFor/id linkage,
    // so Playwright's getByLabel cannot match. Use autocomplete attributes
    // (stable, semantic) for inputs and positional selectors for the three
    // <select> controls (role / company_size / country in DOM order).
    const nameInput = page.locator('input[autocomplete="name"]');
    await expect(nameInput).toBeVisible({ timeout: 30_000 });

    await nameInput.fill(runState.requesterName);
    await page.locator('input[autocomplete="email"]').fill(runState.requesterEmail);
    await page.locator('input[autocomplete="organization"]').fill(runState.requesterCompany);

    const selects = page.locator('form select');
    await selects.nth(0).selectOption({ label: 'BIM Manager / BIM-coördinator' });
    await selects.nth(1).selectOption('201-500');
    await selects.nth(2).selectOption('NL');

    await page.locator('form textarea').fill('E2E run — federated IFC review for Wkb-1 projects.');
    await page.locator('input[type="checkbox"]').check();

    // Surface API failures (422 on validation, 429 on rate-limit, 5xx) the
    // moment they happen rather than waiting for the success state to time
    // out.
    const [submitResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/access-requests') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: 'Apply to join the pilot' }).click(),
    ]);
    if (!submitResp.ok()) {
      throw new Error(
        `submit /access-requests returned ${submitResp.status()}: ${await submitResp.text()}`,
      );
    }

    // Success panel ("Application received" eyebrow + requester email in body)
    await expect(page.getByText('Application received')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(runState.requesterEmail)).toBeVisible();
  });

  // ===========================================================================
  // R2. Super admin sees the request
  // ===========================================================================

  test('R2: super admin sees the new request on /admin/access-requests', async ({ page }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaAPI(page, email, password);

    await page.goto('/en/admin/access-requests');

    // Filter by the unique requester email so the assertion is robust against
    // any pre-existing rows in the test DB.
    const search = page.getByPlaceholder(/search by name, email, or company/i);
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(runState.requesterEmail);

    // Row text appears (name + email + company)
    await expect(page.getByText(runState.requesterEmail)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(runState.requesterName)).toBeVisible();
    await expect(page.getByText(runState.requesterCompany).first()).toBeVisible();

    // Expand the row and verify the notes block renders the submitted text
    await page.getByRole('button', { name: 'Show details' }).first().click();
    await expect(page.getByText(/federated IFC review for Wkb-1/)).toBeVisible();
  });

  // ===========================================================================
  // R3. Super admin approves with the new org name
  // ===========================================================================

  test('R3: super admin approves the request and provisions a tenant', async ({ page }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaAPI(page, email, password);

    await page.goto('/en/admin/access-requests');
    await page.getByPlaceholder(/search by name, email, or company/i).fill(runState.requesterEmail);
    await expect(page.getByText(runState.requesterEmail)).toBeVisible({ timeout: 10_000 });

    // Approve action — aria-label "Approve" on the row's check button
    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // org_name pre-fills with the company; overwrite with the unique-per-run name
    // so we can assert the requester landed in this org during R6.
    const orgInput = dialog.locator('input[name="org_name"]');
    await orgInput.click({ clickCount: 3 });
    await orgInput.fill(runState.orgName);

    const [approveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/approve') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Approve & provision' }).click(),
    ]);
    if (!approveResp.ok()) {
      throw new Error(
        `approve endpoint returned ${approveResp.status()}: ${await approveResp.text()}`,
      );
    }

    const body = await approveResp.json();
    expect(body.activation_required).toBe(true);
    expect(body.organization.name).toBe(runState.orgName);
    expect(body.admin_email.toLowerCase()).toBe(runState.requesterEmail.toLowerCase());

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  // ===========================================================================
  // R4. Activation email arrives
  // ===========================================================================

  test('R4: activation email arrives and the activation URL parses cleanly', async () => {
    const emailBody = await waitForEmail(runState.requesterEmail, { timeoutMs: 40_000 });
    const activationUrl = extractUrlFromEmail(emailBody, /\/activate\?token=/);

    const parsed = new URL(activationUrl);
    // Store just path+query so page.goto() respects the portal's baseURL
    runState.activationPath = parsed.pathname + parsed.search;
    expect(runState.activationPath).toMatch(/\/activate\?token=.+/);
  });

  // ===========================================================================
  // R5. Requester sets password on /activate
  // ===========================================================================

  test('R5: requester sets password on the activation page', async ({ page }) => {
    // Drop the super-admin auth state — the activation page must work for an
    // anonymous browser session.
    await page.goto('/en/login');
    await clearAuth(page);

    await page.goto(runState.activationPath);

    const passwordInputs = page.locator('input[type="password"]');
    await expect(passwordInputs.nth(0)).toBeVisible({ timeout: 15_000 });
    await passwordInputs.nth(0).fill(runState.requesterPassword);
    await passwordInputs.nth(1).fill(runState.requesterPassword);

    await page.getByRole('button', { name: 'Activate account' }).click();

    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/activated=1/);
  });

  // ===========================================================================
  // R6. Requester logs in and lands inside the provisioned tenant
  // ===========================================================================

  test('R6: requester logs in and lands inside the new tenant', async ({ page }) => {
    await loginViaUI(page, runState.requesterEmail, runState.requesterPassword);

    // Reaching /projects proves: (a) login worked, (b) the activation
    // bootstrap auto-accepted the sole pending membership, and (c) the user
    // landed in a tenant context (the route guard would otherwise redirect).
    await expect(page).toHaveURL(/\/projects/);

    // Empty-state copy on a brand-new tenant — the requester has no projects
    // yet, which confirms this is THEIR freshly-provisioned org and not some
    // existing tenant they accidentally joined.
    await expect(page.getByText(/no projects yet/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible();
  });
});

// =============================================================================
// Pilot-questions journey — proves the optional pilot-qualification answers
// (monthly budget, start timeline, projects/year, live-project commitment)
// survive the round-trip from the public form into the portal admin.
//
// There are no dedicated columns for these — `RequestAccessForm` folds them
// into the free-text `notes` blob via `composeAccessRequestNotes()`. So
// "getting all the pilot info in the portal" means: (P1) the browser sends a
// `notes` body carrying every answer, and (P2) the admin sees every answer
// when the request row is expanded.
//
// Placed BEFORE the duplicate block so its single public submission is only
// the 2nd POST /access-requests of the run, comfortably inside the 5/hour
// per-IP rate limit (ACCESS_REQUEST_RATE_LIMITER).
// =============================================================================

test.describe.serial('Request-access pilot questions', () => {
  const PILOT_RUN = `${Date.now().toString(36)}p`;
  // The full-name regex requires unicode letters only — map 0-9 → a-j for any
  // token derived from the (digit-bearing) run id.
  const PILOT_RUN_LETTERS = PILOT_RUN.replace(/[0-9]/g, (d) =>
    String.fromCharCode(97 + Number(d)),
  );
  const pilotState = {
    requesterName: `Sanne ${PILOT_RUN_LETTERS}`,
    requesterEmail: `e2e-pilot-${PILOT_RUN}@bimdossier-e2e.nl`,
    requesterCompany: `BAM ${PILOT_RUN_LETTERS}`,
    role: 'BIM Manager / BIM-coördinator',
    // Free-text goal carrying the run id so the P2 assertion can't collide with
    // notes left by any other row in the shared test DB.
    goal: `Pilot E2E goal ${PILOT_RUN}: faster federated IFC review and a clean dossier export.`,
  };

  test.beforeAll(async () => {
    // Health gate so a missing API surfaces immediately rather than as a
    // confusing 30s timeout on the first navigation.
    const healthRes = await fetch(`${E2E_ENV.API_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).catch((err: unknown) => {
      throw new Error(
        `API unreachable at ${E2E_ENV.API_URL}/health — is globalSetup running? ` +
          `(${err instanceof Error ? err.message : err})`,
      );
    });
    if (!healthRes.ok) {
      throw new Error(`API returned HTTP ${healthRes.status} — expected 200`);
    }
  });

  // ---------------------------------------------------------------------------
  // P1 — anonymous submission with every optional pilot question answered
  // ---------------------------------------------------------------------------

  test('P1: anonymous user submits with all pilot questions answered', async ({ page }) => {
    await page.goto('/en/request-access');

    const nameInput = page.locator('input[autocomplete="name"]');
    await expect(nameInput).toBeVisible({ timeout: 30_000 });

    await nameInput.fill(pilotState.requesterName);
    await page.locator('input[autocomplete="email"]').fill(pilotState.requesterEmail);
    await page.locator('input[autocomplete="organization"]').fill(pilotState.requesterCompany);

    // Seven <select> controls render in DOM order:
    //   0 role · 1 company_size · 2 country
    //   3 budget · 4 timeline · 5 project_volume · 6 live_commitment
    const selects = page.locator('form select');
    await selects.nth(0).selectOption({ label: pilotState.role });
    await selects.nth(1).selectOption('201-500');
    await selects.nth(2).selectOption('NL');
    // The optional pilot-qualification answers — selected by option value.
    await selects.nth(3).selectOption('149'); // Monthly budget → €149/month
    await selects.nth(4).selectOption('1-3m'); // Start timeline → Within 1–3 months
    await selects.nth(5).selectOption('21-50'); // Projects/year → 21–50
    await selects.nth(6).selectOption('yes'); // Live project → Yes, ready to go

    await page.locator('form textarea').fill(pilotState.goal);
    await page.locator('input[type="checkbox"]').check();

    const [submitResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/access-requests') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: 'Apply to join the pilot' }).click(),
    ]);
    if (!submitResp.ok()) {
      throw new Error(
        `submit /access-requests returned ${submitResp.status()}: ${await submitResp.text()}`,
      );
    }

    // Assert the composed `notes` the browser actually sent carries every pilot
    // answer. Pinning this client-side means a P2 miss can only be the admin
    // render, never the compose step. `.` stands in for the en-dash so the
    // assertion doesn't hinge on the exact dash codepoint.
    const sentNotes =
      (submitResp.request().postDataJSON() as { notes?: string }).notes ?? '';
    expect(sentNotes).toContain('Pilot questions');
    expect(sentNotes).toMatch(/Budget: €149\/month/);
    expect(sentNotes).toMatch(/Start: Within 1.3 months/);
    expect(sentNotes).toMatch(/Projects\/year: 21.50/);
    expect(sentNotes).toContain('Live project: Yes, ready to go');
    expect(sentNotes).toContain(pilotState.goal);

    await expect(page.getByText('Application received')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(pilotState.requesterEmail)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // P2 — admin sees every pilot answer (structured fields + folded notes)
  // ---------------------------------------------------------------------------

  test('P2: super admin sees all the pilot info in the portal', async ({ page }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaAPI(page, email, password);

    await page.goto('/en/admin/access-requests');

    // Narrow to this run's row by its unique email so assertions are robust
    // against any pre-existing rows in the shared test DB.
    const search = page.getByPlaceholder(/search by name, email, or company/i);
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(pilotState.requesterEmail);

    // Structured columns round-tripped into the table.
    await expect(page.getByText(pilotState.requesterEmail)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(pilotState.requesterName)).toBeVisible();
    await expect(page.getByText(pilotState.requesterCompany).first()).toBeVisible();
    await expect(page.getByText(pilotState.role).first()).toBeVisible();

    // Expand the row to reveal the free-text notes blob.
    await page.getByRole('button', { name: 'Show details' }).first().click();

    // Every pilot answer composeAccessRequestNotes folded in is visible to the
    // reviewer. getByText normalizes whitespace, so the multi-line notes blob
    // matches each line as a substring; `.` stands in for the en-dash.
    await expect(page.getByText('Pilot questions')).toBeVisible();
    await expect(page.getByText(/Budget:\s*€149\/month/)).toBeVisible();
    await expect(page.getByText(/Start:\s*Within 1.3 months/)).toBeVisible();
    await expect(page.getByText(/Projects\/year:\s*21.50/)).toBeVisible();
    await expect(page.getByText(/Live project:\s*Yes, ready to go/)).toBeVisible();
    await expect(page.getByText(new RegExp(`Pilot E2E goal ${PILOT_RUN}`))).toBeVisible();
  });
});

// =============================================================================
// Duplicate-handling journey — runs AFTER the main flow above so it can reuse
// the org + AR row created in R3 to drive the org-name-taken assertion.
// =============================================================================

test.describe.serial('Request-access duplicate handling', () => {
  // A fresh requester for the rejected-then-resubmit case. Distinct from the
  // main journey's run state so it doesn't interact with R6's logged-in tenant.
  const DUP_RUN = `${Date.now().toString(36)}d`;
  const DUP_RUN_LETTERS = DUP_RUN.replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)));
  const dupState = {
    requesterName: `Pieter ${DUP_RUN_LETTERS}`,
    requesterEmail: `e2e-dup-${DUP_RUN}@bimdossier-e2e.nl`,
    requesterCompany: `Heijmans Dup ${DUP_RUN_LETTERS}`,
  };

  // Shared helper — fills + submits the request-access form. Returns the
  // POST /access-requests response so the caller can branch on status.
  async function fillAndSubmit(
    page: import('@playwright/test').Page,
    values: { name: string; email: string; company: string },
  ): Promise<import('@playwright/test').Response> {
    await page.goto('/en/request-access');
    await expect(page.locator('input[autocomplete="name"]')).toBeVisible({
      timeout: 30_000,
    });

    await page.locator('input[autocomplete="name"]').fill(values.name);
    await page.locator('input[autocomplete="email"]').fill(values.email);
    await page.locator('input[autocomplete="organization"]').fill(values.company);
    const selects = page.locator('form select');
    await selects.nth(0).selectOption({ label: 'BIM Manager / BIM-coördinator' });
    await selects.nth(1).selectOption('201-500');
    await selects.nth(2).selectOption('NL');
    await page.locator('form textarea').fill('Duplicate-handling E2E test.');
    await page.locator('input[type="checkbox"]').check();

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/access-requests') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: 'Apply to join the pilot' }).click(),
    ]);
    return resp;
  }

  // ---------------------------------------------------------------------------
  // D1a — same email, pending → 409 inline error
  // ---------------------------------------------------------------------------

  test('D1a: resubmitting while a request is pending shows the inline error', async ({
    page,
  }) => {
    // First submission lands as `new`.
    const first = await fillAndSubmit(page, {
      name: dupState.requesterName,
      email: dupState.requesterEmail,
      company: dupState.requesterCompany,
    });
    expect(first.status()).toBe(201);
    await expect(page.getByText('Application received')).toBeVisible({ timeout: 10_000 });

    // Second submission with the same email — different name/company shouldn't
    // matter; the dedup key is `work_email`.
    const second = await fillAndSubmit(page, {
      name: `${dupState.requesterName} Junior`,
      email: dupState.requesterEmail,
      company: `Different Co ${DUP_RUN_LETTERS}`,
    });
    expect(second.status()).toBe(409);
    // The API wraps HTTPExceptions in a localized { code, detail, message }
    // envelope (detail preserved verbatim). Assert detail, not strict-equal.
    expect((await second.json()).detail).toBe('ACCESS_REQUEST_PENDING_DUPLICATE');

    // Friendly inline error renders — anchored on the phrase in i18n.
    await expect(page.getByText(/already received your request/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // D1b — admin's approve dialog surfaces org-name-taken inline
  // ---------------------------------------------------------------------------

  test('D1b: approve dialog shows org-name-taken when admin reuses an existing name', async ({
    page,
  }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaAPI(page, email, password);

    // The main-flow run state's `orgName` (R3) was provisioned successfully —
    // reuse that exact name to trigger the collision check.
    const reusedOrgName = runState.orgName;

    await page.goto('/en/admin/access-requests');
    // Pieter's pending request from D1a is the candidate to approve.
    const search = page.getByPlaceholder(/search by name, email, or company/i);
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(dupState.requesterEmail);
    await expect(page.getByText(dupState.requesterEmail)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const orgInput = dialog.locator('input[name="org_name"]');
    await orgInput.click({ clickCount: 3 });
    await orgInput.fill(reusedOrgName);

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/approve') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: 'Approve & provision' }).click(),
    ]);
    expect(resp.status()).toBe(409);
    expect((await resp.json()).detail.code).toBe('ORG_NAME_TAKEN');

    // Field-level error renders inside the still-open dialog.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // D1c — rejected → resubmit succeeds (status flips, new row inserted)
  // ---------------------------------------------------------------------------

  test('D1c: after the admin rejects, the requester can resubmit successfully', async ({
    page,
  }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaAPI(page, email, password);

    // Reject Pieter's pending request directly via the API — fastest path.
    const tokens = await page.evaluate((key: string) => window.localStorage.getItem(key),
      'bimstitch.tokens',
    );
    const tokenPair = JSON.parse(tokens ?? '{}') as { access_token?: string };
    if (typeof tokenPair.access_token !== 'string') {
      throw new Error('superadmin token missing — loginViaAPI must precede this');
    }

    // Look up the AR id by email, then reject it.
    const listResp = await fetch(
      `${E2E_ENV.API_URL}/admin/access-requests?q=${encodeURIComponent(dupState.requesterEmail)}`,
      { headers: { Authorization: `Bearer ${tokenPair.access_token}` } },
    );
    expect(listResp.status).toBe(200);
    const list = (await listResp.json()) as Array<{ id: string; status: string }>;
    const target = list.find((r) => r.status === 'new');
    if (target === undefined) throw new Error('no pending AR for the duplicate-flow email');

    const rejectResp = await fetch(
      `${E2E_ENV.API_URL}/admin/access-requests/${target.id}/reject`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenPair.access_token}` },
      },
    );
    expect(rejectResp.status).toBe(200);

    // Now an anonymous resubmission with the same email must succeed.
    await page.evaluate((key: string) => window.localStorage.removeItem(key), 'bimstitch.tokens');

    const second = await fillAndSubmit(page, {
      name: dupState.requesterName,
      email: dupState.requesterEmail,
      company: `${dupState.requesterCompany} Retry`,
    });
    expect(second.status()).toBe(201);
    await expect(page.getByText('Application received')).toBeVisible({ timeout: 10_000 });
  });
});
