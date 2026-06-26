import {
  getViewerBundle,
  pdfPagesUrlFor,
  toViewerBundle,
  type EmbedViewerBundle,
} from '@/lib/api/viewerBundle';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

/**
 * Fetches a file's viewer bundle and maps it to the camelCase `EmbedViewerBundle`
 * the WebView consumes. Resolves to null for a non-IFC file (no fragments).
 */
export function useViewerBundle(projectId: string, documentId: string, fileId: string) {
  return useAuthQuery<EmbedViewerBundle | null>(
    ['viewer', 'bundle', projectId, documentId, fileId],
    async (token) =>
      toViewerBundle(await getViewerBundle(token, projectId, documentId, fileId), fileId),
    {
      enabled: projectId.length > 0 && documentId.length > 0 && fileId.length > 0,
    },
  );
}

/**
 * Page-image manifest URL for a PDF DOCUMENT (null for IFC files / PDFs not yet
 * rasterized). Separate from `useViewerBundle` so the (verified) IFC path is
 * untouched: the viewer screen sends a 2D-only `loadPdf` when this resolves.
 */
export function usePdfPagesUrl(projectId: string, documentId: string, fileId: string) {
  return useAuthQuery<string | null>(
    ['viewer', 'pdf-pages', projectId, documentId, fileId],
    async (token) => pdfPagesUrlFor(await getViewerBundle(token, projectId, documentId, fileId)),
    {
      enabled: projectId.length > 0 && documentId.length > 0 && fileId.length > 0,
    },
  );
}
