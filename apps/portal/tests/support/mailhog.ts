import { E2E_ENV } from './env';

const BASE = E2E_ENV.MAILHOG_URL; // http://localhost:8025

type MailhogMessage = {
  ID: string;
  Content: {
    Headers: Record<string, string[]>;
    Body: string;
  };
  Raw: { To: string[] };
};

type MailhogListResponse = {
  items: MailhogMessage[];
  total: number;
};

export async function clearAllEmails(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`MailHog DELETE failed: ${res.status}`);
}

/**
 * Poll MailHog until an email to `toAddress` arrives.
 * Returns the decoded (human-readable) message body.
 */
export async function waitForEmail(
  toAddress: string,
  { timeoutMs = 30_000, intervalMs = 1_500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const needle = toAddress.toLowerCase();

  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/v2/messages`);
    if (res.ok) {
      const data: MailhogListResponse = await res.json();
      const match = data.items.find((msg) =>
        msg.Raw.To.some((addr) => addr.toLowerCase().includes(needle)),
      );
      if (match !== undefined) {
        return decodeMessageBody(match);
      }
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for email to ${toAddress}`);
}

/**
 * Extract the first URL from a decoded email body that matches `pattern`.
 * Checks href attributes first, then bare URLs.
 */
export function extractUrlFromEmail(body: string, pattern: RegExp): string {
  // 1. Try href attributes (HTML email)
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(body)) !== null) {
    const url = m[1]!.replace(/&amp;/g, '&');
    if (pattern.test(url)) return url;
  }

  // 2. Bare URL in text
  const urlRe = /https?:\/\/[^\s"'<>]+/g;
  while ((m = urlRe.exec(body)) !== null) {
    if (pattern.test(m[0])) return m[0];
  }

  throw new Error(`No URL matching ${pattern.toString()} found in email body`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Decode a MailHog message body, handling quoted-printable and base64
 * Content-Transfer-Encoding so the returned string is plain readable text/HTML.
 */
function decodeMessageBody(msg: MailhogMessage): string {
  const headers = msg.Content.Headers;
  // Header names can be any casing
  const enc = getHeader(headers, 'Content-Transfer-Encoding').toLowerCase().trim();

  if (enc === 'base64') {
    try {
      return Buffer.from(msg.Content.Body.replace(/[\r\n\s]+/g, ''), 'base64').toString('utf-8');
    } catch {
      return msg.Content.Body;
    }
  }

  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(msg.Content.Body);
  }

  // 7bit / 8bit / no encoding declared — return as-is
  return msg.Content.Body;
}

function decodeQuotedPrintable(body: string): string {
  return body
    .replace(/=\r?\n/g, '')                                        // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function getHeader(headers: Record<string, string[]>, name: string): string {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key]?.[0] ?? '';
    }
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
