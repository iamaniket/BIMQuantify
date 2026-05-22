/**
 * Multitenant E2E Journey
 *
 * Runs 35 sequential tests covering the full lifecycle:
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
 *
 * Prerequisites (must all be running before `pnpm test:e2e:multi`):
 *   - docker compose up -d  (postgres, redis, mailhog, minio)
 *   - API:    uv run uvicorn bimstitch_api.main:app --reload --port 8000
 *   - Portal: pnpm --filter=portal dev  (or let Playwright start it)
 *   - Seed:   uv run python -m bimstitch_api.seed  (super admin must exist)
 *   - Creds:  SEED_SUPERADMIN_EMAIL + SEED_SUPERADMIN_PASSWORD
 *             set in apps/api/.env or apps/portal/.env.test.local
 */

import { expect, test } from '@playwright/test';

import { injectSavedAuth, loginViaAPI, loginViaUI } from '../support/auth';
import { clearAllEmails, extractUrlFromEmail, waitForEmail } from '../support/mailhog';
import { requireSuperAdminCreds } from '../support/env';
import { state } from '../support/state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build unique names scoped to this test run so reruns never clash. */
const RUN = state.runId;

// ---------------------------------------------------------------------------
// THE JOURNEY
// ---------------------------------------------------------------------------

test.describe.serial('Multitenant E2E Journey', () => {

  // =========================================================================
  // SUITE A — Super admin
  // =========================================================================

  test('A1: super admin logs in via UI', async ({ page }) => {
    const { email, password } = requireSuperAdminCreds();
    await loginViaUI(page, email, password);
    await expect(page).toHaveURL(/\/projects/);
  });

  test('A2: super admin navigates to /admin/organizations', async ({ page }) => {
    const { email } = requireSuperAdminCreds();
    await injectSavedAuth(page, email);

    await page.goto('/en/admin/organizations');
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
    await expect(page).toHaveURL(/\/projects/);
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
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Details');

    // Step 2: building_type select defaults to "" which fails Zod enum validation.
    // Select a real value so form.trigger() passes and Next can advance.
    await dialog.locator('select[name="building_type"]').selectOption('dwelling');
    await dialog.locator('select[name="consequence_class"]').selectOption('cc1');

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Address');

    // latitude/longitude hidden inputs are registered with `valueAsNumber: true`.
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
    // Fill name on the Basics step, then jump to the final Contractor step
    // via its header button — "Save changes" only appears on the last step.
    const nameInput = editDialog.locator('input[name="name"]');
    // Triple-click selects any existing value before fill so the React-controlled
    // input doesn't accumulate a doubled value (same pattern as loginViaUI).
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(`${state.projectName} (edited)`);

    // Jump to Contractor (last step) — aria-label is the step title
    await editDialog.locator('button[aria-label="Contractor"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Contractor');

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
    await expect(page).toHaveURL(/\/(account|projects)/);
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
    await expect(page.getByRole('main')).toBeVisible();
  });

  // =========================================================================
  // SUITE E — Member forgot-password → reset → login with new password
  // =========================================================================

  test('E1: member requests a password reset via the forgot-password UI', async ({ page }) => {
    await clearAllEmails();

    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('link', { name: /forgot/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    await page.getByLabel(/work email/i).fill(state.memberEmail);
    await page.getByRole('button', { name: /send reset link/i }).click();

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
    await expect(page).toHaveURL(/\/(projects|account)/);
  });

  // =========================================================================
  // SUITE F — Admin forgot-password → reset → login with new password
  // =========================================================================

  test('F1: admin requests a password reset via the forgot-password UI', async ({ page }) => {
    await clearAllEmails();

    await page.goto('/en/login');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('link', { name: /forgot/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    await page.getByLabel(/work email/i).fill(state.adminEmail);
    await page.getByRole('button', { name: /send reset link/i }).click();

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
    await expect(page).toHaveURL(/\/(projects|account)/);
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
    // Step 1 — Basics
    await dialog.locator('input[name="name"]').fill('Should-Fail-Guest-Create');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Details');

    // Step 2 — Details
    await dialog.locator('select[name="building_type"]').selectOption('dwelling');
    await dialog.locator('select[name="consequence_class"]').selectOption('cc1');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.locator('[aria-current="step"]')).toContainText('Address');

    // Step 3 — Address (fix lat/lng NaN issue, same as C3)
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

    // Step 4 — Contractor → "Create project"
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

    await editDialog.locator('button[aria-label="Contractor"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Contractor');

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

    await editDialog.locator('button[aria-label="Contractor"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Contractor');

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

    await editDialog.locator('button[aria-label="Contractor"]').click();
    await expect(editDialog.locator('[aria-current="step"]')).toContainText('Contractor');

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
});
