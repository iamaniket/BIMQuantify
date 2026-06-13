import type { FindingStatusValue } from '@/lib/api/schemas';

export type EntityMarkerType = 'finding' | 'certificate' | 'attachment';

export interface EntityMarker2D {
  id: string;
  type: EntityMarkerType;
  x: number;
  y: number;
  label: string;
  entityId: string;
  /** Finding lifecycle status — drives the marker color. */
  status?: FindingStatusValue;
}

export interface EntityMarker3D {
  id: string;
  type: EntityMarkerType;
  position: { x: number; y: number; z: number };
  /** Viewer scene id of the model this anchor belongs to (`file-<fileId>`). */
  modelId: string;
  label: string;
  entityId: string;
  /** Finding lifecycle status — drives the marker color. */
  status?: FindingStatusValue;
  /** Render dimmed (not associated with the isolated object). */
  dimmed?: boolean;
}
