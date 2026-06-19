/**
 * Failure classification shared across all pipelines.
 *
 * A failed job is either *retriable* (a fresh attempt could plausibly
 * succeed — network blip, S3 hiccup, OOM, timeout) or *permanent* (the input
 * is bad and re-running changes nothing — parse error, unsupported schema,
 * hash mismatch). The API stores `retriable` + `error_kind` on the Job and
 * gates the portal's Retry affordance on it.
 *
 * Pipelines may throw `PermanentError` / `RetriableError` explicitly to carry
 * an exact classification; anything else is funnelled through `classifyError`,
 * which sniffs known error types and message patterns and defaults **unknown →
 * retriable** (the safe default — a stuck-but-recoverable job is better than a
 * permanently-dead one).
 */

export type Classification = {
  retriable: boolean;
  error_kind: string;
};

export class PermanentError extends Error {
  constructor(
    message: string,
    public readonly kind: string = 'permanent',
  ) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class RetriableError extends Error {
  constructor(
    message: string,
    public readonly kind: string = 'transient',
  ) {
    super(message);
    this.name = 'RetriableError';
  }
}

// Substrings (matched case-insensitively against the error name + message)
// that mark a *permanent* failure — re-running will not help.
const PERMANENT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/unsupported[_\s]?schema/i, 'unsupported_schema'],
  [/invalid[_\s]?\w*[_\s]?payload/i, 'payload'],
  // Matches the real NoIfcInZipError message (NO_IFC_ENTRY_IN_ZIP) as well as
  // the shorter NO_IFC_IN_ZIP form — the `[_\w\s]*?` spans the optional ENTRY
  // token, which the old fixed `in` pattern silently missed (→ misclassified
  // retriable).
  [/no[_\s]?ifc[_\w\s]*?zip/i, 'parse'],
  [/parse|malformed|corrupt|invalid/i, 'parse'],
  [/validation/i, 'validation'],
  [/hash[_\s]?mismatch|sha256/i, 'hash_mismatch'],
  [/not[_\s]?found|404/i, 'not_found'],
];

// Substrings that mark a *retriable* failure — a transient/infra condition.
const RETRIABLE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/econnrefused|econnreset|enotfound|etimedout|socket/i, 'network'],
  [/timeout|timed out/i, 'timeout'],
  [/fetch failed|network/i, 'network'],
  [/s3|minio|storage|getobject|putobject/i, 's3'],
  [/out of memory|heap|enomem|oom/i, 'oom'],
  [/5\d\d/, 'upstream'],
];

export function classifyError(err: unknown): Classification {
  if (err instanceof PermanentError) {
    return { retriable: false, error_kind: err.kind };
  }
  if (err instanceof RetriableError) {
    return { retriable: true, error_kind: err.kind };
  }

  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  const haystack = `${name} ${message}`;

  for (const [pattern, kind] of PERMANENT_PATTERNS) {
    if (pattern.test(haystack)) return { retriable: false, error_kind: kind };
  }
  for (const [pattern, kind] of RETRIABLE_PATTERNS) {
    if (pattern.test(haystack)) return { retriable: true, error_kind: kind };
  }

  // Unknown — default to retriable so a recoverable job is never stranded.
  return { retriable: true, error_kind: 'unknown' };
}
