/**
 * Walk a parsed IFC model and emit:
 *   - Project header (GUID, name, length unit, schema)
 *   - Spatial tree (Project → Site → Building → Storey → Space)
 *   - Zones (IfcZone → IfcSpace membership via IfcRelAssignsToGroup)
 *   - Element counts grouped by IFC class
 *   - Axis-aligned bounding box (world coords)
 */

import {
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCPROJECT,
  IFCRELAGGREGATES,
  IFCRELASSIGNSTOGROUP,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCSITE,
  IFCSPACE,
  IFCZONE,
  type IfcAPI,
} from 'web-ifc';

import type { SupportedSchema } from '../config.js';
import type { Logger } from '../log.js';
import {
  attributesFromLine,
  numberValue,
  type PropertySet,
  stringValue,
} from './attributes.js';
import {
  type CanonicalElementType,
  IFC_ENTITY_TO_CANONICAL,
  IFC_UPPERCASE_TO_PASCAL,
} from './canonical.js';
import { readGetLine, Stopwatch } from './timing.js';

export type SpatialNode = {
  expressID: number;
  globalId: string | null;
  type: string;
  name: string | null;
  /** Storey elevation (model units) for IfcBuildingStorey nodes; null otherwise.
   * Drives the portal's level ordering/labels and the floor-plan cut height. */
  elevation: number | null;
  children: SpatialNode[];
};

/** A flat IfcBuildingStorey record sent to the API, which upserts it onto the
 * model's `storeys` table (keyed by globalId). Derived from the spatial tree. */
export type StoreyInfo = {
  expressID: number;
  globalId: string | null;
  name: string | null;
  elevation: number | null;
};

export type ElementEntry = {
  expressID: number;
  globalId: string | null;
  type: string;
  name: string | null;
  containedIn: number | null;
  // Scalar attributes read off this element's line during the metadata walk,
  // carried forward so buildProperties can seed without re-fetching the line.
  attributes?: PropertySet;
};

export type ZoneNode = {
  expressID: number;
  globalId: string | null;
  name: string | null;
  spaces: { expressID: number; name: string | null }[];
};

export type Metadata = {
  source_format: 'ifc';
  schema: SupportedSchema;
  project: {
    expressID: number;
    globalId: string | null;
    name: string | null;
    longName: string | null;
    lengthUnit: string | null;
  };
  spatialTree: SpatialNode | null;
  zones: ZoneNode[];
  elements: ElementEntry[];
  elementCounts: Record<string, number>;
  canonicalElementCounts: Record<CanonicalElementType, number>;
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
  logger?: Logger,
  // The extraction worker runs a single unified geometry sweep
  // (scanModelGeometry in floorplans.ts) that also yields the bbox, then injects
  // it — so it passes `true` here to skip this otherwise-redundant
  // StreamAllMeshes pass. Standalone callers (and tests) leave it false and get
  // the bbox computed inline via computeBoundingBox.
  skipBbox = false,
): Promise<Metadata> {
  // Per-sub-step timing + GetLine-crossing deltas. The walk is synchronous (no
  // awaits below), so reading the global counter before/after each call yields
  // that step's crossings even under JOB_CONCURRENCY > 1 — see timing.ts.
  const sw = new Stopwatch();
  const counts: number[] = [readGetLine()];
  const tick = (label: string): void => {
    sw.mark(label);
    counts.push(readGetLine());
  };

  const project = readProject(api, modelID);
  tick('project');
  const spatialTree = buildSpatialTree(api, modelID);
  tick('spatialTree');
  const zones = buildZones(api, modelID);
  tick('zones');
  const elements = collectElements(api, modelID);
  tick('collectElements');
  const elementCounts = countElements(api, modelID);
  tick('countElements');
  const canonicalElementCounts = buildCanonicalCounts(elementCounts);
  const bbox = skipBbox ? null : computeBoundingBox(api, modelID);
  tick('bbox');

  const labels = ['project', 'spatialTree', 'zones', 'collectElements', 'countElements', 'bbox'];
  const getLineCalls: Record<string, number> = {};
  for (let i = 0; i < labels.length; i += 1) {
    getLineCalls[labels[i] as string] = (counts[i + 1] ?? 0) - (counts[i] ?? 0);
  }
  getLineCalls['total'] = (counts[counts.length - 1] ?? 0) - (counts[0] ?? 0);
  logger?.info(
    { stage: 'metadata', timings: sw.timings(), getLineCalls, elements: elements.length },
    'metadata breakdown',
  );

  return {
    source_format: 'ifc',
    schema,
    project,
    spatialTree,
    zones,
    elements,
    elementCounts,
    canonicalElementCounts,
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

type AggregationMap = Map<number, { id: number; type: string }[]>;

function buildSpatialTree(api: IfcAPI, modelID: number): SpatialNode | null {
  const projectIds = api.GetLineIDsWithType(modelID, IFCPROJECT);
  if (projectIds.size() === 0) return null;

  const aggregations = buildAggregationMap(api, modelID);
  const projectID = projectIds.get(0);
  return readSpatialNode(api, modelID, projectID, 'IfcProject', aggregations);
}

// Forward IfcRelAggregates: RelatingObject (parent) → RelatedObjects (children).
// Read forward rather than via the inverse IsDecomposedBy attribute, which
// web-ifc only populates when GetLine is called with inverse=true.
function buildAggregationMap(api: IfcAPI, modelID: number): AggregationMap {
  const map: AggregationMap = new Map();
  const relIds = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
  for (let i = 0; i < relIds.size(); i += 1) {
    const rel = api.GetLine(modelID, relIds.get(i), true) as Record<
      string,
      unknown
    >;
    const relating = rel['RelatingObject'] as Record<string, unknown> | undefined;
    const parentID = relating ? numberValue(relating['expressID']) : null;
    if (parentID === null) continue;
    const related = rel['RelatedObjects'];
    if (!Array.isArray(related)) continue;
    for (const obj of related) {
      const child = obj as Record<string, unknown>;
      const childID = numberValue(child['expressID']);
      if (childID === null) continue;
      const childType = childIfcTypeName(api, modelID, childID);
      if (childType === null) continue;
      let arr = map.get(parentID);
      if (!arr) {
        arr = [];
        map.set(parentID, arr);
      }
      arr.push({ id: childID, type: childType });
    }
  }
  return map;
}

function readSpatialNode(
  api: IfcAPI,
  modelID: number,
  expressID: number,
  type: string,
  aggregations: AggregationMap,
): SpatialNode {
  const line = api.GetLine(modelID, expressID) as Record<string, unknown>;

  const children = (aggregations.get(expressID) ?? [])
    .filter(({ type: t }) => isSpatialType(t))
    .map(({ id, type: t }) => readSpatialNode(api, modelID, id, t, aggregations));

  return {
    expressID,
    globalId: stringValue(line['GlobalId']),
    type,
    name: stringValue(line['Name']),
    elevation: type === 'IfcBuildingStorey' ? numberValue(line['Elevation']) : null,
    children,
  };
}

function isSpatialType(type: string): boolean {
  return ['IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace'].includes(
    type,
  );
}

/**
 * Flatten every IfcBuildingStorey out of the spatial tree, in document order.
 * The API assigns display ordering by elevation on ingest. Pure over the tree
 * the metadata walk already built, so no extra web-ifc crossings.
 */
export function extractStoreys(tree: SpatialNode | null): StoreyInfo[] {
  if (tree === null) return [];
  const out: StoreyInfo[] = [];
  const walk = (node: SpatialNode): void => {
    if (node.type === 'IfcBuildingStorey') {
      out.push({
        expressID: node.expressID,
        globalId: node.globalId,
        name: node.name,
        elevation: node.elevation,
      });
    }
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return out;
}

// IfcZone groups IfcSpaces via IfcRelAssignsToGroup (RelatingGroup = the zone,
// RelatedObjects = the spaces). This is separate from the IfcRelAggregates
// spatial tree, so zones never appear in buildSpatialTree(). A single zone can
// be split across multiple relationship lines, so we merge by zone expressID.
function buildZones(api: IfcAPI, modelID: number): ZoneNode[] {
  const byZone = new Map<number, ZoneNode>();
  // Per-zone space-id set for O(1) dedup — a single zone can be split across
  // several IfcRelAssignsToGroup lines, so the same space can recur. Kept beside
  // ZoneNode (not on it) so the returned shape stays clean.
  const seenSpaces = new Map<number, Set<number>>();
  const relIds = api.GetLineIDsWithType(modelID, IFCRELASSIGNSTOGROUP);
  for (let i = 0; i < relIds.size(); i += 1) {
    // `flatten: false` — RelatingGroup/RelatedObjects come back as bare
    // handles (same pattern as collectElements). Flattening here recursively
    // expanded every member's geometry tree before we even knew the group was
    // a zone (4.7M GetLine calls on a 96MB model); the type gate below now
    // runs before any further GetLine.
    const rel = api.GetLine(modelID, relIds.get(i), false) as Record<
      string,
      unknown
    >;
    const zoneID = numberValue(rel['RelatingGroup']);
    if (zoneID === null) continue;
    if (api.GetLineType(modelID, zoneID) !== IFCZONE) continue;

    let zone = byZone.get(zoneID);
    if (!zone) {
      const zoneLine = api.GetLine(modelID, zoneID, false) as Record<string, unknown>;
      zone = {
        expressID: zoneID,
        globalId: stringValue(zoneLine['GlobalId']),
        name: stringValue(zoneLine['Name']),
        spaces: [],
      };
      byZone.set(zoneID, zone);
      seenSpaces.set(zoneID, new Set<number>());
    }
    const spaceSet = seenSpaces.get(zoneID)!;

    const related = rel['RelatedObjects'];
    if (!Array.isArray(related)) continue;
    for (const obj of related) {
      const spaceID = numberValue(obj);
      if (spaceID === null) continue;
      if (api.GetLineType(modelID, spaceID) !== IFCSPACE) continue;
      if (spaceSet.has(spaceID)) continue;
      spaceSet.add(spaceID);
      const spaceLine = api.GetLine(modelID, spaceID, false) as Record<string, unknown>;
      zone.spaces.push({
        expressID: spaceID,
        name: stringValue(spaceLine['Name']),
      });
    }
  }
  return [...byZone.values()];
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

function collectElements(api: IfcAPI, modelID: number): ElementEntry[] {
  const elements: ElementEntry[] = [];
  const relIds = api.GetLineIDsWithType(
    modelID,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
  );
  for (let i = 0; i < relIds.size(); i += 1) {
    // `flatten: false` — RelatedElements come back as bare handles instead of
    // recursively expanding every element's geometry tree. We read each
    // element's GlobalId/Name with a cheap scalar GetLine(id, false) below.
    const rel = api.GetLine(modelID, relIds.get(i), false) as Record<
      string,
      unknown
    >;
    const containedIn = numberValue(rel['RelatingStructure']);
    const related = rel['RelatedElements'];
    if (!Array.isArray(related)) continue;
    for (const obj of related) {
      const expressID = numberValue(obj);
      if (expressID === null) continue;
      const code = api.GetLineType(modelID, expressID);
      const rawName = (
        api as unknown as {
          GetNameFromTypeCode?: (c: number) => string;
        }
      ).GetNameFromTypeCode?.(code);
      const type =
        (typeof rawName === 'string'
          ? IFC_UPPERCASE_TO_PASCAL.get(rawName)
          : undefined) ?? rawName ?? 'Unknown';
      const line = api.GetLine(modelID, expressID, false) as Record<
        string,
        unknown
      >;
      elements.push({
        expressID,
        globalId: stringValue(line['GlobalId']),
        type,
        name: stringValue(line['Name']),
        containedIn,
        // Captured from the line we already hold so buildProperties' seed loop
        // doesn't re-fetch every element (one GetLine-per-element pass saved).
        attributes: attributesFromLine(line),
      });
    }
  }

  // Some elements only exist as decomposed parts via IfcRelAggregates, never
  // in IfcRelContainedInSpatialStructure (e.g. IfcSpace decomposed from a
  // storey, IfcStairFlight from a stair, IfcMember/IfcPlate from a curtain
  // wall). Walk aggregation relationships and collect any element that wasn't
  // already gathered via containment, excluding spatial container types that
  // form the tree hierarchy (Project/Site/Building/Storey).
  const SPATIAL_CONTAINERS = new Set([IFCPROJECT, IFCSITE, IFCBUILDING, IFCBUILDINGSTOREY]);
  const seen = new Set(elements.map((e) => e.expressID));
  const aggIds = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
  for (let i = 0; i < aggIds.size(); i += 1) {
    // `flatten: false` — RelatedObjects are bare handles; we resolve each
    // child's GlobalId/Name with a scalar GetLine(id, false) rather than
    // flattening its geometry here only to read two strings.
    const rel = api.GetLine(modelID, aggIds.get(i), false) as Record<
      string,
      unknown
    >;
    const containedIn = numberValue(rel['RelatingObject']);
    const related = rel['RelatedObjects'];
    if (!Array.isArray(related)) continue;
    for (const obj of related) {
      const childID = numberValue(obj);
      if (childID === null || seen.has(childID)) continue;
      const code = api.GetLineType(modelID, childID);
      if (SPATIAL_CONTAINERS.has(code)) continue;
      const rawName = (
        api as unknown as {
          GetNameFromTypeCode?: (c: number) => string;
        }
      ).GetNameFromTypeCode?.(code);
      if (typeof rawName !== 'string') continue;
      const type = IFC_UPPERCASE_TO_PASCAL.get(rawName) ?? rawName;
      const line = api.GetLine(modelID, childID, false) as Record<
        string,
        unknown
      >;
      seen.add(childID);
      elements.push({
        expressID: childID,
        globalId: stringValue(line['GlobalId']),
        type,
        name: stringValue(line['Name']),
        containedIn,
        attributes: attributesFromLine(line),
      });
    }
  }

  return elements;
}

// Count elements per known IFC type. `includeInherited` defaults to false on
// GetLineIDsWithType, so this counts exact-type instances — identical buckets
// to the old per-line GetLineType counting.
//
// Fast path: GetAllTypesOfModel tells us which types the model *actually*
// contains, so we probe GetLineIDsWithType only for the (canonical-mapped) ones
// present — a typical model carries ~10-15 of our ~28 known types, so the rest
// were previously pointless WASM crossings. Fallback (older web-ifc builds, or
// when enumeration throws): probe every known type by name, as before. Both
// paths yield identical buckets.
function countElements(api: IfcAPI, modelID: number): Record<string, number> {
  const counts: Record<string, number> = {};

  const addCount = (pascal: string, code: number): void => {
    if (!Number.isInteger(code) || code <= 0) return;
    const n = api.GetLineIDsWithType(modelID, code).size();
    if (n > 0) counts[pascal] = (counts[pascal] ?? 0) + n;
  };

  const getAllTypes = (
    api as unknown as { GetAllTypesOfModel?: (m: number) => { typeID: number; typeName: string }[] }
  ).GetAllTypesOfModel?.bind(api);
  if (getAllTypes !== undefined) {
    try {
      for (const { typeID, typeName } of getAllTypes(modelID)) {
        const pascal =
          typeof typeName === 'string'
            ? IFC_UPPERCASE_TO_PASCAL.get(typeName.toUpperCase())
            : undefined;
        if (pascal !== undefined) addCount(pascal, typeID);
      }
      return counts;
    } catch {
      // Enumeration unsupported/failed — fall through to the name-probe path.
    }
  }

  // GetTypeCodeFromName is accessed defensively (mirrors the existing cautious
  // GetNameFromTypeCode access); if a build lacks it we return empty counts
  // rather than crash.
  const getTypeCode = (
    api as unknown as { GetTypeCodeFromName?: (name: string) => number }
  ).GetTypeCodeFromName?.bind(api);
  if (getTypeCode === undefined) return counts;

  for (const [upper, pascal] of IFC_UPPERCASE_TO_PASCAL) {
    let code: number;
    try {
      code = getTypeCode(upper);
    } catch {
      continue; // name not recognised by this web-ifc build/schema
    }
    addCount(pascal, code);
  }
  return counts;
}

function buildCanonicalCounts(
  ifcCounts: Record<string, number>,
): Record<CanonicalElementType, number> {
  const out = {} as Record<CanonicalElementType, number>;
  for (const [ifcType, count] of Object.entries(ifcCounts)) {
    const canonical = IFC_ENTITY_TO_CANONICAL[ifcType];
    if (canonical != null) {
      out[canonical] = (out[canonical] ?? 0) + count;
    }
  }
  return out;
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
