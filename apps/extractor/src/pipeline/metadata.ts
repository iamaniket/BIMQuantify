/**
 * Walk a parsed IFC model and emit:
 *   - Project header (GUID, name, length unit, schema)
 *   - Spatial tree (Project → Site → Building → Storey → Space)
 *   - Element counts grouped by IFC class
 *   - Axis-aligned bounding box (world coords)
 */

import {
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCPROJECT,
  IFCSITE,
  IFCSPACE,
  type IfcAPI,
} from 'web-ifc';

import type { SupportedSchema } from '../config.js';

export type SpatialNode = {
  expressID: number;
  globalId: string | null;
  type: string;
  name: string | null;
  children: SpatialNode[];
};

export type Metadata = {
  schema: SupportedSchema;
  project: {
    expressID: number;
    globalId: string | null;
    name: string | null;
    longName: string | null;
    lengthUnit: string | null;
  };
  spatialTree: SpatialNode | null;
  elementCounts: Record<string, number>;
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
  totalElements: number;
};

export async function buildMetadata(
  api: IfcAPI,
  modelID: number,
  schema: SupportedSchema,
): Promise<Metadata> {
  const project = readProject(api, modelID);
  const spatialTree = buildSpatialTree(api, modelID);
  const elementCounts = countElements(api, modelID);
  const bbox = computeBoundingBox(api, modelID);

  return {
    schema,
    project,
    spatialTree,
    elementCounts,
    bbox,
    totalElements: Object.values(elementCounts).reduce((a, b) => a + b, 0),
  };
}

function readProject(api: IfcAPI, modelID: number): Metadata['project'] {
  const projectIds = api.GetLineIDsWithType(modelID, IFCPROJECT);
  if (projectIds.size() === 0) {
    return {
      expressID: 0,
      globalId: null,
      name: null,
      longName: null,
      lengthUnit: null,
    };
  }
  const expressID = projectIds.get(0);
  const project = api.GetLine(modelID, expressID, true) as Record<string, unknown>;
  return {
    expressID,
    globalId: stringValue(project['GlobalId']),
    name: stringValue(project['Name']),
    longName: stringValue(project['LongName']),
    lengthUnit: extractLengthUnit(project),
  };
}

function buildSpatialTree(api: IfcAPI, modelID: number): SpatialNode | null {
  const projectIds = api.GetLineIDsWithType(modelID, IFCPROJECT);
  if (projectIds.size() === 0) return null;

  const projectID = projectIds.get(0);
  return readSpatialNode(api, modelID, projectID, 'IfcProject');
}

function readSpatialNode(
  api: IfcAPI,
  modelID: number,
  expressID: number,
  type: string,
): SpatialNode {
  const line = api.GetLine(modelID, expressID, true) as Record<string, unknown>;

  const childrenIDs: { id: number; type: string }[] = [];
  // IsDecomposedBy → IfcRelAggregates → RelatedObjects
  const decomposedBy = line['IsDecomposedBy'];
  if (Array.isArray(decomposedBy)) {
    for (const rel of decomposedBy) {
      const related = (rel as Record<string, unknown>)['RelatedObjects'];
      if (!Array.isArray(related)) continue;
      for (const obj of related) {
        const child = obj as Record<string, unknown>;
        const childID = numberValue(child['expressID']);
        if (childID === null) continue;
        const childType = childIfcTypeName(api, modelID, childID);
        if (childType === null) continue;
        childrenIDs.push({ id: childID, type: childType });
      }
    }
  }

  // ContainsElements → IfcRelContainedInSpatialStructure (skipped — those are
  // physical elements, captured by counts instead of in the tree).

  const children = childrenIDs
    .filter(({ type: t }) => isSpatialType(t))
    .map(({ id, type: t }) => readSpatialNode(api, modelID, id, t));

  return {
    expressID,
    globalId: stringValue(line['GlobalId']),
    type,
    name: stringValue(line['Name']),
    children,
  };
}

function isSpatialType(type: string): boolean {
  return ['IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace'].includes(
    type,
  );
}

function childIfcTypeName(
  api: IfcAPI,
  modelID: number,
  expressID: number,
): string | null {
  const code = api.GetLineType(modelID, expressID);
  switch (code) {
    case IFCSITE:
      return 'IfcSite';
    case IFCBUILDING:
      return 'IfcBuilding';
    case IFCBUILDINGSTOREY:
      return 'IfcBuildingStorey';
    case IFCSPACE:
      return 'IfcSpace';
    default:
      return null;
  }
}

function countElements(api: IfcAPI, modelID: number): Record<string, number> {
  const counts: Record<string, number> = {};
  // GetAllLines returns every entity in the file. We only care about
  // IfcProduct subclasses ("real" elements). web-ifc doesn't ship a fast
  // "isProduct" check, so we walk the type names returned by GetNameFromTypeCode.
  const allIDs = api.GetAllLines(modelID);
  for (let i = 0; i < allIDs.size(); i += 1) {
    const id = allIDs.get(i);
    const code = api.GetLineType(modelID, id);
    const name = (api as unknown as {
      GetNameFromTypeCode?: (c: number) => string;
    }).GetNameFromTypeCode?.(code);
    if (typeof name !== 'string' || !name.startsWith('IFC')) continue;
    const normalised = `Ifc${name.slice(3).toLowerCase().replace(/^./, (c) => c.toUpperCase())}`;
    if (!isProductLike(normalised)) continue;
    counts[normalised] = (counts[normalised] ?? 0) + 1;
  }
  return counts;
}

function isProductLike(name: string): boolean {
  // Whitelist of common IFC product subclasses. Not exhaustive — the goal is
  // a useful summary, not a perfect inventory.
  return [
    'IfcWall',
    'IfcWallStandardCase',
    'IfcSlab',
    'IfcRoof',
    'IfcColumn',
    'IfcBeam',
    'IfcDoor',
    'IfcWindow',
    'IfcStair',
    'IfcRailing',
    'IfcCovering',
    'IfcSpace',
    'IfcFurnishingElement',
    'IfcBuildingElementProxy',
    'IfcDuctSegment',
    'IfcPipeSegment',
    'IfcFlowFitting',
    'IfcFlowTerminal',
    'IfcMember',
    'IfcPlate',
  ].includes(name);
}

function computeBoundingBox(
  api: IfcAPI,
  modelID: number,
): Metadata['bbox'] {
  // web-ifc exposes per-mesh geometry via StreamAllMeshes. We compute an
  // axis-aligned bbox by sweeping vertex coordinates.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  let touched = false;
  api.StreamAllMeshes(modelID, (mesh) => {
    const placements = mesh.geometries;
    for (let g = 0; g < placements.size(); g += 1) {
      const placedGeom = placements.get(g);
      const geom = api.GetGeometry(modelID, placedGeom.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const matrix = placedGeom.flatTransformation;
      for (let v = 0; v < verts.length; v += 6) {
        const px = verts[v] ?? 0;
        const py = verts[v + 1] ?? 0;
        const pz = verts[v + 2] ?? 0;
        const wx =
          (matrix[0] ?? 0) * px
          + (matrix[4] ?? 0) * py
          + (matrix[8] ?? 0) * pz
          + (matrix[12] ?? 0);
        const wy =
          (matrix[1] ?? 0) * px
          + (matrix[5] ?? 0) * py
          + (matrix[9] ?? 0) * pz
          + (matrix[13] ?? 0);
        const wz =
          (matrix[2] ?? 0) * px
          + (matrix[6] ?? 0) * py
          + (matrix[10] ?? 0) * pz
          + (matrix[14] ?? 0);
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wz < minZ) minZ = wz;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
        if (wz > maxZ) maxZ = wz;
        touched = true;
      }
    }
  });

  if (!touched) return null;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function extractLengthUnit(project: Record<string, unknown>): string | null {
  const unitsInContext = project['UnitsInContext'] as
    | Record<string, unknown>
    | undefined;
  if (!unitsInContext) return null;
  const units = unitsInContext['Units'];
  if (!Array.isArray(units)) return null;
  for (const u of units) {
    const unit = u as Record<string, unknown>;
    if (unit['UnitType']?.toString().toUpperCase().includes('LENGTH')) {
      const prefix = unit['Prefix'];
      const name = unit['Name'];
      const prefixStr = stringValue(prefix);
      const nameStr = stringValue(name);
      if (nameStr === null) return null;
      return prefixStr === null ? nameStr : `${prefixStr}${nameStr}`;
    }
  }
  return null;
}

function stringValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'string' ? inner : null;
  }
  return null;
}

function numberValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'number' ? inner : null;
  }
  return null;
}
