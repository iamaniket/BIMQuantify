import { describe, expect, it } from 'vitest';

import {
  IMAGE_DATA_URL,
  safeImageDataUrl,
} from '../src/pipeline/report/templates/_helpers.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // not a real PNG, bytes are opaque here

describe('safeImageDataUrl (SEAM-XSS-SSRF-1)', () => {
  it('builds a data URL for an allow-listed image type', () => {
    const url = safeImageDataUrl('image/png', PNG_BYTES);
    expect(url).not.toBeNull();
    expect(url!.startsWith('data:image/png;base64,')).toBe(true);
    expect(IMAGE_DATA_URL.test(url!)).toBe(true);
  });

  it('canonicalizes image/jpg to image/jpeg', () => {
    expect(safeImageDataUrl('image/jpg', PNG_BYTES)!.startsWith('data:image/jpeg;base64,')).toBe(
      true,
    );
  });

  it('returns null for text/html (the stored-XSS vector)', () => {
    expect(safeImageDataUrl('text/html', PNG_BYTES)).toBeNull();
  });

  it('returns null for image/svg+xml (SVG can carry script)', () => {
    expect(safeImageDataUrl('image/svg+xml', PNG_BYTES)).toBeNull();
  });

  it('returns null for a content_type that tries to break out of the attribute', () => {
    expect(safeImageDataUrl('image/png"><script>alert(1)</script>', PNG_BYTES)).toBeNull();
  });

  it('returns null for an empty / missing content_type', () => {
    expect(safeImageDataUrl('', PNG_BYTES)).toBeNull();
    expect(safeImageDataUrl(null, PNG_BYTES)).toBeNull();
  });
});
