'use client';

import { forwardRef, type ForwardedRef, type JSX } from 'react';

import { DocumentViewer as DocumentViewerCore } from './DocumentViewer.js';
import type { DocumentViewerHandle, DocumentViewerProps } from './DocumentViewer.js';
import { pdfjsRasterSource } from './pdf-core/PdfjsRasterSource.js';

/**
 * The PDF-capable `DocumentViewer` exported from the main barrel. It injects
 * `pdfjsRasterSource` (and thus pdf.js) as the default raster source, so portal
 * consumers keep full PDF rendering + text/search with NO code changes.
 *
 * The bare `DocumentViewer` core (exported from the pdfjs-free `./viewer-2d`
 * entry) has no pdfjs default — that is what keeps the mobile embed bundle free
 * of pdf.js. This wrapper is the ONLY thing in the main barrel that pulls pdfjs
 * in via `PdfjsRasterSource`.
 */
function PdfDocumentViewer(
  props: DocumentViewerProps,
  ref: ForwardedRef<DocumentViewerHandle>,
): JSX.Element {
  // Spread first so an explicit `rasterSource` (or its absence) never clobbers
  // the pdfjs default below.
  return (
    <DocumentViewerCore
      {...props}
      ref={ref}
      rasterSource={props.rasterSource ?? pdfjsRasterSource}
    />
  );
}

export const DocumentViewer = forwardRef<DocumentViewerHandle, DocumentViewerProps>(
  PdfDocumentViewer,
);
DocumentViewer.displayName = 'DocumentViewer';
