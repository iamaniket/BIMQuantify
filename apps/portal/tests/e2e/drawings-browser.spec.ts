import { expect, test } from '@playwright/test';

import { loginViaAPI } from '../support/auth';
import { apiFetch, PDF_SAMPLES_DIR, setViewerTarget, uploadDocumentFile } from '../support/viewerSetup';

const ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? 'admin@acme.dev';
const ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? 'Admin123!';
const PDF_FILE = 'Beoordeling-meerbladig-isolatieglas-bij-oplevering.pdf';

/**
 * Phase 4 — Persona A: a PDF-only project (no IFC model) gets a by-Level drawing
 * browser. Two manual Levels; Level 2 holds two discipline drawings, Level 1 one.
 */
test.describe.serial('Persona A — by-Level drawing browser (Phase 4)', () => {
  let projectId: string;

  test('setup: PDF-only project, manual levels, drawings filed per Level', async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const project = (await apiFetch(page, 'POST', '/projects', {
      name: `Drawings Only ${Date.now().toString(36)}`,
      country: 'NL',
    })) as { id: string };
    projectId = project.id;

    const l1 = (await apiFetch(page, 'POST', `/projects/${projectId}/levels`, {
      name: 'Level 1', elevation_m: 0,
    })) as { id: string };
    const l2 = (await apiFetch(page, 'POST', `/projects/${projectId}/levels`, {
      name: 'Level 2', elevation_m: 3,
    })) as { id: string };

    const upload = async (name: string, discipline: string, levelId: string, tag: string): Promise<void> => {
      const { documentId } = await uploadDocumentFile(page, projectId, {
        name, discipline, uniqueTag: tag,
        dir: PDF_SAMPLES_DIR, file: PDF_FILE, contentType: 'application/pdf',
      });
      await apiFetch(page, 'PATCH', `/projects/${projectId}/documents/${documentId}`, { level_id: levelId });
    };
    await upload('Arch L2', 'architectural', l2.id, 'arch-l2');
    await upload('Struct L2', 'structural', l2.id, 'struct-l2');
    await upload('Plan L1', 'architectural', l1.id, 'plan-l1');
  });

  test('browses drawings by Level, with a per-Level discipline picker', async ({ page }) => {
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await setViewerTarget(page, projectId, { kind: 'drawings' });
    await page.goto(`/en/projects/${projectId}/viewer`);

    // Defaults to the top Level (Level 2), which holds two drawings.
    const levelPicker = page.getByTitle('Level', { exact: true });
    await expect(levelPicker).toBeVisible({ timeout: 20_000 });
    await expect(levelPicker).toContainText('Level 2');

    // Drawing picker present (2 drawings on Level 2) — lists both disciplines.
    const drawingPicker = page.getByTitle('Drawing', { exact: true });
    await expect(drawingPicker).toBeVisible();
    await drawingPicker.click();
    await expect(page.getByRole('menuitem', { name: /Architectural/ })).toBeVisible();
    const structItem = page.getByRole('menuitem', { name: /Structural/ });
    await expect(structItem).toBeVisible();
    await structItem.click();
    await expect(page.getByTitle('Drawing', { exact: true })).toContainText(/Structural/);

    // The PDF renders (DocumentViewer canvas).
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 });

    // Switch to Level 1 (one drawing) — the drawing picker collapses to a label.
    await levelPicker.click();
    await page.getByRole('menuitem', { name: 'Level 1' }).click();
    await expect(page.getByTitle('Level', { exact: true })).toContainText('Level 1');
    await expect(page.getByTitle('Drawing', { exact: true })).toHaveCount(0);
  });
});
