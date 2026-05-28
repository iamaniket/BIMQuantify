/**
 * Extract per-element canonical properties for the compliance engine.
 *
 * Walks IfcRelDefinesByProperties and translates raw (psetName, propName)
 * pairs into the canonical "domain.property" shape that the rule engine
 * (apps/arbiter) operates on. Each element also carries
 * `_element_type` (canonical type string) so rules can filter by element.
 *
 * Output shape per element:
 *   {
 *     _element_type: "door",
 *     fire_safety: { fire_rating: "REI60", is_fire_exit: true },
 *     common: { width: 900, height: 2100 },
 *     ...
 *   }
 */

import {
  IFCRELDEFINESBYPROPERTIES,
  IFCRELDEFINESBYTYPE,
  type IfcAPI,
} from 'web-ifc';

import {
  type CanonicalElementType,
  ifcEntityToCanonical,
  ifcPsetPropToCanonical,
} from './canonical.js';
import type { ElementEntry } from './metadata.js';

export type PropertyValue = string | number | boolean | null;
export type PropertySet = Record<string, PropertyValue>;
export type ElementCanonicalData = {
  _element_type?: CanonicalElementType;
} & Record<string, PropertySet | CanonicalElementType | undefined>;
export type Properties = Record<string, ElementCanonicalData>;

const SKIP_KEYS = new Set([
  'expressID',
  'type',
  'ObjectPlacement',
  'Representation',
  'OwnerHistory',
  'IsDecomposedBy',
  'Decomposes',
  'IsDefinedBy',
  'HasAssociations',
  'HasAssignments',
  'ContainedInStructure',
  'ContainsElements',
  'IsTypedBy',
  'HasContext',
  'HasOpenings',
  'HasFillings',
  'FillsVoids',
  'VoidsElements',
  'ConnectedTo',
  'ConnectedFrom',
  'HasCoverings',
  'HasProjections',
  'ReferencedBy',
  'ReferencedInStructures',
  'HasPorts',
  'IsConnectionRealization',
  'ProvidesBoundaries',
  'BoundedBy',
  'HasPropertySets',
  'Types',
  'RepresentationMaps',
  'RepresentationsInContext',
]);

function extractAttributes(
  api: IfcAPI,
  modelID: number,
  expressID: number,
): PropertySet {
  const line = api.GetLine(modelID, expressID, true) as Record<string, unknown>;
  const attrs: PropertySet = {};
  for (const [key, raw] of Object.entries(line)) {
    if (SKIP_KEYS.has(key)) continue;
    if (key === 'GlobalId') {
      const gid = stringValue(raw);
      if (gid !== null) attrs['GlobalId'] = gid;
      continue;
    }
    const v = primitiveValue(raw);
    if (v === null || v === '') continue;
    attrs[key] = v;
  }
  return attrs;
}

export async function buildProperties(
  api: IfcAPI,
  modelID: number,
  elements: ElementEntry[],
): Promise<Properties> {
  const out: Properties = {};

  // Seed each known element with its canonical type so rules can filter
  // even when an element has no property sets attached.
  for (const elem of elements) {
    if (elem.globalId === null) continue;
    const canonical = ifcEntityToCanonical(elem.type);
    const entry: ElementCanonicalData = {
      ...(canonical !== null ? { _element_type: canonical } : {}),
    };
    const attrs = extractAttributes(api, modelID, elem.expressID);
    if (Object.keys(attrs).length > 0) {
      entry['Attributes'] = attrs;
    }
    out[elem.globalId] = entry;
  }

  const relIDs = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  for (let i = 0; i < relIDs.size(); i += 1) {
    const rel = api.GetLine(modelID, relIDs.get(i), true) as Record<
      string,
      unknown
    >;
    const propSet = rel['RelatingPropertyDefinition'] as
      | Record<string, unknown>
      | undefined;
    if (!propSet) continue;

    const psetName = stringValue(propSet['Name']) ?? 'Unnamed';
    const properties = collectProperties(propSet);

    const relatedObjects = rel['RelatedObjects'];
    if (!Array.isArray(relatedObjects)) continue;
    for (const obj of relatedObjects) {
      const target = obj as Record<string, unknown>;
      const gid = stringValue(target['GlobalId']);
      if (gid === null) continue;
      out[gid] ??= {};
      mergeCanonical(out[gid], psetName, properties);
    }
  }

  // ── Type properties (IfcRelDefinesByType) ──────────────────────────
  // Each element may reference an IfcTypeObject (e.g. IfcDoorType) that
  // carries its own attributes and property sets inherited by all instances.
  const typeRelIDs = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE);
  for (let i = 0; i < typeRelIDs.size(); i += 1) {
    const rel = api.GetLine(modelID, typeRelIDs.get(i), true) as Record<
      string,
      unknown
    >;
    const typeObj = rel['RelatingType'] as
      | Record<string, unknown>
      | undefined;
    if (!typeObj) continue;

    const typeExpressID = numberValue(typeObj['expressID']);
    const typeAttrs = typeExpressID !== null
      ? extractAttributes(api, modelID, typeExpressID)
      : {};
    const typeName = stringValue(typeObj['Name']);
    if (typeName !== null) typeAttrs['Name'] = typeName;
    const typeCode = typeExpressID !== null
      ? api.GetLineType(modelID, typeExpressID)
      : null;
    if (typeCode !== null) {
      const rawTypeName = (
        api as unknown as { GetNameFromTypeCode?: (c: number) => string }
      ).GetNameFromTypeCode?.(typeCode);
      if (typeof rawTypeName === 'string') {
        typeAttrs['IfcType'] = rawTypeName;
      }
    }

    // Collect property sets attached directly to the type object.
    const typePsets: { name: string; props: PropertySet }[] = [];
    const hasPropSets = typeObj['HasPropertySets'];
    if (Array.isArray(hasPropSets)) {
      for (const ps of hasPropSets) {
        const pset = ps as Record<string, unknown>;
        const psetName = stringValue(pset['Name']) ?? 'Unnamed';
        const props = collectProperties(pset);
        if (Object.keys(props).length > 0) {
          typePsets.push({ name: psetName, props });
        }
      }
    }

    const relatedObjects = rel['RelatedObjects'];
    if (!Array.isArray(relatedObjects)) continue;
    for (const obj of relatedObjects) {
      const target = obj as Record<string, unknown>;
      const gid = stringValue(target['GlobalId']);
      if (gid === null) continue;
      const entry = out[gid] ??= {};
      if (Object.keys(typeAttrs).length > 0) {
        entry['Type Attributes'] = { ...typeAttrs };
      }
      for (const { name, props } of typePsets) {
        mergeCanonical(entry, name, props);
        const prefixed = `[Type] ${name}`;
        const existing = entry[prefixed];
        const bucket: PropertySet =
          existing !== undefined && typeof existing === 'object'
            ? (existing as PropertySet)
            : {};
        Object.assign(bucket, props);
        entry[prefixed] = bucket;
      }
    }
  }

  return out;
}

function numberValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'number' ? inner : null;
  }
  return null;
}

function mergeCanonical(
  element: ElementCanonicalData,
  psetName: string,
  rawProps: PropertySet,
): void {
  for (const [propName, value] of Object.entries(rawProps)) {
    const canonicalPath = ifcPsetPropToCanonical(psetName, propName);
    if (canonicalPath === null) continue;
    const [domain, prop] = canonicalPath.split('.', 2);
    if (domain === undefined || prop === undefined) continue;
    const existing = element[domain];
    const bucket: PropertySet =
      existing !== undefined && typeof existing === 'object'
        ? (existing as PropertySet)
        : {};
    bucket[prop] = value;
    element[domain] = bucket;
  }

  // Also store the raw IFC property set under its original name so the
  // properties panel can show the full set, not just canonical-mapped props.
  // Canonical domains (lowercase: common, fire_safety, ...) cannot collide
  // with IFC pset names (PascalCase or prefixed: Pset_*, Qto_*).
  if (Object.keys(rawProps).length > 0) {
    const existing = element[psetName];
    const bucket: PropertySet =
      existing !== undefined && typeof existing === 'object'
        ? (existing as PropertySet)
        : {};
    Object.assign(bucket, rawProps);
    element[psetName] = bucket;
  }
}

function collectProperties(
  propSet: Record<string, unknown>,
): PropertySet {
  const result: PropertySet = {};

  // IfcPropertySet has HasProperties; IfcElementQuantity has Quantities.
  const items =
    (propSet['HasProperties'] as unknown[] | undefined)
    ?? (propSet['Quantities'] as unknown[] | undefined)
    ?? [];

  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const name = stringValue(item['Name']);
    if (name === null) continue;

    // IfcPropertySingleValue → NominalValue
    const nominal = item['NominalValue'];
    if (nominal !== undefined) {
      result[name] = primitiveValue(nominal);
      continue;
    }
    // IfcQuantityLength/Area/Volume/Count → LengthValue/AreaValue/...
    for (const key of [
      'LengthValue',
      'AreaValue',
      'VolumeValue',
      'CountValue',
      'WeightValue',
      'TimeValue',
    ]) {
      if (key in item) {
        result[name] = primitiveValue(item[key]);
        break;
      }
    }
  }
  return result;
}

function primitiveValue(v: unknown): PropertyValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') {
      return inner;
    }
  }
  return null;
}

function stringValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'string' ? inner : null;
  }
  return null;
}
