import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { expect, type Page } from '@playwright/test';

import { E2E_ENV } from './env';

export const IFC_SAMPLES_DIR = resolve(__dirname, '../../../../assets/ifc');
export const PDF_SAMPLES_DIR = resolve(__dirname, '../../../../assets/certificaat');

/** Browser-side authenticated fetch against the E2E API (CORS-safe). */
export async function apiFetch(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const apiUrl = E2E_ENV.API_URL;
  return page.evaluate(
    async ([url, m, p, b]: [string, string, string, string | null]) => {
      const tokens = JSON.parse(localStorage.getItem('bimdossier.tokens')!);
      const resp = await fetch(`${url}${p}`, {
        method: m,
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          ...(b ? { 'Content-Type': 'application/json' } : {}),
        },
        body: b,
      });
      if (!resp.ok) throw new Error(`API ${m} ${p} → ${resp.status}: ${await resp.text()}`);
      const text = await resp.text();
      return text ? JSON.parse(text) : null;
    },
    [apiUrl, method, path, body ? JSON.stringify(body) : null] as [string, string, string, string | null],
  );
}

/** Create a document and upload a file to it (two-phase). Returns ids. */
export async function uploadDocumentFile(
  page: Page,
  projectId: string,
  opts: {
    name: string; discipline: string; dir: string; file: string; contentType: string;
    /** Appended as a trailing comment so byte-identical fixtures dedupe distinctly
     * (the project rejects identical content). Ignored by web-ifc/pdfjs, which
     * stop at the file's end marker — geometry/pages parse unchanged. */
    uniqueTag?: string;
  },
): Promise<{ documentId: string; fileId: string }> {
  const document = (await apiFetch(page, 'POST', `/projects/${projectId}/documents`, {
    name: opts.name,
    discipline: opts.discipline,
  })) as { id: string };
  const documentId = document.id;

  let bytes = readFileSync(resolve(opts.dir, opts.file));
  if (opts.uniqueTag) {
    bytes = Buffer.concat([bytes, Buffer.from(`\n% bimdossier-e2e ${opts.uniqueTag}\n`, 'latin1')]);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const init = (await apiFetch(page, 'POST', `/projects/${projectId}/documents/${documentId}/files/initiate`, {
    filename: opts.file,
    size_bytes: bytes.length,
    content_type: opts.contentType,
    content_sha256: sha256,
  })) as { file_id: string; upload_url: string };

  const put = await page.request.put(init.upload_url, {
    data: bytes,
    headers: { 'Content-Type': opts.contentType },
  });
  expect(put.ok(), `S3 PUT failed for ${opts.file}: ${put.status()}`).toBe(true);

  await apiFetch(page, 'POST', `/projects/${projectId}/documents/${documentId}/files/${init.file_id}/complete`);
  return { documentId, fileId: init.file_id };
}

/** Poll until every given file's extraction has succeeded (processor must run). */
export async function waitForExtraction(
  page: Page,
  projectId: string,
  items: { documentId: string; fileId: string; name: string }[],
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Map(items.map((i) => [i.fileId, i]));
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [fileId, info] of [...pending]) {
      const files = (await apiFetch(
        page,
        'GET',
        `/projects/${projectId}/documents/${info.documentId}/files?status=all`,
      )) as { id: string; extraction_status: string }[];
      const status = files.find((f) => f.id === fileId)?.extraction_status ?? 'not_started';
      expect(status, `Extraction failed for ${info.name}`).not.toBe('failed');
      if (status === 'succeeded') pending.delete(fileId);
    }
    if (pending.size > 0) await page.waitForTimeout(2_000);
  }
  expect(
    pending.size,
    `Extraction did not finish for: ${[...pending.values()].map((i) => i.name).join(', ')}`,
  ).toBe(0);
}

/** Create + calibrate an aligned sheet via API (arbitrary but valid transform). */
export async function calibrateSheet(
  page: Page,
  projectId: string,
  opts: { documentId: string; levelId: string; pdfDocumentId: string; pdfFileId: string },
): Promise<void> {
  const sheet = (await apiFetch(page, 'POST', `/projects/${projectId}/aligned-sheets`, {
    document_id: opts.documentId,
    level_id: opts.levelId,
    pdf_document_id: opts.pdfDocumentId,
    page_index: 0,
  })) as { id: string };
  await apiFetch(page, 'POST', `/projects/${projectId}/aligned-sheets/${sheet.id}/calibrate`, {
    pdf_points: [[0.25, 0.25], [0.75, 0.75]],
    plan_points: [[0, 0], [5, 5]],
    pdf_file_id: opts.pdfFileId,
  });
}

/** Set the client-side viewer target (zustand-persist sessionStorage) before navigation. */
export async function setViewerTarget(page: Page, projectId: string, target: unknown): Promise<void> {
  await page.evaluate(
    ([pid, t]) => {
      window.sessionStorage.setItem(
        'bimdossier.viewerSelection',
        JSON.stringify({ state: { byProject: { [pid]: t } }, version: 0 }),
      );
    },
    [projectId, target] as [string, unknown],
  );
}
