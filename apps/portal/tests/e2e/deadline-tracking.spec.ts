/**
 * Deadline tracking — end-to-end, including real email delivery.
 *
 * Validates the four product claims against the running stack (API + portal +
 * processor → MailHog):
 *  1. Deadlines are auto-derived from a project's start/handover dates on create.
 *  4. Changing a date recomputes the linked deadline.
 *  2. Reminder emails fire (incl. the T-30 tier — a deadline ~27 days out only
 *     produces an email because T-30 was added; the old max tier was 14).
 *     Plus the missed-deadline alert path.
 *  3. The org-level Calendar route aggregates deadlines across projects.
 *
 * Email delivery requires the processor running with SMTP pointed at MailHog
 * (docker-compose `SMTP_HOST=host.docker.internal`) and the E2E API carrying
 * PROCESSOR_URL + PROCESSOR_SHARED_SECRET (set in global-setup). The sweep runs
 * on a 1-minute interval in E2E (DEADLINE_SWEEP_INTERVAL_MINUTES=1), so the
 * email tests allow up to ~100s for the next sweep + delivery.
 */

import { expect, test } from '@playwright/test';

import { getCachedAccessToken, loginViaAPI } from '../support/auth';
import { E2E_ENV } from '../support/env';
import { clearAllEmails, waitForEmail } from '../support/mailhog';

const API = E2E_ENV.API_URL;
const ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? '';
const ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? '';

const runId = Date.now().toString(36);
let token = '';

/** `YYYY-MM-DD` local date, `days` from today. */
function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function apiGet(path: string): Promise<Response> {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function createProject(body: Record<string, unknown>): Promise<{ id: string; name: string }> {
  const r = await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(r.status, await r.clone().text()).toBe(201);
  return r.json() as Promise<{ id: string; name: string }>;
}

type DeadlineRow = { deadline_type: string; due_date: string | null; status: string };

async function listDeadlines(projectId: string): Promise<DeadlineRow[]> {
  const r = await apiGet(`/projects/${projectId}/deadlines`);
  expect(r.ok).toBeTruthy();
  return r.json() as Promise<DeadlineRow[]>;
}

test.describe.serial('Deadline tracking + email delivery', () => {
  test.beforeAll(async ({ browser }) => {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error('Missing SEED_ACME_ADMIN_EMAIL / SEED_ACME_ADMIN_PASSWORD');
    }
    const health = await fetch(`${API}/health`);
    expect(health.ok, 'E2E API must be reachable').toBeTruthy();

    const page = await browser.newPage();
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.close();
    const cached = getCachedAccessToken(ADMIN_EMAIL);
    if (cached === undefined) throw new Error('login did not cache a token');
    token = cached;
  });

  test('deadlines auto-derive from dates and recompute on date change', async () => {
    // Claim 1: creating a project with both dates seeds the NL deadlines.
    const project = await createProject({
      name: `E2E Cal Derive ${runId}`,
      planned_start_date: isoDateOffset(60),
      delivery_date: isoDateOffset(200),
    });

    const before = await listDeadlines(project.id);
    expect(before).toHaveLength(3);
    const cn = before.find((d) => d.deadline_type === 'construction_notification');
    expect(cn?.due_date).toBeTruthy();

    // Claim 4: moving the start date recomputes the linked deadline.
    const patch = await fetch(`${API}/projects/${project.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_start_date: isoDateOffset(90) }),
    });
    expect(patch.ok).toBeTruthy();

    const after = await listDeadlines(project.id);
    const cn2 = after.find((d) => d.deadline_type === 'construction_notification');
    expect(cn2?.due_date).toBeTruthy();
    expect(cn2?.due_date).not.toBe(cn?.due_date);
  });

  test('T-30 reminder email is delivered for a deadline ~27 days out', async () => {
    test.setTimeout(150_000);
    await clearAllEmails();

    // construction_notification due = start − 28 days → start today+55 ⇒ due ~today+27,
    // which only fires a reminder because the T-30 tier exists (old max was 14).
    const project = await createProject({
      name: `E2E Cal T30 ${runId}`,
      planned_start_date: isoDateOffset(55),
    });

    const body = await waitForEmail(ADMIN_EMAIL, { timeoutMs: 110_000, intervalMs: 3_000 });
    expect(body).toContain(project.name);
    expect(body.toLowerCase()).toMatch(/bouwmelding|construction notification/);
  });

  test('missed-deadline alert is delivered for a past-due deadline', async () => {
    test.setTimeout(150_000);
    await clearAllEmails();

    // start in the past ⇒ construction_notification due ~today−29 (overdue) → missed alert.
    const project = await createProject({
      name: `E2E Cal Missed ${runId}`,
      planned_start_date: isoDateOffset(-1),
    });

    const body = await waitForEmail(ADMIN_EMAIL, { timeoutMs: 110_000, intervalMs: 3_000 });
    expect(body).toContain(project.name);
  });

  test('org Calendar route aggregates deadlines across projects', async ({ page }) => {
    // Claim 3: a single calendar across all projects.
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/en/calendar');

    // Both tabs of the shell render.
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /calendar/i })).toBeVisible();

    // The Overview surfaces the cross-project deadlines created above. EN locale
    // → the label renders as "Construction notification".
    await expect(
      page.getByText(/Construction notification/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The Calendar tab mounts the month grid (weekday header).
    await page.getByRole('tab', { name: /^calendar$/i }).click();
    await expect(page.getByText(/^Mon$/).first()).toBeVisible({ timeout: 15_000 });
  });
});
