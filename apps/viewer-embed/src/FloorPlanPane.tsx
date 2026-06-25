import type { CSSProperties } from 'react';

import type { DecodedFloorPlans } from '@bimdossier/viewer';

import type { FloorPlanLevelInfo } from './useFloorPlanData';

type Props = {
  data: DecodedFloorPlans;
  levels: FloorPlanLevelInfo[];
  roomNames: Map<number, string>;
  /** Controlled storey index into `levels` / `data.levels` (0 = lowest). */
  activeLevel: number;
  onLevelChange: (index: number) => void;
};

/**
 * The 2D floor-plan pane is temporarily STUBBED. The standalone pdfjs-free
 * `FloorPlanViewer` it used to render was removed from `@bimdossier/viewer` —
 * the web now has a single `DocumentViewer`, and a dedicated native/mobile 2D
 * viewer will be rebuilt separately. Until then this pane renders a placeholder
 * so the embed stays pdfjs-free and builds, and 3D keeps working. The prop shape
 * is unchanged so `App.tsx` and the host bridge are unaffected.
 */
export function FloorPlanPane(_props: Props) {
  return (
    <div style={paneStyle}>
      <div style={messageStyle}>2D plan view is being rebuilt</div>
    </div>
  );
}

const paneStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const messageStyle: CSSProperties = {
  color: '#6b7280',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 14,
  padding: 16,
  textAlign: 'center',
};
