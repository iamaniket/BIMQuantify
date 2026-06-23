import type { Annotation2D } from '@bimstitch/annotation';

import type { Attachment } from '@/lib/api/schemas';

/** The vectors stored on an attachment's `annotation_state` (empty when none / malformed). */
export function readAnnotations(attachment: Attachment): Annotation2D[] {
  const state = attachment.annotation_state;
  if (state === null || typeof state !== 'object') return [];
  const list = (state as { annotations?: unknown }).annotations;
  return Array.isArray(list) ? (list as Annotation2D[]) : [];
}

/**
 * The attachment version the markup should burn from — the original (un-annotated)
 * image. Annotated versions carry `sourceVersionId`; everything else is its own source.
 */
export function readSourceVersionId(attachment: Attachment): string {
  const state = attachment.annotation_state;
  if (state !== null && typeof state === 'object') {
    const src = (state as { sourceVersionId?: unknown }).sourceVersionId;
    if (typeof src === 'string' && src !== '') return src;
  }
  return attachment.id;
}
