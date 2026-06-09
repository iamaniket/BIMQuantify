/**
 * Shared helpers for reading scalar attributes off a web-ifc line.
 *
 * Lives in its own module so both the metadata walk (which already fetches each
 * element's line to read GlobalId/Name) and the properties walk can use the
 * exact same attribute-extraction logic without one importing the other — and,
 * crucially, without fetching the same element line twice (see
 * ElementEntry.attributes in metadata.ts).
 */

export type PropertyValue = string | number | boolean | null;
export type PropertySet = Record<string, PropertyValue>;

// Handle-valued attributes we never want as scalar properties. Dropping these
// means a `flatten: false` GetLine is enough — we don't pay to recursively
// expand an element's geometry/relationship graph just to discard it.
export const SKIP_KEYS = new Set([
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

// Filter a line's primitive attributes, dropping the handle-valued ones
// (ObjectPlacement, Representation, ...) listed in SKIP_KEYS. Operates on an
// already-fetched line so callers control whether it was flattened.
export function attributesFromLine(line: Record<string, unknown>): PropertySet {
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

export function primitiveValue(v: unknown): PropertyValue {
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

export function stringValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'string' ? inner : null;
  }
  return null;
}

export function numberValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const inner = (v as Record<string, unknown>)['value'];
    return typeof inner === 'number' ? inner : null;
  }
  return null;
}
