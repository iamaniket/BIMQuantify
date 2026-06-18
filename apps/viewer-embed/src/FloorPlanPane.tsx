import type { CSSProperties } from 'react';

// Runtime value from the no-pdfjs entry; types are erased (free from barrel).
import { FloorPlanViewer } from '@bimstitch/viewer/viewer-3d';
import type { DecodedFloorPlans } from '@bimstitch/viewer';

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
 * The 2D floor-plan pane: the world-space `FloorPlanViewer` filling the pane,
 * with a minimal top-centre level picker. Plain inline styles — the embed has
 * no Tailwind/design tokens. The plugin's DEFAULT_COLORS (dark walls on a light
 * ground) are fine here, so no `colors` prop is passed. No 2D↔3D linking — this
 * is a standalone plan, by design.
 */
export function FloorPlanPane({ data, levels, roomNames, activeLevel, onLevelChange }: Props) {
  const safeLevel = Math.min(Math.max(activeLevel, 0), Math.max(0, levels.length - 1));

  return (
    <div style={paneStyle}>
      <FloorPlanViewer
        data={data}
        roomNames={roomNames}
        activeLevel={safeLevel}
        className="viewer-pane-fill"
      />
      {levels.length > 1 ? (
        <div style={pickerWrapStyle}>
          <select
            value={safeLevel}
            onChange={(e) => {
              onLevelChange(Number(e.target.value));
            }}
            style={selectStyle}
            aria-label="Floor level"
          >
            {levels.map((lv, i) => (
              <option key={lv.storeyExpressID} value={i}>
                {lv.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

const paneStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#ffffff',
};

const pickerWrapStyle: CSSProperties = {
  position: 'absolute',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 20,
};

const selectStyle: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  maxWidth: 200,
  padding: '7px 28px 7px 12px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background:
    "#ffffff url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3e%3cpath fill='none' stroke='%236b7280' stroke-width='1.5' d='M2.5 4.5L6 8l3.5-3.5'/%3e%3c/svg%3e\") no-repeat right 10px center",
  color: '#111827',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 13,
  fontWeight: 600,
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
};
