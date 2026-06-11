export type SpatialNode = {
  expressID: number;
  globalId: string | null;
  type: string;
  name: string | null;
  /** Storey elevation (model units) for IfcBuildingStorey nodes; null/absent otherwise. */
  elevation?: number | null;
  children: SpatialNode[];
};

export type ElementEntry = {
  expressID: number;
  globalId: string | null;
  type: string;
  name: string | null;
  containedIn: number | null;
};

export type ZoneNode = {
  expressID: number;
  globalId: string | null;
  name: string | null;
  spaces: { expressID: number; name: string | null }[];
};

export type ModelMetadata = {
  source_format: 'ifc';
  schema: string;
  project: {
    expressID: number;
    globalId: string | null;
    name: string | null;
    longName: string | null;
    lengthUnit: string | null;
  };
  spatialTree: SpatialNode | null;
  zones?: ZoneNode[];
  elements?: ElementEntry[];
  elementCounts: Record<string, number>;
  canonicalElementCounts: Record<string, number>;
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  totalElements: number;
};

export type PropertyValue = string | number | boolean | null;
export type PropertySet = Record<string, PropertyValue>;
export type ElementProperties = Record<string, PropertySet>;
export type ModelProperties = Record<string, ElementProperties>;
