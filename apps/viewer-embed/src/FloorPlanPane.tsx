import { useMemo, type CSSProperties } from 'react';

// The pdfjs-FREE 2D entry: the same `DocumentViewer` + plugin ecosystem the web
// portal uses, but its bundle never pulls pdf.js (PDFs render from server
// page-images via `imageRasterSource`, not on-device pdf.js). Importing from the
// main barrel here would drag pdfjs into the react-native-webview payload.
import { DocumentViewer, imageRasterSource } from '@bimdossier/viewer/viewer-2d';
import type { DecodedFloorPlans } from '@bimdossier/viewer';

import type { FloorPlanLevelInfo } from './useFloorPlanData';

type Props = {
  /** Generated floor plan (IFC models). Mutually exclusive with `pdfPagesUrl`. */
  data?: DecodedFloorPlans;
  levels: FloorPlanLevelInfo[];
  roomNames: Map<number, string>;
  /** Controlled storey index into `levels` / `data.levels` (0 = lowest). */
  activeLevel: number;
  onLevelChange: (index: number) => void;
  /**
   * Server page-image manifest (PDF documents). Mutually exclusive with `data`;
   * rendered through `imageRasterSource` so no pdf.js ships in the bundle.
   */
  pdfPagesUrl?: string;
};

/**
 * The mobile 2D pane. Renders BOTH a generated floor plan (BIMFPLN2 `data`) and
 * an uploaded PDF (`pdfPagesUrl` → server page-images) through ONE
 * `DocumentViewer`, so the whole 2D plugin ecosystem (pan/zoom, measure, markup,
 * entity markers) is shared with the web viewer. The previous stub is gone.
 *
 * `currentPage` is 1-based: a floor plan maps storey level → page; a PDF maps
 * page index → page.
 */
export function FloorPlanPane({ data, levels, roomNames, activeLevel, pdfPagesUrl }: Props) {
  const isPdf = pdfPagesUrl !== undefined && data === undefined;
  const currentPage = useMemo(
    () => Math.max(1, Math.min(activeLevel + 1, isPdf ? Number.MAX_SAFE_INTEGER : levels.length || 1)),
    [activeLevel, isPdf, levels.length],
  );

  return (
    <div style={paneStyle}>
      {isPdf ? (
        <DocumentViewer
          fileUrl={pdfPagesUrl}
          rasterSource={imageRasterSource}
          currentPage={currentPage}
          navCompass={{ enabled: false }}
        />
      ) : data !== undefined ? (
        <DocumentViewer
          floorPlan={data}
          roomNames={roomNames}
          currentPage={currentPage}
        />
      ) : (
        <div style={messageStyle}>No 2D view available</div>
      )}
    </div>
  );
}

const paneStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#ffffff',
};

const messageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 14,
};
