/**
 * Shared template-asset steps for the report orchestrators.
 *
 *  - embedTemplateLogo:  download the org template's logo from the attachments
 *                        bucket and embed it as a base64 data URL so `layout`
 *                        can render the brand band.
 *  - mergeTemplateCover: prepend the template's uploaded cover/letterhead PDF to
 *                        the rendered report via pdf-lib (cover lands first).
 *
 * Both degrade gracefully — a missing/unreadable asset is logged and skipped
 * rather than failing the report. Template assets live in the bucket the API
 * names in `branding.bucket` (the attachments bucket), NOT the default IFC
 * bucket — hence `downloadObjectWithHash(key, bucket)`.
 *
 * v1 merges the cover as the first page(s). Letterhead-on-every-page is future work.
 */

import { logger } from '../../log.js';
import { downloadObjectWithHash } from '../../storage/s3.js';
import type { ReportTemplate } from './templates/_helpers.js';

type WithTemplate = { template?: ReportTemplate | null };

function logoContentType(key: string): string {
  const k = key.toLowerCase();
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

/** Download `branding.logo_storage_key` → set `branding.logo_data_url`. */
export async function embedTemplateLogo<T extends WithTemplate>(payload: T): Promise<T> {
  const branding = payload.template?.branding;
  if (!branding?.logo_storage_key) return payload;
  try {
    const { bytes } = await downloadObjectWithHash(
      branding.logo_storage_key,
      branding.bucket ?? undefined,
    );
    branding.logo_data_url = `data:${logoContentType(branding.logo_storage_key)};base64,${Buffer.from(
      bytes,
    ).toString('base64')}`;
  } catch (err) {
    logger.warn(
      { err, key: branding.logo_storage_key },
      'template: logo download failed, skipping',
    );
  }
  return payload;
}

/** Prepend `branding.cover_pdf_storage_key` to the rendered report (cover first). */
export async function mergeTemplateCover<T extends WithTemplate>(
  pdfBytes: Uint8Array,
  payload: T,
): Promise<Uint8Array> {
  const branding = payload.template?.branding;
  if (!branding?.cover_pdf_storage_key) return pdfBytes;
  try {
    const { bytes } = await downloadObjectWithHash(
      branding.cover_pdf_storage_key,
      branding.bucket ?? undefined,
    );
    const { PDFDocument } = await import('pdf-lib');
    // Load the cover as the BASE document, then copy the rendered report's pages
    // into it — so the cover/letterhead lands first.
    const coverDoc = await PDFDocument.load(bytes);
    const rendered = await PDFDocument.load(pdfBytes);
    const pages = await coverDoc.copyPages(rendered, rendered.getPageIndices());
    for (const page of pages) coverDoc.addPage(page);
    return await coverDoc.save({ useObjectStreams: false });
  } catch (err) {
    logger.warn(
      { err, key: branding.cover_pdf_storage_key },
      'template: cover merge failed, skipping',
    );
    return pdfBytes;
  }
}
