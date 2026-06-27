import { z } from 'zod';

import { isHttpUrl } from '@/lib/url';

/**
 * Presigned URL field constrained to the `http(s)` protocol. `z.string().url()`
 * alone accepts `javascript:`/`data:` (the URL constructor parses them), so the
 * refine is what actually blocks those from entering the app — rejecting a
 * poisoned `download_url`/`view_url` at the validation boundary, before it can
 * reach an `<iframe src>` or `window.open` sink.
 */
export const httpUrlString = z
  .string()
  .url()
  .refine(isHttpUrl, { message: 'must be an http(s) URL' });
