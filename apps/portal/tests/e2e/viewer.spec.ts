import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { expect, test, type Page } from '@playwright/test';

import { loginViaAPI } from '../support/auth';
import { E2E_ENV } from '../support/env';

// ── Credentials ────────────────────────────────────────────────────────

const ACME_ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? 'admin@acme.dev';
const ACME_ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? 'Admin123!';

// ── Models under test ──────────────────────────────────────────────────
// Two small IFC fixtures so both conversions stay fast. Driven by an array
// so adding a third model later is a one-line change.

const SAMPLES_DIR = resolve(__dirname, '../../../../assets/ifc');

const MODELS = [
  { name: 'Duplex', discipline: 'architectural', file: 'Duplex.ifc' },
  { name: 'OpenHouse 2x3', discipline: 'structural', file: 'IfcOpenHouse2x3.ifc' },
  { name: 'OpenHouse 4', discipline: 'mechanical', file: 'IfcOpenHouse4.ifc' },
] as const;

// ── API helper — runs fetch inside the browser (CORS-safe) ────────────

async function apiFetch(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const apiUrl = E2E_ENV.API_URL;
  return page.evaluate(
    async ([url, m, p, b]: [string, string, string, string | null]) => {
      const tokens = JSON.parse(localStorage.getItem('bimstitch.tokens')!);
      const resp = await fetch(`${url}${p}`, {
        method: m,
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          ...(b ? { 'Content-Type': 'application/json' } : {}),
        },
        body: b,
      });
      if (!resp.ok) {
        throw new Error(`API ${m} ${p} → ${resp.status}: ${await resp.text()}`);
      }
      return resp.json();
    },
    [apiUrl, method, path, body ? JSON.stringify(body) : null] as [string, string, string, string | null],
  );
}

// ── Test ────────────────────────────────────────────────────────────────

test.describe.serial('Model: IFC', () => {
  let projectId: string;
  const uploaded: { name: string; modelId: string; fileId: string }[] = [];

  test('creates two models, uploads an IFC to each, and converts them', async ({ page }) => {
    // 1. Auth
    await loginViaAPI(page, ACME_ADMIN_EMAIL, ACME_ADMIN_PASSWORD);

    // 2. Create one project to hold both models
    const project = (await apiFetch(page, 'POST', '/projects', {
      name: `Viewer IFC Test ${Date.now().toString(36)}`,
      country: 'NL',
    })) as { id: string };
    projectId = project.id;

    // 3. For each model: create it, then upload its IFC (two-phase)
    for (const spec of MODELS) {
      const model = (await apiFetch(page, 'POST', `/projects/${projectId}/models`, {
        name: spec.name,
        discipline: spec.discipline,
      })) as { id: string };
      const modelId = model.id;

      const fileBytes = readFileSync(resolve(SAMPLES_DIR, spec.file));
      const sha256 = createHash('sha256').update(fileBytes).digest('hex');

      const initResp = (await apiFetch(
        page,
        'POST',
        `/projects/${projectId}/models/${modelId}/files/initiate`,
        {
          filename: spec.file,
          size_bytes: fileBytes.length,
          content_type: 'application/octet-stream',
          content_sha256: sha256,
        },
      )) as { file_id: string; upload_url: string };
      const fileId = initResp.file_id;

      // PUT directly to presigned URL (MinIO)
      const putResp = await page.request.put(initResp.upload_url, {
        data: fileBytes,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      expect(putResp.ok(), `S3 PUT failed for ${spec.file}: ${putResp.status()}`).toBe(true);

      // Complete upload — dispatches the extraction job
      await apiFetch(
        page,
        'POST',
        `/projects/${projectId}/models/${modelId}/files/${fileId}/complete`,
      );

      uploaded.push({ name: spec.name, modelId, fileId });
    }

    // 4. Wait for both extractions to finish (processor must be running)
    const deadline = Date.now() + 90_000;
    const pending = new Map(uploaded.map((u) => [u.fileId, u]));
    while (pending.size > 0 && Date.now() < deadline) {
      for (const [fileId, info] of [...pending]) {
        const files = (await apiFetch(
          page,
          'GET',
          `/projects/${projectId}/models/${info.modelId}/files?status=all`,
        )) as ({ id: string; extraction_status: string })[];
        const file = files.find((f) => f.id === fileId);
        const status = file?.extraction_status ?? 'not_started';
        expect(status, `Extraction failed for ${info.name}`).not.toBe('failed');
        if (status === 'succeeded') pending.delete(fileId);
      }
      if (pending.size > 0) await page.waitForTimeout(2_000);
    }

    expect(
      pending.size,
      `Extraction did not succeed within 90 s for: ${[...pending.values()].map((u) => u.name).join(', ')}`,
    ).toBe(0);
  });

  test('loads each converted IFC model in the 3D viewer', async ({ page }) => {
    expect(uploaded.length, 'setup test did not produce any converted models').toBe(MODELS.length);

    // Re-auth this fresh page context, then open each model one by one.
    await loginViaAPI(page, ACME_ADMIN_EMAIL, ACME_ADMIN_PASSWORD);

    for (const { name, modelId, fileId } of uploaded) {
      await page.goto(`/en/projects/${projectId}/models/${modelId}/viewer/${fileId}`);

      // Viewer chrome renders once the bundle URL resolves.
      await expect(
        page.getByTestId('viewer-toolbar'),
        `viewer toolbar never appeared for ${name}`,
      ).toBeVisible({ timeout: 15_000 });

      // The toolbar "home" tool only renders after fragments finish loading
      // (viewerReady). Use the testid — `aria-label="Home view"` is shared with
      // the ViewCube's home facet, which would make a role lookup ambiguous.
      await expect(
        page.getByTestId('viewer-tool-home'),
        `model "${name}" did not finish loading in the viewer`,
      ).toBeVisible({ timeout: 30_000 });

      // No load error surfaced. Exclude Next's always-present empty route
      // announcer (`#__next-route-announcer__`, also role="alert") so this
      // targets only the viewer's error banner.
      await expect(
        page.locator('[role="alert"]:not(#__next-route-announcer__)'),
      ).toHaveCount(0);
    }
  });
});
