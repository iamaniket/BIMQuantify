import type { DocumentWithVersions } from '@/lib/api/schemas';

/**
 * Resolve a document's head ProjectFile id: the explicit restore pointer
 * (`head_file_id`, set by F7), else the newest `ready` version. Null when the
 * document has no ready file yet. Shared by the calibration pane and the
 * persona-A drawing browser.
 */
export function headFileId(doc: DocumentWithVersions): string | null {
  if (doc.head_file_id) return doc.head_file_id;
  const ready = doc.versions
    .filter((v) => v.status === 'ready')
    .sort((a, b) => b.version_number - a.version_number);
  return ready[0]?.id ?? null;
}
