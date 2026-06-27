import { describe, expect, it } from 'vitest';

import { httpUrlString } from '@/lib/api/schemas/url';
import { isHttpUrl } from '@/lib/url';

describe('isHttpUrl', () => {
  it.each([
    'https://minio.example.com/bucket/object?sig=abc',
    'http://localhost:9000/bucket/object',
    'https://example.com',
  ])('accepts http(s) URL %s', (url) => {
    expect(isHttpUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/uuid',
    'file:///etc/passwd',
    'vbscript:msgbox',
    'not a url',
    '',
    null,
    undefined,
  ])('rejects non-http(s) value %s', (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });
});

describe('httpUrlString schema', () => {
  it('parses a presigned http(s) URL', () => {
    const url = 'https://minio.example.com/bucket/file.pdf?X-Amz-Signature=abc';
    expect(httpUrlString.parse(url)).toBe(url);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])('rejects the XSS-capable URI %s at the validation boundary', (value) => {
    expect(httpUrlString.safeParse(value).success).toBe(false);
  });
});
