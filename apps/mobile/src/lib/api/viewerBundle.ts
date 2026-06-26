import { apiClient } from '@/lib/api/client';
import {
  ViewerBundleResponseSchema,
  type ViewerBundleResponse,
} from '@/lib/api/schemas/files';

// GET /projects/{id}/documents/{documentId}/files/{fileId}/viewer-bundle —
// presigned artifact URLs for one IFC file. The native side fetches this and
// hands the camelCase bundle (below) to the embedded viewer over the WebView
// bridge; the WebView never holds a token.
export async function getViewerBundle(
  accessToken: string,
  projectId: string,
  documentId: string,
  fileId: string,
): Promise<ViewerBundleResponse> {
  return apiClient.get<ViewerBundleResponse>(
    `/projects/${projectId}/documents/${documentId}/files/${fileId}/viewer-bundle`,
    ViewerBundleResponseSchema,
    accessToken,
  );
}

/**
 * The camelCase shape the embedded viewer's `IfcViewer` consumes (mirrors
 * `@bimdossier/viewer`'s `ViewerBundle`). Defined locally — mobile doesn't depend
 * on the viewer package; the bridge ships this as plain JSON.
 */
export type EmbedViewerBundle = {
  fragmentsUrl: string;
  modelId: string;
  metadataUrl?: string;
  propertiesUrl?: string;
  outlineUrl?: string;
  cacheKey?: string;
  /** Floor-plan artifact for the embed's 2D / Split views (absent when none). */
  floorPlansUrl?: string;
};

/**
 * Stable viewer scene id for a file. MUST match the portal's `federatedModelId`
 * (`file-<fileId>`) so finding anchors authored in the portal and the app
 * re-base onto the same model in the viewer.
 */
export function federatedModelId(fileId: string): string {
  return `file-${fileId}`;
}

/**
 * snake_case bundle response → the camelCase `EmbedViewerBundle`. Mirrors the
 * portal's `singlePrimaryBundle`. Returns null for a non-IFC file (no fragments).
 */
export function toViewerBundle(
  resp: ViewerBundleResponse,
  fileId: string,
): EmbedViewerBundle | null {
  if (resp.fragments_url === null) return null;
  const out: EmbedViewerBundle = {
    fragmentsUrl: resp.fragments_url,
    modelId: federatedModelId(fileId),
  };
  if (resp.metadata_url !== null) out.metadataUrl = resp.metadata_url;
  if (resp.properties_url !== null) out.propertiesUrl = resp.properties_url;
  if (resp.outline_url !== null) out.outlineUrl = resp.outline_url;
  if (resp.fragments_key !== null) out.cacheKey = resp.fragments_key;
  if (resp.floor_plans_url !== null) out.floorPlansUrl = resp.floor_plans_url;
  return out;
}

/**
 * Page-image manifest URL for a PDF DOCUMENT (no fragments), or null. The viewer
 * screen sends a `loadPdf` (2D-only) when this is present, instead of the IFC
 * `loadModel`. The embed renders it pdfjs-free via `imageRasterSource`.
 */
export function pdfPagesUrlFor(resp: ViewerBundleResponse): string | null {
  if (resp.file_type !== 'pdf') return null;
  return resp.pdf_pages_url ?? null;
}
