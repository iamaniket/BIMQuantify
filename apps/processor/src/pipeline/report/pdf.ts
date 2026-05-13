/**
 * HTML → PDF via Puppeteer + a tiny pdf-lib post-process to wipe the
 * Producer/CreationDate metadata so two renders of the same input produce
 * comparable output. Byte-identical reproducibility is NOT guaranteed
 * (Chromium versions differ; out of scope per plan §10), but this gets us
 * close enough for "regenerate" to look stable.
 */

import { PDFDocument } from 'pdf-lib';

import { getBrowser, noteRender } from './chromium.js';

export type PdfOptions = {
  /** ISO timestamp to embed in the PDF metadata (replaces Chromium's
   *  CreationDate so two renders share the same value). */
  generatedAt: string;
};

export async function htmlToPdf(html: string, opts: PdfOptions): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
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
          <span>BIMstitch</span>
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
    doc.setProducer('BIMstitch processor');
    doc.setCreator('BIMstitch processor');
    return await doc.save({ useObjectStreams: false });
  } finally {
    await page.close();
    await noteRender();
  }
}
