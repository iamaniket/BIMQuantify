import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/s3.js', () => ({
  // Returns PNG magic bytes — valid for the logo (any bytes), invalid as a PDF
  // (so the cover-merge path exercises graceful skip).
  downloadObjectWithHash: vi.fn(async () => ({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    sha256: 'deadbeef',
  })),
}));

import { embedTemplateLogo, mergeTemplateCover } from '../src/pipeline/report/templateAssets.js';
import type { ReportTemplate } from '../src/pipeline/report/templates/_helpers.js';

describe('embedTemplateLogo', () => {
  it('returns the payload unchanged when there is no logo key', async () => {
    const payload = { template: undefined };
    expect(await embedTemplateLogo(payload)).toBe(payload);
  });

  it('downloads the logo and sets a base64 data URL keyed by extension', async () => {
    const payload: { template: ReportTemplate } = {
      template: {
        branding: { logo_storage_key: 'report-templates/o/logo/x.png', bucket: 'attachments' },
      },
    };
    await embedTemplateLogo(payload);
    expect(payload.template.branding?.logo_data_url).toMatch(/^data:image\/png;base64,/);
  });
});

describe('mergeTemplateCover', () => {
  it('returns the input bytes unchanged when there is no cover key', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await mergeTemplateCover(bytes, { template: undefined })).toBe(bytes);
  });

  it('skips gracefully (returns input) when the cover object is not a valid PDF', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await mergeTemplateCover(bytes, {
      template: { branding: { cover_pdf_storage_key: 'report-templates/o/cover/c.pdf' } },
    });
    expect(out).toBe(bytes);
  });
});
