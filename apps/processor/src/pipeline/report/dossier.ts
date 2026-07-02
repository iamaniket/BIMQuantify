/**
 * Orchestrator for `dossier_report` jobs (Dossier bevoegd gezag, #33).
 *
 * Two binary steps wrap the shared `runReportJob`:
 *   - prepare:     download each finding photo from MinIO → embed as a base64
 *                  data URL so the HTML render can show it.
 *   - postProcess: merge the signed verklaring PDF + every PDF certificate onto
 *                  the end of the rendered dossier via pdf-lib.
 * Both degrade gracefully — a missing/unreadable object is logged and skipped
 * rather than failing the whole dossier.
 */

import { z } from 'zod';

import { logger } from '../../log.js';
import type { ProgressReporter, WorkerJob } from '../../queue/queue.js';
import { downloadObject } from '../../storage/s3.js';
import { runReportJob } from './index.js';
import { reportProjectSchema, reportTemplateSchema, safeImageDataUrl } from './templates/_helpers.js';
import { renderHtml, type DossierData } from './templates/dossier.js';
import { embedTemplateLogo, mergeTemplateCover } from './templateAssets.js';

const PHOTO = z.object({
  storage_key: z.string(),
  content_type: z.string(),
  data_url: z.string().optional(),
});

const PayloadSchema: z.ZodType<DossierData & { storage_key: string }> = z
  .object({
    report_id: z.string().uuid(),
    storage_key: z.string().min(1),
    generated_at: z.string().min(1),
    locale: z.string().min(1),
    project: reportProjectSchema,
    assurance_plan: z
      .object({
        version_number: z.number(),
        status: z.string(),
        created_by: z.string().nullable().optional(),
        moments: z.array(
          z.object({
            phase: z.string(),
            name: z.string(),
            planned_date: z.string(),
            actual_date: z.string().nullable().optional(),
            responsible: z.string().nullable().optional(),
            status: z.string(),
            checklist_items: z.array(z.unknown()),
          }),
        ),
      })
      .nullable(),
    risks: z.array(
      z.object({
        category: z.string(),
        level: z.string(),
        description: z.string(),
        mitigation: z.string(),
        responsible_party: z.string().nullable().optional(),
        bbl_article_ref: z.string().nullable().optional(),
      }),
    ),
    findings: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        severity: z.string(),
        status: z.string(),
        deadline_date: z.string().nullable().optional(),
        bbl_article_ref: z.string().nullable().optional(),
        resolution_note: z.string().nullable().optional(),
        linked_element_global_id: z.string().nullable().optional(),
        linked_document_id: z.string().nullable().optional(),
        linked_file_type: z.string().nullable().optional(),
        anchor_page: z.number().nullable().optional(),
        anchor_x: z.number().nullable().optional(),
        anchor_y: z.number().nullable().optional(),
        anchor_z: z.number().nullable().optional(),
        photos: z.array(PHOTO),
      }),
    ),
    certificates: z.array(
      z.object({
        certificate_type: z.string(),
        certificate_number: z.string().nullable().optional(),
        issuer: z.string().nullable().optional(),
        subject: z.string().nullable().optional(),
        valid_from: z.string().nullable().optional(),
        valid_until: z.string().nullable().optional(),
        filename: z.string(),
        content_type: z.string(),
        storage_key: z.string(),
      }),
    ),
    verklaring: z
      .object({
        storage_key: z.string(),
        content_type: z.string(),
        signature_hash: z.string().nullable().optional(),
      })
      .nullable(),
    template: reportTemplateSchema,
  })
  .passthrough() as unknown as z.ZodType<DossierData & { storage_key: string }>;

type DossierPayload = DossierData & { storage_key: string };

/** Download each finding photo and embed it as a base64 data URL. */
async function prepare(payload: DossierPayload): Promise<DossierPayload> {
  for (const finding of payload.findings) {
    for (const photo of finding.photos) {
      try {
        const bytes = await downloadObject(photo.storage_key);
        // SEAM-XSS-SSRF-1: MIME from a server-side image allowlist, not the
        // caller-supplied content_type; a non-image yields null → no <img>.
        const dataUrl = safeImageDataUrl(photo.content_type, bytes);
        if (dataUrl) photo.data_url = dataUrl;
      } catch (err) {
        logger.warn({ err, key: photo.storage_key }, 'dossier: photo download failed, skipping');
      }
    }
  }
  // Embed the template logo (if any) after the finding photos.
  await embedTemplateLogo(payload);
  return payload;
}

/** Append the signed verklaring + every PDF certificate to the rendered dossier. */
async function postProcess(pdfBytes: Uint8Array, payload: DossierPayload): Promise<Uint8Array> {
  const keys: string[] = [];
  if (payload.verklaring && payload.verklaring.content_type === 'application/pdf') {
    keys.push(payload.verklaring.storage_key);
  }
  for (const cert of payload.certificates) {
    if (cert.content_type === 'application/pdf') keys.push(cert.storage_key);
  }
  let bytes = pdfBytes;
  if (keys.length > 0) {
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.load(pdfBytes);
    for (const key of keys) {
      try {
        const objBytes = await downloadObject(key);
        const src = await PDFDocument.load(objBytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const page of pages) merged.addPage(page);
      } catch (err) {
        logger.warn({ err, key }, 'dossier: PDF merge failed for object, skipping');
      }
    }
    bytes = await merged.save({ useObjectStreams: false });
  }
  // Prepend the template cover/letterhead (if any) so it lands first.
  return mergeTemplateCover(bytes, payload);
}

export async function runDossierReport(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  return runReportJob(job, { payloadSchema: PayloadSchema, prepare, renderHtml, postProcess }, onProgress);
}
