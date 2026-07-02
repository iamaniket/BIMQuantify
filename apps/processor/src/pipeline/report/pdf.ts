/**
 * HTML → PDF via Puppeteer + a tiny pdf-lib post-process to wipe the
 * Producer/CreationDate metadata so two renders of the same input produce
 * comparable output. Byte-identical reproducibility is NOT guaranteed
 * (Chromium versions differ; out of scope per plan §10), but this gets us
 * close enough for "regenerate" to look stable.
 */

import { PDFDocument } from 'pdf-lib';

import { getConfig } from '../../config.js';
import { RetriableError } from '../errors.js';
import { getBrowser, noteRender } from './chromium.js';

export type PdfOptions = {
  /** ISO timestamp to embed in the PDF metadata (replaces Chromium's
   *  CreationDate so two renders share the same value). */
  generatedAt: string;
};

export async function htmlToPdf(html: string, opts: PdfOptions): Promise<Uint8Array> {
  const { JOB_TIMEOUT_MS } = getConfig();
  const browser = await getBrowser();
  const page = await browser.newPage();
  // Coordinate the render with the BullMQ lock exactly as extraction does (see
  // worker-host.ts): the worker's lockDuration is JOB_TIMEOUT_MS + 30s, so the
  // whole render must abort by JOB_TIMEOUT_MS or a wedged page — a `networkidle0`
  // that never settles, or a hung `page.pdf()` (which has no built-in timeout) —
  // would run until BullMQ reclaims the job as stalled. `setDefaultTimeout` binds
  // setContent to the same budget; the outer race below also bounds `page.pdf()`.
  page.setDefaultTimeout(JOB_TIMEOUT_MS);

  // Render-context hardening (SEAM-XSS-SSRF-1). Report templates are fully
  // self-contained HTML (inline CSS, base64 data-URL images) — no scripts, no
  // remote resources. So:
  //  - disable JavaScript: even if a template regresses and injects a <script>,
  //    it cannot execute in the render context.
  //  - deny-by-default network: allow only inline `data:` URLs and the initial
  //    about:blank/document load; abort everything else so an injected remote
  //    <img>/<iframe>/CSS/font can't reach internal services (SSRF).
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) {
      void req.continue();
    } else {
      void req.abort().catch(() => undefined);
    }
  });

  let deadlineTimer: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(new RetriableError(`report render timed out after ${JOB_TIMEOUT_MS}ms`, 'timeout'));
    }, JOB_TIMEOUT_MS);
  });

  const render = (async (): Promise<Uint8Array> => {
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      margin: { top: '22mm', bottom: '24mm', left: '18mm', right: '18mm' },
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-size:8pt;color:#6b7280;width:100%;
                    padding:0 18mm;display:flex;justify-content:space-between;">
          <span>BimDossier</span>
          <span class="pageNumber"></span>/<span class="totalPages"></span>
        </div>`,
    });

    // Metadata wipe — see file header.
    const doc = await PDFDocument.load(raw);
    const at = new Date(opts.generatedAt);
    if (!Number.isNaN(at.getTime())) {
      doc.setCreationDate(at);
      doc.setModificationDate(at);
    }
    doc.setProducer('BimDossier processor');
    doc.setCreator('BimDossier processor');
    return await doc.save({ useObjectStreams: false });
  })();
  // If the deadline wins, the page is closed in `finally`, which rejects the
  // in-flight render later; swallow that so it can't surface as an unhandled
  // rejection after the race has already settled.
  render.catch(() => undefined);

  try {
    return await Promise.race([render, deadline]);
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    await page.close().catch(() => undefined);
    await noteRender();
  }
}
