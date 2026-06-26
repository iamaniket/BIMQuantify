/**
 * URL-safety helpers for presigned artifact URLs (reports, attachments,
 * certificates). Presigned URLs are issued by our own backend, but validating
 * the protocol is defence-in-depth: a compromised API or a MITM could inject a
 * `javascript:` / `data:` URI that would execute when fed into an `<iframe src>`
 * or `window.open` sink. These helpers gate both sinks to `http(s)` only.
 */

/** Narrows a value to a non-empty `http(s)` URL string. Rejects `javascript:`, `data:`, blobs, etc. */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Opens a presigned URL in a new tab, hardened against reverse-tabnabbing
 * (`noopener,noreferrer`). No-op for non-`http(s)` URLs so a poisoned value can
 * never reach `window.open`.
 */
export function openExternalUrl(value: string | null | undefined): void {
  if (!isHttpUrl(value)) return;
  window.open(value, '_blank', 'noopener,noreferrer');
}
