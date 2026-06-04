import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Importing the production module runs its top-level pdfjs worker configuration.
// If pdf.ts ever sets `GlobalWorkerOptions.workerSrc = ''` again, the import below
// clobbers pdfjs's Node default and getDocument throws
// `Setting up fake worker failed: "No "GlobalWorkerOptions.workerSrc" specified."`.
// This test fails loudly in that case. (Safe to import: config.ts is fully
// defaulted + lazy, callback.ts has no import-time side effects, and queue.js is
// pulled in only as `import type`, so no Redis/network/env is touched.)
import '../src/pipeline/pdf.js';

describe('pdf.ts pdfjs worker setup', () => {
  it('leaves the pdfjs worker usable so getDocument works in Node', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const bytes = await pdf.save();

    const doc = await getDocument({ data: bytes }).promise; // throws on regression
    try {
      expect(doc.numPages).toBe(1);
    } finally {
      await doc.destroy();
    }
  });
});
