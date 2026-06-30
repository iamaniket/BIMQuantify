import { expect, test, type Page } from '@playwright/test';

import { loginViaAPI } from '../support/auth';
import {
  apiFetch,
  calibrateSheet,
  IFC_SAMPLES_DIR,
  PDF_SAMPLES_DIR,
  uploadDocumentFile,
  waitForExtraction,
} from '../support/viewerSetup';

const ADMIN_EMAIL = process.env['SEED_ACME_ADMIN_EMAIL'] ?? 'admin@acme.dev';
const ADMIN_PASSWORD = process.env['SEED_ACME_ADMIN_PASSWORD'] ?? 'Admin123!';

const ARCH_MODEL = 'Duplex Arch';
const STRUCT_MODEL = 'Duplex Struct';
const PDF_FILE = 'Beoordeling-meerbladig-isolatieglas-bij-oplevering.pdf';

/** Open the federated viewer (default scope = all models) and wait for ready. */
async function openViewer(page: Page, projectId: string): Promise<void> {
  await page.goto(`/en/projects/${projectId}/viewer`);
  await expect(page.getByTestId('viewer-toolbar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('viewer-tool-home')).toBeVisible({ timeout: 40_000 });
}

/**
 * Phases 1–3 of the federated drawing work, over ONE federated scene. Duplex.ifc
 * is uploaded twice (architectural + structural) so both models' storeys
 * reconcile onto the SAME project Levels — letting a structural sheet and an
 * architectural sheet sit on one Level, the crux of the picker.
 */
test.describe.serial('Federated drawings (Phases 1–3)', () => {
  let projectId: string;
  let archModelId = '';
  let structModelId = '';

  test('setup: two discipline models + cross-discipline calibrated sheets', async ({ page }) => {
    test.setTimeout(180_000);
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const project = (await apiFetch(page, 'POST', '/projects', {
      name: `Federated Drawings ${Date.now().toString(36)}`,
      country: 'NL',
    })) as { id: string };
    projectId = project.id;

    // Same IFC twice → identical storeys → shared reconciled Levels.
    const arch = await uploadDocumentFile(page, projectId, {
      name: ARCH_MODEL, discipline: 'architectural', uniqueTag: 'arch-ifc',
      dir: IFC_SAMPLES_DIR, file: 'Duplex.ifc', contentType: 'application/octet-stream',
    });
    const struct = await uploadDocumentFile(page, projectId, {
      name: STRUCT_MODEL, discipline: 'structural', uniqueTag: 'struct-ifc',
      dir: IFC_SAMPLES_DIR, file: 'Duplex.ifc', contentType: 'application/octet-stream',
    });
    archModelId = arch.documentId;
    structModelId = struct.documentId;

    await waitForExtraction(page, projectId, [
      { ...arch, name: ARCH_MODEL },
      { ...struct, name: STRUCT_MODEL },
    ]);

    // Two PDF drawings (one per discipline).
    const archPdf = await uploadDocumentFile(page, projectId, {
      name: 'Arch Plan PDF', discipline: 'architectural', uniqueTag: 'arch-pdf',
      dir: PDF_SAMPLES_DIR, file: PDF_FILE, contentType: 'application/pdf',
    });
    const structPdf = await uploadDocumentFile(page, projectId, {
      name: 'Struct Plan PDF', discipline: 'structural', uniqueTag: 'struct-pdf',
      dir: PDF_SAMPLES_DIR, file: PDF_FILE, contentType: 'application/pdf',
    });

    // Reconciled project Levels (shared by both models). Calibrate an arch sheet
    // (vs arch model) and a struct sheet (vs struct model) onto EVERY Level so the
    // picker is populated whatever the default active floor is.
    const levels = (await apiFetch(page, 'GET', `/projects/${projectId}/levels`)) as { id: string }[];
    expect(levels.length, 'IFC extraction should have created project Levels').toBeGreaterThan(0);
    for (const lvl of levels) {
      await calibrateSheet(page, projectId, {
        documentId: archModelId, levelId: lvl.id,
        pdfDocumentId: archPdf.documentId, pdfFileId: archPdf.fileId,
      });
      await calibrateSheet(page, projectId, {
        documentId: structModelId, levelId: lvl.id,
        pdfDocumentId: structPdf.documentId, pdfFileId: structPdf.fileId,
      });
    }

    // Both sheets land on each Level (cross-discipline) — the Phase 2 premise.
    const sheets = (await apiFetch(page, 'GET', `/projects/${projectId}/aligned-sheets`)) as {
      level_id: string; document_id: string; scale: number | null;
    }[];
    const onFirstLevel = sheets.filter((s) => s.level_id === levels[0]!.id && s.scale !== null);
    expect(onFirstLevel.some((s) => s.document_id === archModelId)).toBe(true);
    expect(onFirstLevel.some((s) => s.document_id === structModelId)).toBe(true);
  });

  test('Phase 1: the "calibrate against" model picker lists every loaded model', async ({ page }) => {
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openViewer(page, projectId);

    await page.getByTestId('viewer-tool-view-split').click();
    await page.getByRole('button', { name: 'Align' }).click();

    const modelPicker = page.getByTitle('Calibrate against this 3D model');
    await expect(modelPicker).toBeVisible({ timeout: 15_000 });
    await modelPicker.click();
    await expect(page.getByRole('menuitem', { name: ARCH_MODEL })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: STRUCT_MODEL })).toBeVisible();
  });

  test('Phase 2: the per-Level drawing-source picker offers Generated + each discipline', async ({ page }) => {
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openViewer(page, projectId);

    await page.getByTestId('viewer-tool-view-split').click();

    const sourcePicker = page.getByTitle('Drawing', { exact: true });
    await expect(sourcePicker).toBeVisible({ timeout: 15_000 });
    await sourcePicker.click();
    await expect(page.getByRole('menuitem', { name: 'Generated plan' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Architectural/ })).toBeVisible();
    const structItem = page.getByRole('menuitem', { name: /Structural/ });
    await expect(structItem).toBeVisible();

    // Selecting the structural sheet switches the active source.
    await structItem.click();
    await expect(page.getByTitle('Drawing', { exact: true })).toContainText(/Structural/);
  });

  test('Phase 3: isolating a Level drives cross-model isolation state', async ({ page }) => {
    await loginViaAPI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openViewer(page, projectId);

    await page.getByTestId('viewer-tool-view-split').click();

    // Isolation is ON by default in Split — the minimap reports isolated state
    // once the cross-model isolation command has run without error.
    const isolatedState = async (): Promise<boolean> =>
      page.evaluate(async () => {
        const v = (window as unknown as { __viewer?: { commands: { execute: (c: string) => Promise<unknown> } } }).__viewer;
        if (!v) return false;
        const s = (await v.commands.execute('minimap.getState')) as { isolated?: boolean };
        return Boolean(s?.isolated);
      });

    await expect.poll(isolatedState, { timeout: 15_000 }).toBe(true);

    // Toggle to "All levels" → isolation clears; back to "Isolate level" → re-applies.
    await page.getByRole('button', { name: 'All levels' }).click();
    await expect.poll(isolatedState, { timeout: 10_000 }).toBe(false);
    await page.getByRole('button', { name: 'Isolate level' }).click();
    await expect.poll(isolatedState, { timeout: 10_000 }).toBe(true);
  });
});
