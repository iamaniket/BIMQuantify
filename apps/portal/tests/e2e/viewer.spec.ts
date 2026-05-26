import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { expect, test, type Page } from '@playwright/test';

import { loginViaAPI } from '../support/auth';
import { E2E_ENV } from '../support/env';

// ── Credentials ────────────────────────────────────────────────────────

const ACME_ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? 'admin@acme.dev';
const ACME_ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? 'Admin123!';

// ── Small IFC fixture ──────────────────────────────────────────────────

const IFC_PATH = resolve(__dirname, '../../../samples/IfcSampleFiles-main/Ifc4_CubeAdvancedBrep.ifc');

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

test.describe.serial('Viewer', () => {
  let projectId: string;
  let modelId: string;
  let fileId: string;

  test('loads an IFC model in the 3D viewer', async ({ page }) => {
    // 1. Auth
    await loginViaAPI(page, ACME_ADMIN_EMAIL, ACME_ADMIN_PASSWORD);

    // 2. Create project
    const project = (await apiFetch(page, 'POST', '/projects', {
      name: `Viewer Test ${Date.now().toString(36)}`,
      country: 'NL',
    })) as { id: string };
    projectId = project.id;

    // 3. Create model
    const model = (await apiFetch(page, 'POST', `/projects/${projectId}/models`, {
      name: 'Architecture',
      discipline: 'architectural',
    })) as { id: string };
    modelId = model.id;

    // 4. Upload IFC file (two-phase)
    const fileBytes = readFileSync(IFC_PATH);
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');

    const initResp = (await apiFetch(
      page,
      'POST',
      `/projects/${projectId}/models/${modelId}/files/initiate`,
      {
        filename: 'Ifc4_CubeAdvancedBrep.ifc',
        size_bytes: fileBytes.length,
        content_type: 'application/octet-stream',
        content_sha256: sha256,
      },
    )) as { file_id: string; upload_url: string };
    fileId = initResp.file_id;

    // PUT directly to presigned URL (MinIO)
    const putResp = await page.request.put(initResp.upload_url, {
      data: fileBytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(putResp.ok(), `S3 PUT failed: ${putResp.status()}`).toBe(true);

    // Complete upload
    await apiFetch(
      page,
      'POST',
      `/projects/${projectId}/models/${modelId}/files/${fileId}/complete`,
    );

    // 5. Wait for extraction to finish (processor must be running)
    const deadline = Date.now() + 60_000;
    let extraction = 'not_started';
    while (Date.now() < deadline) {
      const files = (await apiFetch(
        page,
        'GET',
        `/projects/${projectId}/models/${modelId}/files?status=all`,
      )) as { extraction_status: string }[];
      const file = files.find((f: { extraction_status: string } & Record<string, unknown>) =>
        (f as Record<string, unknown>)['id'] === fileId,
      );
      extraction = file?.extraction_status ?? 'not_started';
      if (extraction === 'succeeded' || extraction === 'failed') break;
      await page.waitForTimeout(2_000);
    }
    expect(extraction, 'Extraction did not succeed within 60 s').toBe('succeeded');

    // 6. Navigate to viewer
    await page.goto(`/en/projects/${projectId}/models/${modelId}/viewer/${fileId}`);

    // 7. Assert viewer chrome is rendered
    await expect(page.getByTestId('viewer-toolbar')).toBeVisible({ timeout: 15_000 });

    // 8. Assert model progress bar appears then completes (viewer becomes ready)
    //    The toolbar has a "Home view" button that's only interactive once the
    //    viewer is fully loaded.
    await expect(
      page.getByRole('button', { name: 'Home view' }),
    ).toBeVisible({ timeout: 30_000 });

    // 9. Verify no error banner is shown
    await expect(page.getByRole('alert')).not.toBeVisible();
  });
});
