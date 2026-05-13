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

import { IFCRELDEFINESBYPROPERTIES, type IfcAPI } from 'web-ifc';

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
    if (canonical === null) continue;
    out[elem.globalId] = { _element_type: canonical };
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

  return out;
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
