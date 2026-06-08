export type EntityMarkerType = 'finding' | 'certificate' | 'attachment';

export interface EntityMarker2D {
  id: string;
  type: EntityMarkerType;
  x: number;
  y: number;
  label: string;
  entityId: string;
}

export interface EntityMarker3D {
  id: string;
  type: EntityMarkerType;
  position: { x: number; y: number; z: number };
  label: string;
  entityId: string;
}
