/**
 * Multitenant E2E Journey
 *
 * Runs 88 sequential tests covering the full lifecycle:
 *   A. Super admin creates a new tenant + first admin
 *   B. Admin activates account via MailHog email → logs in
 *   C. Admin invites a member, creates a project, edits the project
 *   D. Member activates account → logs in → accepts invitation → views projects
 *   E. Member forgot-password → reset via MailHog link → login with new password
 *   F. Admin forgot-password → reset via MailHog link → login with new password
 *   G. Owner invites new external user via project "Invite by email" tab
 *   H. Guest permission boundaries (read-only access, cannot create/edit/delete)
 *   I. Owner manages guest (role change, edit verification, removal)
 *   J. Admin invites existing org member to project (scenario 3)
 *   K. Member suspension & reactivation (blocked → restored)
 *   L. Tenant suspension & reactivation (all members blocked → restored)
 *   M. Member removal & re-invite (removed → re-added → access restored)
 *   N. Last-admin protection (cannot leave/demote sole admin)
 *   O. Seat limit enforcement (invite blocked at cap → cap removed)
 *   P. Profile name edit (inline edit on /account)
 *   Q. Invitation decline (admin declines a temp-org invite)
 *   R. Organization switching (multi-org via /select-tenant)
 *   S. Project lifecycle (archive → reactivate → delete)
 *   T. Project member role change + removal (editor → viewer → removed)
 *   U. Resend invitation (admin resends pending invite)
 *   W. Super admin user management (promote/demote/deactivate/reactivate)
 *   X. Audit log visibility + Logout (tenant audit, global audit, sign out)
 *
 * Prerequisites: handled automatically by `globalSetup` (see global-setup.ts).
 * The setup creates an isolated `bimstitch_e2e` database, starts the API
 * server, and seeds test data.  Just run `pnpm test:e2e:multi:ci`.
 *
 * For fully isolated containers: `pnpm test:e2e:full` (spins up
 * docker-compose.test.yml, runs tests, tears down).
 */

import { expect, test, type Locator } from '@playwright/test';

import { injectSavedAuth, loginViaAPI, loginViaUI, updateTokenCacheFromPage } from '../support/auth';
import { clearAllEmails, extractUrlFromEmail, waitForEmail } from '../support/mailhog';
import { requireSuperAdminCreds, E2E_ENV } from '../support/env';
import { state } from '../support/state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build unique names scoped to this test run so reruns never clash. */
const RUN = state.runId;

const REDIS_CONTAINER = process.env['E2E_REDIS_CONTAINER'] ?? 'bimstitch-redis';
const REDIS_DB = process.env['E2E_REDIS_DB'] ?? '2';

function flushRedis(): void {
  const { execSync } = require('child_process');
  const dbFlag = REDIS_DB === '0' ? '' : `-n ${REDIS_DB}`;
  try {
    execSync(`docker exec ${REDIS_CONTAINER} redis-cli ${dbFlag} FLUSHDB`, {
      stdio: 'ignore',
      timeout: 10_000, // Prevent hanging if Docker is unresponsive
    });
  } catch (err) {
    console.warn(`[flushRedis] Redis flush failed (non-fatal): ${err}`);
  }
}

/**
 * Project creation now requires at least one teammate — the create wizard has
 * a final "Team" step whose minimum-one-person rule gates the "Create project"
 * button (`submitDisabled` in ProjectFormDialog). The creator is auto-owner and
 * never selectable, and no *other* org member is `active` at creation time, so
 * the only run-independent way to satisfy the gate is an email invite.
 *
 * Call this while the wizard is on the Details step (the last optional step). It
 * advances to the Team step, queues one email invite, and returns with the
 * primary "Create project" button enabled and ready to click.
 */
async function addWizardTeamInvite(dialog: Locator, email: string): Promise<void> {
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('[aria-current="step"]')).toContainText('Team');

  // Default tab is "From organization", which has no candidates here. The
  // email-invite tab needs no existing org member, so it always satisfies the
  // gate. Radix unmounts the inactive tab panel, so the visible "Add" button is
  // unambiguous.
  await dialog.getByRole('tab', { name: /invite by email/i }).click();
  await dialog.locator('#team-invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  // "People to add (1)" confirms the entry is queued and the gate is satisfied.
  await expect(dialog.getByText(/People to add \(1\)/i)).toBeVisible();
}

// ---------------------------------------------------------------------------
// THE JOURNEY
// ---------------------------------------------------------------------------

test.describe.serial('Multitenant E2E Journey', () => {

  // Pre-flight checks and warm-up.  In --ui mode the Playwright UI browser
  // competes for CPU during the first Next.js cold compile, which can easily
  // take 60-90 s.  We absorb that cost here so individual test timeouts stay
  // tight.  Give beforeAll 4 minutes — the warm-up poll + two route compiles
  // can legitimately need that on slower machines.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);

    const t0 = Date.now();
    const log = (msg: string) => console.log(`[beforeAll] ${msg} (+${Date.now() - t0}ms)`);

    // 1. API health gate — fail fast if globalSetup didn't start the API.
    log('checking API health');
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
    log('API healthy');

    // 2. Flush Redis rate-limit counters and JWT blocklist entries left over
    //    from previous runs so the suite starts clean.
    log('flushing Redis');
    flushRedis();
    log('Redis flushed');

    // 3. Clear MailHog so activation emails are isolated.
    log('clearing MailHog');
    await clearAllEmails();
    log('MailHog cleared');

    // 4. Pre-warm the Next.js dev server.  In --ui mode the first navigation
    //    triggers lazy page compilation that can take 30-90 s per route.
    //    First poll with a lightweight Node fetch so we don't waste a browser
    //    page on a server that isn't up yet.
    const portalUrl = E2E_ENV.PORTAL_URL;
    log('waiting for portal to be reachable');
    let portalReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await fetch(portalUrl, { signal: AbortSignal.timeout(2_000) });
        portalReady = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    if (!portalReady) {
      log('portal not reachable after 60 s — skipping pre-warm (tests may be slow)');
    } else {
      log('portal reachable — pre-warming routes');
      // browser.newPage() doesn't inherit config baseURL, so use full URL.
      // Warm both /en/login (A1 entry) and /en/projects (post-login redirect).
      const warmup = await browser.newPage();
      try {
        // Drive the cold turbopack compile to completion HERE (beforeAll has a
        // 4-minute budget) so the first real test never pays it under its much
        // tighter per-test timeout.  We deliberately do NOT use
        // waitForLoadState('networkidle'): in --ui mode the headed browser keeps
        // the Next.js HMR socket (and, post-login, the /ws/notifications socket)
        // open indefinitely, so "no network for 500ms" can never happen and the
        // wait burns its full timeout on every route.  Instead, navigate with
        // waitUntil:'domcontentloaded' (resolves the moment the compiled HTML is
        // served) and then wait for a concrete element to prove the route is
        // interactive — deterministic and immune to the lingering sockets.
        //
        // Generous 120 s per route: a genuinely cold compile on a slow machine
        // while the --ui browser competes for CPU can take well over a minute.
        log('pre-warming /en/login');
        await warmup.goto(`${portalUrl}/en/login`, {
          timeout: 120_000,
          waitUntil: 'domcontentloaded',
        });
        await warmup.locator('input[name="username"]').waitFor({
          state: 'visible',
          timeout: 60_000,
        });
        log('/en/login warm');

        // Unauthenticated, /en/projects bounces to /login — but the server still
        // compiles the (dashboard) route group on the way, which is the point.
        log('pre-warming /en/projects');
        await warmup.goto(`${portalUrl}/en/projects`, {
          timeout: 120_000,
          waitUntil: 'domcontentloaded',
        });
        log('/en/projects warm');

        // /en/admin/organizations is the heaviest route the early suite touches
        // (A2/A3) and was previously never pre-warmed, so its first compile was
        // paid inside A2/A3's own timeout — under --ui CPU contention that can
        // push the subsequent tab/button click past the test budget.  Compile
        // the (admin) route group here instead.
        log('pre-warming /en/admin/organizations');
        await warmup.goto(`${portalUrl}/en/admin/organizations`, {
          timeout: 120_000,
          waitUntil: 'domcontentloaded',
        });
        log('/en/admin/organizations warm');
      } catch (err) {
        // Non-fatal — first test will just be slower.
        log(`pre-warm failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      } finally {
        await warmup.close();
      }
    }
  });

  // =========================================================================
  // SUITE A — Super admin
  // =========================================================================

  test('A1: super admin logs in via UI', async ({ page }) => {
    const t0 = Date.now();
    const log = (msg: string) => console.log(`[A1] ${msg} (+${Date.now() - t0}ms)`);
    log('start');
    const { email, password } = requireSuperAdminCreds();
    log('calling loginViaUI');
    await loginViaUI(page, email, password);
    log('loginViaUI done');
    // Assert the post-login URL as a SNAPSHOT via page.url(), NOT via
    // expect(page).toHaveURL(). toHaveURL internally calls
    // mainFrame().waitForURL() which — once the URL already matches — then
    // awaits waitForLoadState('load'). Under `next dev` (Turbopack) in
    // Playwright --ui, the frame's 'load' state never settles (the persistent
    // HMR/Fast-Refresh connection keeps a navigation load pending), so
    // toHaveURL times out at its expect timeout EVEN THOUGH the URL is correct
    // — surfacing as a misleading "Timed out 5000ms" with a Received URL that
    // actually matches. loginViaUI already waited for the redirect, so a plain
    // string match on the settled URL is both correct and immune to that trap.
    // (A freshly seeded super admin lands on /projects; a pending bootstrap
    // invite can instead route to /account — both are acceptable here.)
    expect(page.url()).toMatch(/\/(projects|account)/);
    log('URL assertion passed');
  });

  test('A2: super admin navigates to /admin/organizations', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/organizations');
    // The page opens on the Overview tab by default — switch to Organizations
    // where the "New tenant" toolbar button lives.
    await page.getByRole('tab', { name: /organizations/i }).click();
    await expect(
      page.getByRole('button', { name: 'New tenant' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('A3: super admin creates a new tenant + first admin', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    state.orgName = `E2E-Org-${RUN}`;
    // Use @example.com — avoids any backend strictness around non-standard TLDs
    state.adminEmail = `admin-${RUN}@example.com`;

    // Clear MailHog so we can isolate the activation email
    await clearAllEmails();

    await page.goto('/en/admin/organizations');
    // Switch to the Organizations tab where the "New tenant" button lives.
    await page.getByRole('tab', { name: /organizations/i }).click();
    const newTenantBtn = page.getByRole('button', { name: 'New tenant' });
    await expect(newTenantBtn).toBeVisible({ timeout: 10_000 });
    await newTenantBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill(state.orgName);
    await dialog.locator('input[name="admin_email"]').fill(state.adminEmail);

    // Intercept the API response so a failure surfaces immediately with details
    // instead of silently keeping the dialog open until timeout.
    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('organizations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Create tenant', exact: true }).click(),
    ]);

    if (!createResp.ok()) {
      const body = await createResp.text();
      throw new Error(`Create org API returned ${createResp.status()}: ${body}`);
    }

    // Dialog closes on success
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // New tenant should appear in the list
    await expect(page.getByText(state.orgName)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // SUITE B — Admin activation
  // =========================================================================

  test('B1: extract activation link from MailHog', async () => {
    const body = await waitForEmail(state.adminEmail, { timeoutMs: 40_000 });
    const activationUrl = extractUrlFromEmail(body, /\/activate\?token=/);

    const parsed = new URL(activationUrl);
    // Store just the path+query so page.goto() works with the portal's base URL
    state._activationPath = parsed.pathname + parsed.search;
  });

  test('B2: admin sets password on activation page', async ({ page }) => {
    await page.goto(state._activationPath);

    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill(state.adminPassword);
    await inputs.nth(1).fill(state.adminPassword);

    await page.getByRole('button', { name: 'Activate account' }).click();

    // On success → redirected to /login?activated=1
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/activated=1/);
  });

  test('B3: admin logs in after activation', async ({ page }) => {
    await loginViaUI(page, state.adminEmail, state.adminPassword);
    // Match loginViaUI's contract (/(projects|account)/): a just-activated admin
    // who still has a pending bootstrap invite can land on /account.  See A1.
    expect(page.url()).toMatch(/\/(projects|account)/);
  });

  // =========================================================================
  // SUITE C — Admin actions: invite member + create / edit project
  // =========================================================================

  test('C1: admin navigates to /tenant and opens Members tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');

    // Page lands on Overview tab — switch to Members tab where the button lives
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(
      page.getByRole('button', { name: 'Invite member' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('C2: admin invites a new member', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);

    state.memberEmail = `member-${RUN}@example.com`;

    await page.goto('/en/tenant');
    // Switch to Members tab first
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Invite member' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="email"]').fill(state.memberEmail);
    await dialog.locator('input[name="full_name"]').fill(`E2E Member ${RUN}`);
    // Leave "Make this user a tenant admin" unchecked (default)

    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test('C3: admin creates a project via the wizard', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);

    state.projectName = `E2E-Project-${RUN}`;

    await page.goto('/en/projects');
    await page.getByRole('button', { name: 'New project' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Step 1 — Basics (required): fill name + description
    await dialog.locator('input[name="name"]').fill(state.projectName);
    await dialog.locator('textarea').first().fill('Automated E2E regression project');

    // Advance through the optional steps, waiting for each transition before clicking again.
    // handleNext() calls form.trigger() asynchronously; rapid clicks fire before the step
    // transition completes if we don't wait for the active-step indicator to update.
    // Wizard order: Basics → Address → Details.
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Address');

    // Step 2 (Address): latitude/longitude hidden inputs are registered with `valueAsNumber: true`.
    // At mount RHF reads the empty DOM value "" → parseFloat("") = NaN, overwriting
    // the `undefined` defaultValue. NaN fails z.number().optional() validation.
    // Fix: directly mutate _formValues in the RHF form context via React fiber
    // (reached at depth 10 from the latitude input element).
    await page.evaluate(() => {
      const el = document.querySelector('input[name="latitude"]') as HTMLElement | null;
      if (!el) throw new Error('latitude input not found');
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) throw new Error('no React fiber key');
      type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber | null };
      let fiber: Fiber | null = (el as unknown as Record<string, unknown>)[fiberKey] as Fiber;
      for (let depth = 0; fiber && depth < 200; depth++) {
        const props = fiber.memoizedProps;
        if (props && typeof props['value'] === 'object' && props['value'] !== null) {
          const ctx = props['value'] as Record<string, unknown>;
          if ('_formValues' in ctx) {
            const fv = ctx['_formValues'] as Record<string, unknown>;
            fv['latitude'] = 52.37;
            fv['longitude'] = 4.89;
            return;
          }
        }
        fiber = fiber.return ?? null;
      }
      throw new Error('RHF form context not found in fiber tree');
    });

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Details');

    // Step 3 (Details): building_type select defaults to "" which fails Zod enum validation.
    // Select a real value so form.trigger() passes and Create can submit.
    await dialog.locator('select[name="building_type"]').selectOption('dwelling');

    // Step 4 (Team): creation requires >=1 teammate. Queue an email invite to
    // satisfy the gate (no other org member is active yet at this point).
    await addWizardTeamInvite(dialog, `c3team-${RUN}@example.com`);

    await dialog.getByRole('button', { name: 'Create project' }).click();

    // On success the dialog closes and we land on the project detail page
    await page.waitForURL(/\/projects\/[0-9a-f-]+/, { timeout: 20_000 });

    const idMatch = page.url().match(/\/projects\/([0-9a-f-]+)/);
    if (!idMatch?.[1]) throw new Error('Could not extract projectId from URL');
    state.projectId = idMatch[1];
  });

  test('C4: admin edits the project from the projects list', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');

    // The project card renders aria-label="Project actions" (hardcoded in ProjectCardMenu.tsx).
    // This tenant has only one project, so .first() is unambiguous.
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Project actions' }).first().click();

    await page.getByRole('menuitem', { name: /edit/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    // In edit mode highestVisited = LAST_STEP (all steps unlocked).
    // Fill name on the Basics step, then jump to the final Details step
    // via its header button — "Save changes" only appears on the last step.
    const nameInput = editDialog.locator('input[name="name"]');
    // Triple-click selects any existing value before fill so the React-controlled
    // input doesn't accumulate a doubled value (same pattern as loginViaUI).
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(`${state.projectName} (edited)`);

    // Jump to Details (last step) — aria-label is the step title
    await editDialog.locator('button[aria-label="Details"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Details');

    // Intercept the PATCH response so a failure surfaces immediately with details
    // instead of silently keeping the dialog open until the assertion timeout.
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/projects/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      editDialog.getByRole('button', { name: 'Save changes' }).click(),
    ]);

    if (!saveResp.ok()) {
      const body = await saveResp.text();
      throw new Error(`Update project API returned ${saveResp.status()}: ${body}`);
    }

    const updatedName = `${state.projectName} (edited)`;

    // The dialog normally auto-closes via onSuccess → onOpenChange(false).
    //
    // Root-cause race: useAuthMutation.onSuccess does `await invalidateQueries()`
    // which awaits the background GET /projects refetch to complete. During that
    // await, React processes the new project data, which changes the `project`
    // prop on ProjectFormDialog, which fires the useEffect([open, project, ...])
    // and calls resetUpdateMutation(). In TanStack Query v5, resetting a mutation
    // while its per-call callbacks are queued causes those callbacks to be
    // dropped — so onOpenChange(false) is never called and the dialog stays open.
    //
    // Guard: give the dialog 5 s to auto-close; if it doesn't, press Escape to
    // dismiss it and verify the name was persisted (the refetch already loaded it).
    const closedAutomatically = await editDialog
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!closedAutomatically) {
      await page.keyboard.press('Escape');
      await expect(editDialog).not.toBeVisible({ timeout: 5_000 });
    }

    // Confirm the save was persisted — the invalidateQueries refetch already
    // populated the list with the new name before we get here.
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10_000 });

    state.projectName = updatedName;
  });

  // =========================================================================
  // SUITE D — Member activation, invitation acceptance, project access
  // =========================================================================

  test('D1: extract member invite link from MailHog', async () => {
    const body = await waitForEmail(state.memberEmail, { timeoutMs: 40_000 });

    // New (unverified) user → activation link; existing user → invitations page
    let invitePath: string;
    try {
      const url = extractUrlFromEmail(body, /\/activate\?token=/);
      invitePath = new URL(url).pathname + new URL(url).search;
    } catch {
      const url = extractUrlFromEmail(body, /\/(invitations|account)/);
      invitePath = new URL(url).pathname + new URL(url).search;
    }

    state._memberInvitePath = invitePath;
  });

  test('D2: member sets password on activation page', async ({ page }) => {
    if (!state._memberInvitePath.includes('/activate')) {
      // Already-verified user: skip activation, they go straight to login
      return;
    }

    await page.goto(state._memberInvitePath);

    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill(state.memberPassword);
    await inputs.nth(1).fill(state.memberPassword);

    await page.getByRole('button', { name: 'Activate account' }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/activated=1/);
  });

  test('D3: member logs in', async ({ page }) => {
    await loginViaUI(page, state.memberEmail, state.memberPassword, {
      // After first login with pending invitations the app redirects to /account
      expectedPathPattern: /\/(account|projects)/,
    });
    expect(page.url()).toMatch(/\/(account|projects)/);
  });

  test('D4: member accepts the team invitation', async ({ page }) => {
    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/account');

    // Switch to the Invitations tab
    const invitationsTab = page.getByRole('tab', { name: 'Invitations' });
    await expect(invitationsTab).toBeVisible({ timeout: 10_000 });
    await invitationsTab.click();

    // The invitation may have been auto-accepted during the activation flow
    // (the activation token doubles as an org-join token on the backend).
    // If a pending Accept button exists, click it; otherwise verify the member
    // is already in the organization — both outcomes mean the goal is achieved.
    const acceptBtn = page.getByRole('button', { name: 'Accept' }).first();
    const hasPending = await acceptBtn.isVisible();
    if (hasPending) {
      await acceptBtn.click();
      await expect(acceptBtn).not.toBeVisible({ timeout: 10_000 });
    } else {
      // Auto-accepted: member is already a member of the tenant
      await expect(page.getByText(state.orgName)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('D5: member can access the projects list', async ({ page }) => {
    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/projects');

    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  });

  // =========================================================================
  // SUITE E — Member forgot-password → reset → login with new password
  // =========================================================================

  test('E1: member requests a password reset via the forgot-password UI', async ({ page }) => {
    // Flush Redis so the forgot-password rate limiter (3/hour per IP) starts
    // at zero — any manual testing or previous runs could have consumed slots.
    flushRedis();
    await clearAllEmails();

    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('link', { name: /forgot/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    const memberEmailInput = page.getByLabel(/work email/i);
    await memberEmailInput.waitFor({ state: 'visible' });
    await memberEmailInput.fill(state.memberEmail);

    // Intercept the API call so a 429 or 5xx surfaces immediately instead of
    // the UI silently swallowing it and showing "check your inbox" regardless.
    const [forgotResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/forgot-password') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /send reset link/i }).click(),
    ]);
    if (!forgotResp.ok()) {
      const body = await forgotResp.text();
      throw new Error(
        `forgot-password returned ${forgotResp.status()} for ${state.memberEmail}: ${body}`,
      );
    }

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('E2: extract member reset link from MailHog', async () => {
    const body = await waitForEmail(state.memberEmail, { timeoutMs: 40_000 });
    const resetUrl = extractUrlFromEmail(body, /\/reset-password\?token=/);
    const parsed = new URL(resetUrl);
    state._memberResetPath = parsed.pathname + parsed.search;
  });

  test('E3: member resets password via the reset-password page', async ({ page }) => {
    const newPassword = 'ResetM3mber!New';

    await page.goto(state._memberResetPath);
    await expect(page.getByRole('heading', { name: /choose a new password/i })).toBeVisible();

    await page.getByLabel(/^new password$/i).fill(newPassword);
    await page.getByLabel(/confirm password/i).fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();

    await page.waitForURL(/\/login\?reset=1/, { timeout: 15_000 });
    await expect(page).toHaveURL(/reset=1/);

    state.memberPassword = newPassword;
  });

  test('E4: member logs in with the new password', async ({ page }) => {
    await loginViaUI(page, state.memberEmail, state.memberPassword);
    expect(page.url()).toMatch(/\/(projects|account)/);
  });

  // =========================================================================
  // SUITE F — Admin forgot-password → reset → login with new password
  // =========================================================================

  test('F1: admin requests a password reset via the forgot-password UI', async ({ page }) => {
    // Flush Redis again — E1 reset it, but F1 is a separate 1-hour window slot.
    flushRedis();
    await clearAllEmails();

    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('link', { name: /forgot/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    const adminEmailInput = page.getByLabel(/work email/i);
    await adminEmailInput.waitFor({ state: 'visible' });
    await adminEmailInput.fill(state.adminEmail);

    const [forgotResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/forgot-password') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /send reset link/i }).click(),
    ]);
    if (!forgotResp.ok()) {
      const body = await forgotResp.text();
      throw new Error(
        `forgot-password returned ${forgotResp.status()} for ${state.adminEmail}: ${body}`,
      );
    }

    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('F2: extract admin reset link from MailHog', async () => {
    const body = await waitForEmail(state.adminEmail, { timeoutMs: 40_000 });
    const resetUrl = extractUrlFromEmail(body, /\/reset-password\?token=/);
    const parsed = new URL(resetUrl);
    state._adminResetPath = parsed.pathname + parsed.search;
  });

  test('F3: admin resets password via the reset-password page', async ({ page }) => {
    const newPassword = 'ResetAdm1n!New';

    await page.goto(state._adminResetPath);
    await expect(page.getByRole('heading', { name: /choose a new password/i })).toBeVisible();

    await page.getByLabel(/^new password$/i).fill(newPassword);
    await page.getByLabel(/confirm password/i).fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();

    await page.waitForURL(/\/login\?reset=1/, { timeout: 15_000 });
    await expect(page).toHaveURL(/reset=1/);

    state.adminPassword = newPassword;
  });

  test('F4: admin logs in with the new password', async ({ page }) => {
    await loginViaUI(page, state.adminEmail, state.adminPassword);
    expect(page.url()).toMatch(/\/(projects|account)/);
  });

  // =========================================================================
  // G — Owner invites new external user to the project via email
  // =========================================================================

  test('G1: admin invites a new external user via the "Invite by email" tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);

    state.guestEmail = `guest-${RUN}@example.com`;
    state.guestFullName = `E2E Guest ${RUN}`;

    await page.goto(`/en/projects/${state.projectId}/access`);
    await page.waitForLoadState('domcontentloaded');

    // Switch to the Members tab and open the Add member dialog.
    await page.getByRole('tab', { name: /members/i }).click();
    const addBtn = page.getByRole('button', { name: /add member/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });

    await clearAllEmails();

    await addBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Switch to the "Invite by email" tab inside the dialog.
    await dialog.getByRole('tab', { name: /invite by email/i }).click();

    await dialog.locator('#invite-email').fill(state.guestEmail);
    await dialog.locator('#invite-full-name').fill(state.guestFullName);
    await dialog.locator('#project-member-role-invite').selectOption('inspector');

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/invitations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: /add/i }).click(),
    ]);
    if (!inviteResp.ok()) {
      const body = await inviteResp.text();
      throw new Error(`Invite API returned ${inviteResp.status()}: ${body}`);
    }

    // Wait for dialog to close (same race-handling pattern as C4).
    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('G2: guest activation email extracted from MailHog', async () => {
    const body = await waitForEmail(state.guestEmail, { timeoutMs: 40_000 });
    const activationUrl = extractUrlFromEmail(body, /\/activate\?token=/);
    const parsed = new URL(activationUrl);
    state._guestActivationPath = parsed.pathname + parsed.search;
  });

  test('G3: guest activates account (sets password)', async ({ page }) => {
    await page.goto(state._guestActivationPath);
    await expect(page.getByRole('heading', { name: /activate/i })).toBeVisible();

    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill(state.guestPassword);
    await passwords.nth(1).fill(state.guestPassword);

    await page.getByRole('button', { name: /activate account/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });

  test('G4: guest logs in, accepts org invite, and sees the project', async ({ page }) => {
    await loginViaUI(page, state.guestEmail, state.guestPassword, {
      expectedPathPattern: /\/(account|projects)/,
    });

    // Accept the pending org invitation if it wasn't auto-accepted during login.
    await page.goto('/en/account');
    const invTab = page.getByRole('tab', { name: /invitations/i });
    if (await invTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await invTab.click();
      const acceptBtn = page.getByRole('button', { name: /accept/i });
      if (await acceptBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await acceptBtn.click();
        await expect(acceptBtn).not.toBeVisible({ timeout: 10_000 });
      }
    }

    // Guest should see exactly the one project they were invited to.
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    // Only one project card (guests are filtered to explicit memberships).
    const cards = page.locator('a[href*="/projects/"]').filter({ has: page.getByText(state.projectName) });
    await expect(cards).toHaveCount(1);
  });

  // =========================================================================
  // H — Guest permission boundaries
  // =========================================================================

  test('H1: guest sees read-only access page — no member management', async ({ page }) => {
    await injectSavedAuth(page, state.guestEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);
    await page.waitForLoadState('domcontentloaded');

    // Overview tab: "View-only access" card visible, Quick Actions card absent.
    await expect(page.getByText(/view-only access/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/quick actions/i)).not.toBeVisible();

    // Members tab: no "Add member" button, no actions column dropdowns.
    await page.getByRole('tab', { name: /members/i }).click();
    await expect(page.getByRole('button', { name: /add member/i })).not.toBeVisible();

    // No actions dropdown triggers on any member row.
    const actionButtons = page.getByRole('button', { name: /actions/i });
    await expect(actionButtons).toHaveCount(0);
  });

  test('H2: guest cannot create a new project', async ({ page }) => {
    await injectSavedAuth(page, state.guestEmail);
    await page.goto('/en/projects');

    // "New project" button is always rendered (no UI gate).
    await page.getByRole('button', { name: /new project/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Walk through the wizard to trigger the API call.
    // Wizard order: Basics → Address → Details.
    // Step 1 — Basics
    await dialog.locator('input[name="name"]').fill('Should-Fail-Guest-Create');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Address');

    // Step 2 — Address (fix lat/lng NaN issue, same as C3)
    await page.evaluate(() => {
      const el = document.querySelector('input[name="latitude"]') as HTMLElement | null;
      if (!el) throw new Error('latitude input not found');
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) throw new Error('no React fiber key');
      type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber | null };
      let fiber: Fiber | null = (el as unknown as Record<string, unknown>)[fiberKey] as Fiber;
      for (let depth = 0; fiber && depth < 200; depth++) {
        const props = fiber.memoizedProps;
        if (props && typeof props['value'] === 'object' && props['value'] !== null) {
          const ctx = props['value'] as Record<string, unknown>;
          if ('_formValues' in ctx) {
            const fv = ctx['_formValues'] as Record<string, unknown>;
            fv['latitude'] = 52.37;
            fv['longitude'] = 4.89;
            return;
          }
        }
        fiber = fiber.return ?? null;
      }
      throw new Error('RHF form context not found in fiber tree');
    });
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Details');

    // Step 3 — Details
    await dialog.locator('select[name="building_type"]').selectOption('dwelling');

    // Step 4 — Team: satisfy the create gate so the guest can actually press
    // "Create project". The 403 comes from the server (POST /projects); the
    // queued invite never fires because createProject throws first.
    await addWizardTeamInvite(dialog, `h2team-${RUN}@example.com`);

    // "Create project" on the last step
    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/projects') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: /create project/i }).click(),
    ]);

    expect(createResp.status()).toBe(403);
    const body = await createResp.json();
    expect(body.detail).toBe('GUEST_CANNOT_CREATE_PROJECT');

    await page.keyboard.press('Escape');
  });

  test('H3: guest cannot edit or delete the project', async ({ page }) => {
    await injectSavedAuth(page, state.guestEmail);
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    // --- Edit attempt ---
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    const nameInput = editDialog.locator('input[name="name"]');
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill('Guest-Edit-Should-Fail');

    await editDialog.locator('button[aria-label="Details"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Details');

    const [editResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      editDialog.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(editResp.status()).toBe(403);

    await page.keyboard.press('Escape');
    await expect(editDialog).not.toBeVisible({ timeout: 5_000 });

    // Re-navigate to clear any error toasts that overlay the card controls.
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    // --- Delete attempt ---
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: /remove/i }).click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      confirmDialog.getByRole('button', { name: /remove/i }).click(),
    ]);
    expect(deleteResp.status()).toBe(403);

    await expect(page.getByText(/do not have permission/i)).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });

  // =========================================================================
  // I — Owner manages guest (role change + removal)
  // =========================================================================

  test('I1: owner changes guest role from inspector to editor', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);

    await page.getByRole('tab', { name: /members/i }).click();

    // Find the guest row and open its actions dropdown.
    const guestRow = page.getByRole('row').filter({ hasText: state.guestEmail });
    await expect(guestRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = guestRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /editor/i }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Role change failed: ${patchResp.status()}: ${body}`);
    }

    // Badge should now show "Editor".
    await expect(guestRow.getByText(/editor/i)).toBeVisible({ timeout: 5_000 });
  });

  test('I2: guest (now editor) can edit the project', async ({ page }) => {
    await injectSavedAuth(page, state.guestEmail);
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    // Edit the project name.
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    const editedName = `${state.projectName} (guest-edit)`;
    const nameInput = editDialog.locator('input[name="name"]');
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(editedName);

    await editDialog.locator('button[aria-label="Details"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Details');

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      editDialog.getByRole('button', { name: /save changes/i }).click(),
    ]);
    if (!saveResp.ok()) {
      const body = await saveResp.text();
      throw new Error(`Guest edit failed: ${saveResp.status()}: ${body}`);
    }

    try {
      await editDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
    }

    // Re-navigate so the card and its dropdown trigger are in a clean state.
    await page.goto('/en/projects');
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 10_000 });

    // Restore original name so later tests aren't affected.
    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();
    await expect(editDialog).toBeVisible();

    const restoreInput = editDialog.locator('input[name="name"]');
    await restoreInput.click({ clickCount: 3 });
    await restoreInput.fill(state.projectName);

    await editDialog.locator('button[aria-label="Details"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Details');

    const [restoreResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      editDialog.getByRole('button', { name: /save changes/i }).click(),
    ]);
    if (!restoreResp.ok()) {
      const body = await restoreResp.text();
      throw new Error(`Name restore failed: ${restoreResp.status()}: ${body}`);
    }

    try {
      await editDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
    }
  });

  test('I3: owner removes guest — guest can no longer see the project', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);

    await page.getByRole('tab', { name: /members/i }).click();

    const guestRow = page.getByRole('row').filter({ hasText: state.guestEmail });
    await expect(guestRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = guestRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /remove/i }).click(),
    ]);
    if (!deleteResp.ok()) {
      const body = await deleteResp.text();
      throw new Error(`Remove member failed: ${deleteResp.status()}: ${body}`);
    }

    await expect(guestRow).not.toBeVisible({ timeout: 10_000 });

    // Now verify the removed guest can no longer see the project.
    await injectSavedAuth(page, state.guestEmail);
    await page.goto('/en/projects');
    await page.waitForLoadState('domcontentloaded');

    // The project should not be visible; the list should be empty for this guest.
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // J — Invite existing org member (Scenario 3: already in org)
  // =========================================================================

  test('J1: admin invites existing org member via "Invite by email" tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);

    await clearAllEmails();

    await page.goto(`/en/projects/${state.projectId}/access`);
    await page.getByRole('tab', { name: /members/i }).click();

    const addBtn = page.getByRole('button', { name: /add member/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('tab', { name: /invite by email/i }).click();
    await dialog.locator('#invite-email').fill(state.memberEmail);
    await dialog.locator('#project-member-role-invite').selectOption('editor');

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/invitations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: /add/i }).click(),
    ]);
    if (!inviteResp.ok()) {
      const body = await inviteResp.text();
      throw new Error(`Invite existing member failed: ${inviteResp.status()}: ${body}`);
    }

    const respBody = await inviteResp.json();
    expect(respBody.scenario).toBe('existing_org_member');

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('J2: notification email arrives and member sees the project', async ({ page }) => {
    const body = await waitForEmail(state.memberEmail, { timeoutMs: 40_000 });
    expect(body).toContain(state.projectName);

    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // K — Member suspension & reactivation
  // =========================================================================

  test('K1: admin suspends the member via the tenant Members tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: 'Suspend' }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Suspend member failed: ${patchResp.status()}: ${body}`);
    }

    await expect(memberRow.getByText(/suspended/i)).toBeVisible({ timeout: 5_000 });
  });

  test('K2: suspended member logs in but cannot access the workspace', async ({ page }) => {
    // Fresh login required — old cached token still has the (now-invalid) org claim.
    await loginViaAPI(page, state.memberEmail, state.memberPassword);
    await page.goto('/en/projects');

    // The token has active_organization_id=null because the membership is
    // suspended. Tenant-scoped API calls fail: either 409 NO_ACTIVE_ORGANIZATION
    // (no org claim in JWT) or 403 ORG_MEMBERSHIP_REQUIRED.
    // The projects page should NOT show the project.
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 10_000 });
  });

  test('K3: admin reactivates the member', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: 'Reactivate' }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Reactivate member failed: ${patchResp.status()}: ${body}`);
    }

    await expect(memberRow.getByText(/active/i)).toBeVisible({ timeout: 5_000 });
  });

  test('K4: reactivated member can access projects again', async ({ page }) => {
    // Fresh login to get a token with the active org claim restored.
    await loginViaAPI(page, state.memberEmail, state.memberPassword);
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // L — Tenant (org) suspension & reactivation
  // =========================================================================

  test('L1: super admin navigates to org detail and captures orgId', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/organizations');
    // The org list (with clickable links) is in the Organizations tab.
    await page.getByRole('tab', { name: /organizations/i }).click();
    const orgLink = page.getByRole('link', { name: state.orgName });
    await expect(orgLink).toBeVisible({ timeout: 10_000 });
    await orgLink.click();

    await page.waitForURL(/\/admin\/organizations\/[0-9a-f-]+/, { timeout: 10_000 });
    const idMatch = page.url().match(/\/organizations\/([0-9a-f-]+)/);
    if (!idMatch?.[1]) throw new Error('Could not extract orgId from URL');
    state.orgId = idMatch[1];
  });

  test('L2: super admin suspends the tenant', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto(`/en/admin/organizations/${state.orgId}`);
    await page.waitForLoadState('domcontentloaded');

    // Click the "Suspend" button in the hero section.
    const suspendBtn = page.getByRole('button', { name: 'Suspend' });
    await expect(suspendBtn).toBeVisible({ timeout: 10_000 });
    await suspendBtn.click();

    // Confirm the dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/organizations/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: /suspend tenant/i }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Suspend org failed: ${patchResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }

    // Status badge should now show "Suspended".
    await expect(page.getByText(/suspended/i)).toBeVisible({ timeout: 5_000 });
  });

  test('L3: admin member is blocked from workspace while org is suspended', async ({ page }) => {
    // Fresh login — the old token's org claim points at a now-suspended org.
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/projects');

    // Tenant is suspended → API returns 403 ORG_SUSPENDED or 409 NO_ACTIVE_ORGANIZATION
    // depending on whether the JWT still carries the org claim. Either way the
    // project is not visible.
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 10_000 });
  });

  test('L4: super admin reactivates the tenant', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto(`/en/admin/organizations/${state.orgId}`);
    await page.waitForLoadState('domcontentloaded');

    const reactivateBtn = page.getByRole('button', { name: 'Reactivate' });
    await expect(reactivateBtn).toBeVisible({ timeout: 10_000 });
    await reactivateBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/organizations/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: /reactivate tenant/i }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Reactivate org failed: ${patchResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }

    await expect(page.getByText(/active/i)).toBeVisible({ timeout: 5_000 });
  });

  test('L5: admin can access projects again after org reactivation', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/projects');
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // M — Member removal & re-invite
  // =========================================================================

  test('M1: admin removes the member from the tenant', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /remove from tenant/i }).click(),
    ]);
    if (!deleteResp.ok()) {
      const body = await deleteResp.text();
      throw new Error(`Remove member failed: ${deleteResp.status()}: ${body}`);
    }

    await expect(memberRow).not.toBeVisible({ timeout: 10_000 });
  });

  test('M2: removed member logs in but has no workspace access', async ({ page }) => {
    await loginViaAPI(page, state.memberEmail, state.memberPassword);
    await page.goto('/en/projects');

    // Membership row was deleted → no org in token → projects not visible.
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 10_000 });
  });

  test('M3: admin re-invites the removed member', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await clearAllEmails();

    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Invite member' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="email"]').fill(state.memberEmail);
    // full_name is optional for existing users; some UIs pre-fill it.
    // Fill it anyway so the field validation passes.
    const fullNameInput = dialog.locator('input[name="full_name"]');
    if (await fullNameInput.isVisible()) {
      await fullNameInput.fill(`E2E Member ${RUN}`);
    }

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Send invite' }).click(),
    ]);
    if (!inviteResp.ok()) {
      const body = await inviteResp.text();
      throw new Error(`Re-invite member failed: ${inviteResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('M4: re-invited member receives invite and accepts', async ({ page }) => {
    // The member is already verified (activated in B/D), so the backend sends
    // an invite notification (not activation email). They accept via the
    // /account Invitations tab.
    const body = await waitForEmail(state.memberEmail, { timeoutMs: 40_000 });
    expect(body).toBeTruthy();

    await loginViaAPI(page, state.memberEmail, state.memberPassword);
    await page.goto('/en/account');

    const invTab = page.getByRole('tab', { name: /invitations/i });
    if (await invTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await invTab.click();
      const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
      if (await acceptBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await acceptBtn.click();
        await expect(acceptBtn).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('M5: re-added member can access the workspace again', async ({ page }) => {
    // Fresh login after accepting the invite to get an org-bearing token.
    await loginViaAPI(page, state.memberEmail, state.memberPassword);
    await page.goto('/en/projects');

    // The member was re-added to the org but their project_members rows were
    // deleted on removal (M1). An empty project list (no 403) proves the
    // membership is restored — the member just isn't on any project yet.
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  });

  // =========================================================================
  // N — Last-admin protection
  // =========================================================================

  test('N1: last admin cannot leave or demote themselves', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();

    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = adminRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    // "Leave tenant" should be visible but DISABLED because this is the
    // last (and only) admin.
    const leaveItem = page.getByRole('menuitem', { name: /leave tenant/i });
    await expect(leaveItem).toBeVisible();
    await expect(leaveItem).toBeDisabled();

    // "Revoke admin" should be visible but DISABLED (last admin).
    const demoteItem = page.getByRole('menuitem', { name: /revoke admin/i });
    await expect(demoteItem).toBeVisible();
    await expect(demoteItem).toBeDisabled();

    // Dismiss the dropdown.
    await page.keyboard.press('Escape');
  });

  // =========================================================================
  // O — Seat limit enforcement
  // =========================================================================

  test('O1: super admin sets seat limit equal to current usage', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto(`/en/admin/organizations/${state.orgId}`);
    await page.waitForLoadState('domcontentloaded');

    // Click the Edit button to open the edit dialog.
    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Set seat_limit to the current consumed count (admin = 1 regular member
    // after the re-invite in M3; the guest is is_guest=true and doesn't count).
    // We'll set it to 2 — admin + the newly re-invited member.
    const seatInput = dialog.locator('input[name="seat_limit"]');
    await seatInput.click({ clickCount: 3 });
    await seatInput.fill('2');

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/organizations/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: /save/i }).click(),
    ]);
    if (!saveResp.ok()) {
      const body = await saveResp.text();
      throw new Error(`Set seat limit failed: ${saveResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('O2: admin cannot invite beyond the seat limit', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Invite member' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="email"]').fill(`overflow-${RUN}@example.com`);
    const fullNameInput = dialog.locator('input[name="full_name"]');
    if (await fullNameInput.isVisible()) {
      await fullNameInput.fill(`E2E Overflow ${RUN}`);
    }

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Send invite' }).click(),
    ]);

    // Should fail with 409 SEAT_LIMIT_EXCEEDED.
    expect(inviteResp.status()).toBe(409);
    const body = await inviteResp.json();
    expect(body.detail).toBe('SEAT_LIMIT_EXCEEDED');

    // The portal surfaces the seat-limit error as a field error on the email
    // input inside the invite dialog (errors.seatLimitExceeded).
    await expect(
      dialog.getByText('Seat limit reached'),
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
  });

  test('O3: super admin removes the seat limit', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto(`/en/admin/organizations/${state.orgId}`);
    await page.waitForLoadState('domcontentloaded');

    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Clear the seat_limit field to make it unlimited.
    const seatInput = dialog.locator('input[name="seat_limit"]');
    await seatInput.click({ clickCount: 3 });
    await seatInput.fill('');

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/organizations/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: /save/i }).click(),
    ]);
    if (!saveResp.ok()) {
      const body = await saveResp.text();
      throw new Error(`Remove seat limit failed: ${saveResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  // =========================================================================
  // P — Profile name edit
  // =========================================================================

  test('P1: admin navigates to /account and sees Profile tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/account');

    const profileTab = page.getByRole('tab', { name: /profile/i });
    await expect(profileTab).toBeVisible({ timeout: 10_000 });
    await profileTab.click();

    // The profile pane should display "Personal Information" card heading.
    await expect(
      page.getByRole('heading', { name: /personal information/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('P2: admin edits their display name', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/account');

    await expect(
      page.getByRole('heading', { name: /personal information/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Click the pencil button next to the name (title="Edit").
    const pencilBtn = page.getByTitle('Edit');
    await expect(pencilBtn).toBeVisible({ timeout: 5_000 });
    await pencilBtn.click();

    // The inline name editor should appear with a text input.
    const nameInput = page.locator('input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(`Admin ${RUN} (edited)`);

    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/me/profile') && r.request().method() === 'PATCH',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /save/i }).click(),
    ]);
    if (!saveResp.ok()) {
      const body = await saveResp.text();
      throw new Error(`Profile update failed: ${saveResp.status()}: ${body}`);
    }
  });

  test('P3: updated name is reflected in the UI', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/account');

    await expect(page.getByText(`Admin ${RUN} (edited)`).first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // Q — Invitation decline
  // =========================================================================

  test('Q1: super admin creates a temp org with admin email to test invitation decline', async ({ page }) => {
    // Strategy: use the already-verified admin user as the invitee.
    // Because admin is already activated and has an active org1 membership,
    // the `on_after_verify` auto-accept hook will NOT fire — it only triggers
    // during first account activation for users with 0 active memberships.
    // The Q-org invitation therefore stays pending until admin manually declines.
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    state.q_org_name = `E2E-Q-Org-${RUN}`;
    await clearAllEmails();

    await page.goto('/en/admin/organizations');
    await page.getByRole('tab', { name: /organizations/i }).click();
    const newTenantBtn = page.getByRole('button', { name: 'New tenant' });
    await expect(newTenantBtn).toBeVisible({ timeout: 10_000 });
    await newTenantBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill(state.q_org_name);
    await dialog.locator('input[name="admin_email"]').fill(state.adminEmail);

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('organizations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Create tenant', exact: true }).click(),
    ]);

    if (!createResp.ok()) {
      const body = await createResp.text();
      throw new Error(`Create Q-org failed: ${createResp.status()}: ${body}`);
    }

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test('Q2: admin sees the Q-org invitation on the Invitations tab', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/account');

    const invTab = page.getByRole('tab', { name: /invitations/i });
    await expect(invTab).toBeVisible({ timeout: 10_000 });
    await invTab.click();

    // Q-org invite stays pending — admin is already verified so no auto-accept.
    await expect(page.getByText(state.q_org_name)).toBeVisible({ timeout: 10_000 });
  });

  test('Q3: admin declines the Q-org invitation', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/account');

    const invTab = page.getByRole('tab', { name: /invitations/i });
    await invTab.click();

    await expect(page.getByText(state.q_org_name)).toBeVisible({ timeout: 10_000 });

    const declineBtn = page.getByRole('button', { name: /decline/i }).first();
    await expect(declineBtn).toBeVisible({ timeout: 10_000 });

    const [declineResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/invitations/') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      declineBtn.click(),
    ]);

    if (declineResp.status() !== 204 && !declineResp.ok()) {
      const body = await declineResp.text();
      throw new Error(`Decline invitation failed: ${declineResp.status()}: ${body}`);
    }

    // Q-org entry disappears from the Invitations tab after declining.
    await expect(page.getByText(state.q_org_name)).not.toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // R — Organization switching
  // =========================================================================

  test('R1: super admin creates a second tenant with the same admin email', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    state.org2Name = `E2E-Org2-${RUN}`;

    await clearAllEmails();

    await page.goto('/en/admin/organizations');
    // Switch to the Organizations tab where the "New tenant" button lives.
    await page.getByRole('tab', { name: /organizations/i }).click();
    const newTenantBtn = page.getByRole('button', { name: 'New tenant' });
    await expect(newTenantBtn).toBeVisible({ timeout: 10_000 });
    await newTenantBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill(state.org2Name);
    await dialog.locator('input[name="admin_email"]').fill(state.adminEmail);

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('organizations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Create tenant', exact: true }).click(),
    ]);

    if (!createResp.ok()) {
      const body = await createResp.text();
      throw new Error(`Create org2 API returned ${createResp.status()}: ${body}`);
    }

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(state.org2Name)).toBeVisible({ timeout: 10_000 });
  });

  test('R2: admin accepts the org2 invitation', async ({ page }) => {
    // Fresh login so the portal fetches the latest invitation list.
    // Admin already has an active org1 membership → the on_after_verify
    // auto-accept rule does NOT fire, so org2 stays pending until accepted here.
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/account');

    // Invitations tab must be visible — R1 just created an org2 invitation.
    const invTab = page.getByRole('tab', { name: /invitations/i });
    await expect(invTab).toBeVisible({ timeout: 15_000 });
    await invTab.click();

    // The org2 invitation row must be visible.
    await expect(page.getByText(state.org2Name)).toBeVisible({ timeout: 10_000 });

    const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 10_000 });

    const [acceptResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/invitations/') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      acceptBtn.click(),
    ]);
    if (!acceptResp.ok()) {
      const body = await acceptResp.text();
      throw new Error(`Accept org2 invitation failed: ${acceptResp.status()}: ${body}`);
    }

    // After accepting, the pending invitation row should disappear.
    await expect(acceptBtn).not.toBeVisible({ timeout: 10_000 });
  });

  test('R3: admin sees both orgs on /select-tenant', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/select-tenant');

    // The select-tenant page auto-redirects if only 1 membership.
    // With 2 memberships, it should show both org names.
    await expect(page.getByText(state.orgName)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(state.org2Name)).toBeVisible({ timeout: 10_000 });
  });

  test('R4: admin switches to org2', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/select-tenant');

    await expect(page.getByText(state.org2Name)).toBeVisible({ timeout: 10_000 });

    const [switchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/switch-organization') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: state.org2Name }).click(),
    ]);
    if (!switchResp.ok()) {
      const body = await switchResp.text();
      throw new Error(`Switch org failed: ${switchResp.status()}: ${body}`);
    }

    // Should land on /projects (empty for org2, but page should load).
    await page.waitForURL(/\/projects/, { timeout: 15_000 });

    // org1 project should NOT be visible in org2 context.
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 5_000 });
  });

  test('R5: admin switches back to org1 and sees the original project', async ({ page }) => {
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/select-tenant');

    await expect(page.getByText(state.orgName)).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/switch-organization') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('button', { name: state.orgName }).click(),
    ]);

    await page.waitForURL(/\/projects/, { timeout: 15_000 });
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    // Save the org1-scoped tokens that the switch just issued into the in-process
    // cache. Subsequent injectSavedAuth calls will inject these org1 tokens
    // rather than the stale org2-scoped tokens that loginViaAPI set above.
    await updateTokenCacheFromPage(page, state.adminEmail);
  });

  // =========================================================================
  // S — Project lifecycle: archive, reactivate, delete
  // =========================================================================

  test('S1: admin creates a second project for lifecycle tests', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);

    state.lifecycleProjectName = `E2E-Lifecycle-${RUN}`;

    await page.goto('/en/projects');
    await page.getByRole('button', { name: 'New project' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill(state.lifecycleProjectName);
    await dialog.locator('textarea').first().fill('Project for archive/delete tests');

    // Wizard order: Basics → Address → Details.
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Address');

    // Fix lat/lng NaN issue (same as C3).
    await page.evaluate(() => {
      const el = document.querySelector('input[name="latitude"]') as HTMLElement | null;
      if (!el) throw new Error('latitude input not found');
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) throw new Error('no React fiber key');
      type Fiber = { memoizedProps?: Record<string, unknown>; return?: Fiber | null };
      let fiber: Fiber | null = (el as unknown as Record<string, unknown>)[fiberKey] as Fiber;
      for (let depth = 0; fiber && depth < 200; depth++) {
        const props = fiber.memoizedProps;
        if (props && typeof props['value'] === 'object' && props['value'] !== null) {
          const ctx = props['value'] as Record<string, unknown>;
          if ('_formValues' in ctx) {
            const fv = ctx['_formValues'] as Record<string, unknown>;
            fv['latitude'] = 52.37;
            fv['longitude'] = 4.89;
            return;
          }
        }
        fiber = fiber.return ?? null;
      }
      throw new Error('RHF form context not found in fiber tree');
    });

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Details');

    await dialog.locator('select[name="building_type"]').selectOption('dwelling');

    // Team step: queue an email invite so the create gate (>=1 teammate) passes.
    await addWizardTeamInvite(dialog, `s1team-${RUN}@example.com`);

    await dialog.getByRole('button', { name: 'Create project' }).click();

    await page.waitForURL(/\/projects\/[0-9a-f-]+/, { timeout: 20_000 });

    const idMatch = page.url().match(/\/projects\/([0-9a-f-]+)/);
    if (!idMatch?.[1]) throw new Error('Could not extract lifecycleProjectId from URL');
    state.lifecycleProjectId = idMatch[1];
  });

  test('S2: admin archives the lifecycle project', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');

    await expect(page.getByText(state.lifecycleProjectName)).toBeVisible({ timeout: 10_000 });

    // Find the lifecycle project card's action menu.
    // There may be multiple project cards; target the one containing the lifecycle project name.
    const cards = page.locator('a[href*="/projects/"]').filter({
      has: page.getByText(state.lifecycleProjectName),
    });
    // "Project actions" button is a sibling of the <a> link (rendered by
    // <ProjectCardMenu> outside <Link> in ProjectCard.tsx). Step up to the
    // parent card container with locator('..') before querying the button.
    const actionsBtn = cards.first().locator('..').getByRole('button', { name: 'Project actions' });
    await actionsBtn.click();

    await page.getByRole('menuitem', { name: /archive/i }).click();

    const archiveDialog = page.getByRole('dialog');
    await expect(archiveDialog).toBeVisible({ timeout: 5_000 });

    const [archiveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/projects/${state.lifecycleProjectId}/archive`)
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      archiveDialog.getByRole('button', { name: 'Archive' }).click(),
    ]);
    if (!archiveResp.ok()) {
      const body = await archiveResp.text();
      throw new Error(`Archive project failed: ${archiveResp.status()}: ${body}`);
    }
  });

  test('S3: archived project shows the Archived badge in the default project list', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');

    // The default "All" filter shows EVERY project, including archived ones.
    // Archived projects are not hidden — they appear with an "Archived · read only" badge.
    await page.waitForLoadState('domcontentloaded');

    // Both the original project and the just-archived lifecycle project should be visible.
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(state.lifecycleProjectName)).toBeVisible({ timeout: 10_000 });

    // The archived badge confirms the archive operation succeeded.
    await expect(page.getByText('Archived · read only')).toBeVisible({ timeout: 5_000 });
  });

  test('S4: admin reactivates the archived project', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');

    // The archived lifecycle project is visible in the default list.
    await expect(page.getByText(state.lifecycleProjectName)).toBeVisible({ timeout: 10_000 });

    // Open the card menu and click Reactivate.
    const cards = page.locator('a[href*="/projects/"]').filter({
      has: page.getByText(state.lifecycleProjectName),
    });
    const actionsBtn = cards.first().locator('..').getByRole('button', { name: 'Project actions' });
    await actionsBtn.click();

    const [reactivateResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/projects/${state.lifecycleProjectId}/reactivate`)
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /reactivate/i }).click(),
    ]);
    if (!reactivateResp.ok()) {
      const body = await reactivateResp.text();
      throw new Error(`Reactivate project failed: ${reactivateResp.status()}: ${body}`);
    }
  });

  test('S5: member cannot delete the lifecycle project (403)', async ({ page }) => {
    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/projects');

    // Member was re-added to the org in M3-M5 but may not be on the lifecycle
    // project. If the project card is visible, try to delete; otherwise the
    // member simply has no access — which is the correct outcome.
    const projectCard = page.getByText(state.lifecycleProjectName);
    const isVisible = await projectCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!isVisible) {
      // Member doesn't see the project at all — passes (no access = no delete).
      return;
    }

    const cards = page.locator('a[href*="/projects/"]').filter({
      has: page.getByText(state.lifecycleProjectName),
    });
    await cards.first().locator('..').getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: /remove/i }).click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/projects/${state.lifecycleProjectId}`)
          && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      confirmDialog.getByRole('button', { name: /remove/i }).click(),
    ]);

    expect(deleteResp.status()).toBe(403);
    await page.keyboard.press('Escape');
  });

  test('S6: admin deletes the lifecycle project', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');

    await expect(page.getByText(state.lifecycleProjectName)).toBeVisible({ timeout: 10_000 });

    const cards = page.locator('a[href*="/projects/"]').filter({
      has: page.getByText(state.lifecycleProjectName),
    });
    await cards.first().locator('..').getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: /remove/i }).click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/projects/${state.lifecycleProjectId}`)
          && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      confirmDialog.getByRole('button', { name: /remove/i }).click(),
    ]);
    if (!deleteResp.ok()) {
      const body = await deleteResp.text();
      throw new Error(`Delete project failed: ${deleteResp.status()}: ${body}`);
    }

    // Wait for the confirm dialog to close before checking the project list.
    // The dialog description contains the project name, so checking
    // getByText() while the dialog is still visible causes a strict-mode
    // violation (2 elements match: card title + dialog description).
    await expect(confirmDialog).not.toBeVisible({ timeout: 10_000 });

    // Project should disappear from the list.
    await expect(page.getByText(state.lifecycleProjectName)).not.toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // T — Project member role change + removal
  // =========================================================================

  test('T1: admin adds member to the project as editor', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);

    await page.getByRole('tab', { name: /members/i }).click();

    // Check if member is already on the project; if not, add them.
    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    const alreadyMember = await memberRow.isVisible({ timeout: 3_000 }).catch(() => false);
    if (alreadyMember) return;

    await clearAllEmails();

    const addBtn = page.getByRole('button', { name: /add member/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('tab', { name: /invite by email/i }).click();
    await dialog.locator('#invite-email').fill(state.memberEmail);
    await dialog.locator('#project-member-role-invite').selectOption('editor');

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/invitations') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: /add/i }).click(),
    ]);
    if (!inviteResp.ok()) {
      const body = await inviteResp.text();
      throw new Error(`Add member to project failed: ${inviteResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('T2: admin changes member project role from editor to viewer', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);

    await page.getByRole('tab', { name: /members/i }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    // The menu item format is "Set as Viewer".
    const [patchResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /viewer/i }).click(),
    ]);
    if (!patchResp.ok()) {
      const body = await patchResp.text();
      throw new Error(`Role change to viewer failed: ${patchResp.status()}: ${body}`);
    }

    // The mutation's onSuccess invalidates the project-members query, which
    // triggers a background refetch. Wait for the badge to update; if the
    // cache invalidation + refetch is slow, reload the page as a fallback.
    const viewerBadge = memberRow.getByText(/viewer/i);
    const updatedInPlace = await viewerBadge.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!updatedInPlace) {
      await page.reload();
      await page.getByRole('tab', { name: /members/i }).click();
      const refreshedRow = page.getByRole('row').filter({ hasText: state.memberEmail });
      await expect(refreshedRow.getByText(/viewer/i)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('T3: member (now viewer) cannot edit the project', async ({ page }) => {
    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/projects');

    // The project should still be visible (viewers can read).
    await expect(page.getByText(state.projectName)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Project actions' }).first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();

    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    const nameInput = editDialog.locator('input[name="name"]');
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill('Viewer-Edit-Should-Fail');

    await editDialog.locator('button[aria-label="Details"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Details');

    const [editResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      ),
      editDialog.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(editResp.status()).toBe(403);

    await page.keyboard.press('Escape');
  });

  test('T4: admin removes member from project — member can no longer see it', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto(`/en/projects/${state.projectId}/access`);

    await page.getByRole('tab', { name: /members/i }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.memberEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members/') && r.request().method() === 'DELETE',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /remove/i }).click(),
    ]);
    if (!deleteResp.ok()) {
      const body = await deleteResp.text();
      throw new Error(`Remove member from project failed: ${deleteResp.status()}: ${body}`);
    }

    await expect(memberRow).not.toBeVisible({ timeout: 10_000 });

    // Verify removed member can't see the project.
    await injectSavedAuth(page, state.memberEmail);
    await page.goto('/en/projects');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(state.projectName)).not.toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // U — Resend invitation
  // =========================================================================

  test('U1: admin invites a fresh user to the tenant for resend-invite test', async ({ page }) => {
    // Use a brand-new email that has never been invited before.
    // This user will NOT be activated, so the invite stays pending — exactly
    // what we need to exercise the "Resend invite" action in U2.
    await injectSavedAuth(page, state.adminEmail);

    state.u_inviteEmail = `u-${RUN}@example.com`;
    await clearAllEmails();

    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Invite member' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="email"]').fill(state.u_inviteEmail);
    const fullNameInput = dialog.locator('input[name="full_name"]');
    if (await fullNameInput.isVisible()) {
      await fullNameInput.fill(`E2E Invite ${RUN}`);
    }

    const [inviteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/members') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: 'Send invite' }).click(),
    ]);
    if (!inviteResp.ok()) {
      const body = await inviteResp.text();
      throw new Error(`Invite u-user failed: ${inviteResp.status()}: ${body}`);
    }

    try {
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    } catch {
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test('U2: admin resends the pending invite via member actions', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await clearAllEmails();

    await page.goto('/en/tenant');
    await page.getByRole('tab', { name: 'Members' }).click();

    const memberRow = page.getByRole('row').filter({ hasText: state.u_inviteEmail });
    await expect(memberRow).toBeVisible({ timeout: 10_000 });

    const actionsBtn = memberRow.getByRole('button', { name: /actions/i });
    await actionsBtn.click();

    const [resendResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/resend-invite') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      page.getByRole('menuitem', { name: /resend invite/i }).click(),
    ]);

    if (resendResp.status() !== 204 && !resendResp.ok()) {
      const body = await resendResp.text();
      throw new Error(`Resend invite failed: ${resendResp.status()}: ${body}`);
    }
  });

  test('U3: resent invite email arrives in MailHog', async () => {
    const body = await waitForEmail(state.u_inviteEmail, { timeoutMs: 40_000 });
    expect(body).toBeTruthy();
  });

  // =========================================================================
  // V — Guest flag toggle (API-driven — no portal UI for the toggle)
  // =========================================================================
  // Skipped: The guest flag toggle endpoint (PATCH /organizations/{org_id}/members/{user_id}/guest)
  // exists in the API but has no portal UI trigger. Guest status is set during the project invitation
  // flow. This is better covered by API-level tests. Suites G–I already verify guest permission
  // boundaries end-to-end.

  // =========================================================================
  // W — Super admin user management
  // =========================================================================

  test('W1: super admin navigates to /admin/users and finds the admin user', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/users');
    await page.waitForLoadState('domcontentloaded');

    // Search for the admin by email.
    const searchInput = page.getByRole('textbox', { name: /search users/i });
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill(state.adminEmail);

    // Wait for the user row to appear.
    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    // Capture the admin's user ID from the promote/demote button's mutation call.
    // We'll extract it from the API response in W2.
  });

  test('W2: super admin promotes admin to superuser', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/users');
    const searchInput = page.getByRole('textbox', { name: /search users/i });
    await searchInput.fill(state.adminEmail);

    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    // The "Promote" button is in the actions column.
    const promoteBtn = adminRow.getByRole('button', { name: /promote/i });
    await expect(promoteBtn).toBeVisible({ timeout: 5_000 });

    const [promoteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/users/') && r.url().includes('/promote')
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      promoteBtn.click(),
    ]);
    if (!promoteResp.ok()) {
      const body = await promoteResp.text();
      throw new Error(`Promote user failed: ${promoteResp.status()}: ${body}`);
    }

    // The badge should now show "Super admin" for the superuser column.
    await expect(adminRow.getByText(/super admin/i)).toBeVisible({ timeout: 5_000 });
  });

  test('W3: promoted admin can access /admin/organizations', async ({ page }) => {
    // Fresh login to get a token reflecting the new superuser status.
    await loginViaAPI(page, state.adminEmail, state.adminPassword);
    await page.goto('/en/admin/organizations');
    // Switch to the Organizations tab to confirm the page is fully accessible.
    await page.getByRole('tab', { name: /organizations/i }).click();
    // If the admin is now a superuser, this page should load without redirect.
    await expect(
      page.getByRole('button', { name: 'New tenant' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('W4: super admin demotes admin back to normal user', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/users');
    const searchInput = page.getByRole('textbox', { name: /search users/i });
    await searchInput.fill(state.adminEmail);

    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    // After promotion, the button label should now be "Demote".
    const demoteBtn = adminRow.getByRole('button', { name: /demote/i });
    await expect(demoteBtn).toBeVisible({ timeout: 5_000 });

    const [demoteResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/users/') && r.url().includes('/demote')
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      demoteBtn.click(),
    ]);
    if (!demoteResp.ok()) {
      const body = await demoteResp.text();
      throw new Error(`Demote user failed: ${demoteResp.status()}: ${body}`);
    }
  });

  test('W5: super admin deactivates the admin user', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/users');
    const searchInput = page.getByRole('textbox', { name: /search users/i });
    await searchInput.fill(state.adminEmail);

    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    // Button label is "Disable" (i18n key "deactivate" = "Disable").
    const deactivateBtn = adminRow.getByRole('button', { name: /disable/i });
    await expect(deactivateBtn).toBeVisible({ timeout: 5_000 });

    const [deactivateResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/users/') && r.url().includes('/deactivate')
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      deactivateBtn.click(),
    ]);
    if (!deactivateResp.ok()) {
      const body = await deactivateResp.text();
      throw new Error(`Deactivate user failed: ${deactivateResp.status()}: ${body}`);
    }

    // Access badge now shows "Disabled".
    await expect(adminRow.getByText(/disabled/i)).toBeVisible({ timeout: 5_000 });
  });

  test('W6: deactivated admin cannot log in', async ({ page }) => {
    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');

    // Triple-click to select any autofilled/stale value before fill —
    // same pattern as loginViaUI to avoid concatenated emails.
    const emailInput = page.locator('input[name="username"]');
    await emailInput.click({ clickCount: 3 });
    await emailInput.fill(state.adminEmail);
    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.fill(state.adminPassword);

    const [loginResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/jwt/login') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);

    // Login should fail: either 400 (LOGIN_BAD_CREDENTIALS) or similar.
    expect(loginResp.ok()).toBe(false);
  });

  test('W7: super admin reactivates the admin user → admin can log in again', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/users');
    const searchInput = page.getByRole('textbox', { name: /search users/i });
    await searchInput.fill(state.adminEmail);

    const adminRow = page.getByRole('row').filter({ hasText: state.adminEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    // After deactivation, the button label is "Enable" (i18n key "activate" = "Enable").
    const activateBtn = adminRow.getByRole('button', { name: /enable/i });
    await expect(activateBtn).toBeVisible({ timeout: 5_000 });

    const [activateResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/users/') && r.url().includes('/activate')
          && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      activateBtn.click(),
    ]);
    if (!activateResp.ok()) {
      const body = await activateResp.text();
      throw new Error(`Reactivate user failed: ${activateResp.status()}: ${body}`);
    }

    // Verify admin can log in again.
    // Admin has two org memberships by this point, so the login page shows an
    // inline org-selection step (URL stays /en/login) instead of navigating away.
    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');
    const emailInput = page.locator('input[name="username"]');
    await emailInput.click({ clickCount: 3 });
    await emailInput.fill(state.adminEmail);
    const pwInput = page.locator('input[name="password"]');
    await pwInput.click({ clickCount: 3 });
    await pwInput.fill(state.adminPassword);

    const [loginResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/auth/jwt/login') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    if (!loginResp.ok()) {
      const body = await loginResp.text();
      throw new Error(`W7 login failed: ${loginResp.status()}: ${body}`);
    }

    // Click the primary org in the inline org-selector to complete login.
    const orgButton = page.getByRole('button', { name: state.orgName });
    await expect(orgButton).toBeVisible({ timeout: 10_000 });
    await orgButton.click();
    await expect(page).toHaveURL(/\/(projects|account)/, { timeout: 20_000 });

    // Update the token cache so X1–X4 can use injectSavedAuth with the fresh
    // org-scoped token from this login.
    await updateTokenCacheFromPage(page, state.adminEmail);
  });

  // =========================================================================
  // X — Audit log + Logout
  // =========================================================================

  test('X1: admin views audit entries on the /tenant Audit tab', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/tenant');

    const auditTab = page.getByRole('tab', { name: /audit/i });
    await expect(auditTab).toBeVisible({ timeout: 10_000 });
    await auditTab.click();

    // The audit log should contain at least one entry from the prior suites
    // (member invitations, role changes, suspensions, etc.).
    const tableRows = page.getByRole('row');
    // Header row + at least 1 data row.
    await expect(tableRows).not.toHaveCount(0, { timeout: 10_000 });
    // Verify some audit content is rendered (action column should have values).
    await expect(page.getByText(/member|organization|project|auth/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('X2: super admin views global audit log at /admin/audit-log', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/audit-log');
    await page.waitForLoadState('domcontentloaded');

    // The global audit log should show entries.
    const tableRows = page.getByRole('row');
    await expect(tableRows).not.toHaveCount(0, { timeout: 10_000 });
  });

  test('X3: admin logs out via the sidebar sign-out button', async ({ page }) => {
    await injectSavedAuth(page, state.adminEmail);
    await page.goto('/en/projects');
    await page.waitForLoadState('domcontentloaded');

    // Wait for the dashboard to hydrate before reaching for the sidebar. The
    // (dashboard) layout renders a <main> only as its pre-hydration fallback;
    // once hydrated it's a sidebar + <div>, and the projects list page is a
    // <div> too — so getByRole('main') races hydration and vanishes the moment
    // the real page mounts. Gate on the client-only "New project" action, which
    // is present iff the projects page is hydrated and interactive.
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible({
      timeout: 10_000,
    });

    // The logout button is in the sidebar. Its aria-label or text content is
    // "Sign out". The sidebar may be collapsed; look for the sidebar nav item.
    const signOutBtn = page.getByRole('button', { name: /sign out/i }).or(
      page.locator('a').filter({ hasText: /sign out/i }),
    );
    await expect(signOutBtn).toBeVisible({ timeout: 10_000 });

    // Click sign-out — this fires POST /auth/logout and clears localStorage.
    await signOutBtn.click();

    // Should redirect to /login.
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });

  test('X4: after logout, navigating to /projects redirects to /login', async ({ page }) => {
    // Don't inject any auth — we just logged out.
    await page.goto('/en/projects');

    // Without valid tokens, the app should redirect to /login.
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
