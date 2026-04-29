/**
 * Extract per-element property sets and quantity sets.
 *
 * Walks IfcRelDefinesByProperties to map elements ↔ pset names ↔ properties.
 * The output is keyed by element GlobalId so the viewer can join against
 * geometry by stable identity.
 *
 * Property values can balloon — for a 50k-element model with 20 psets each
 * this JSON can hit tens of MB. The viewer is expected to lazy-load this on
 * demand.
 */

import { IFCRELDEFINESBYPROPERTIES, type IfcAPI } from 'web-ifc';

export type PropertyValue = string | number | boolean | null;
export type PropertySet = Record<string, PropertyValue>;
export type ElementProperties = Record<string, PropertySet>;
export type Properties = Record<string, ElementProperties>;

export async function buildProperties(
  api: IfcAPI,
  modelID: number,
): Promise<Properties> {
  const out: Properties = {};

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
      // Merge — last write wins if two psets clash, which is fine for v1.
      out[gid][psetName] = { ...(out[gid][psetName] ?? {}), ...properties };
    }
  }

  return out;
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
