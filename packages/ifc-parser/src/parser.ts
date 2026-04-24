import * as WebIfc from 'web-ifc';
import type { IfcElement, IfcParseResult } from './types.js';

/**
 * BIM element IFC types to extract for quantity takeoff.
 * Extend this list to cover more element categories.
 */
const ELEMENT_TYPES: readonly number[] = [
  WebIfc.IFCWALL,
  WebIfc.IFCWALLSTANDARDCASE,
  WebIfc.IFCSLAB,
  WebIfc.IFCBEAM,
  WebIfc.IFCCOLUMN,
  WebIfc.IFCDOOR,
  WebIfc.IFCWINDOW,
  WebIfc.IFCROOF,
  WebIfc.IFCSTAIR,
  WebIfc.IFCFURNISHINGELEMENT,
  WebIfc.IFCBUILDINGSTOREY,
];

/**
 * Parses an IFC file buffer and extracts building elements with properties.
 *
 * @param buffer - Raw bytes of the IFC (STEP) file
 * @returns Parsed elements and metadata
 */
export async function parseIfc(buffer: Uint8Array): Promise<IfcParseResult> {
  const start = Date.now();
  const api = new WebIfc.IfcAPI();
  await api.Init();

  const modelId = api.OpenModel(buffer, {
    COORDINATE_TO_ORIGIN: true,
  });

  const elements: IfcElement[] = [];

  for (const typeId of ELEMENT_TYPES) {
    const ids = api.GetLineIDsWithType(modelId, typeId);
    for (let i = 0; i < ids.size(); i++) {
      const expressId = ids.get(i);
      try {
        const raw = api.GetLine(modelId, expressId) as Record<string, unknown>;
        const element = await buildElement(expressId, typeId, raw, api, modelId);
        elements.push(element);
      } catch {
        // Skip elements that cannot be read
      }
    }
  }

  api.CloseModel(modelId);

  return {
    elements,
    count: elements.length,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTypeName(api: WebIfc.IfcAPI, typeId: number): string {
  // web-ifc exposes the schema via GetNameFromTypeCode
  try {
    return (api as unknown as { GetNameFromTypeCode: (t: number) => string }).GetNameFromTypeCode(typeId);
  } catch {
    return `IFC_TYPE_${typeId}`;
  }
}

function extractString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return extractString((value as Record<string, unknown>)['value']);
  }
  return null;
}

async function buildElement(
  id: number,
  typeId: number,
  raw: Record<string, unknown>,
  api: WebIfc.IfcAPI,
  modelId: number,
): Promise<IfcElement> {
  const name = extractString(raw['Name']) ?? extractString(raw['name']);
  const globalId = extractString(raw['GlobalId']) ?? extractString(raw['globalId']);

  const properties: IfcElement['properties'] = {};

  // Attempt to read property sets attached to this element via the helpers API
  try {
    const psets = await api.properties.getPropertySets(modelId, id, true);
    for (const pset of psets) {
      const psetRaw = pset as Record<string, unknown>;
      const psetName = extractString(psetRaw['Name']) ?? 'UnknownPset';
      properties[psetName] = {};
      const props = psetRaw['HasProperties'];
      if (Array.isArray(props)) {
        for (const prop of props) {
          const p = prop as Record<string, unknown>;
          const pName = extractString(p['Name']) ?? String(p['expressID'] ?? '');
          const pVal = extractPropertyValue(p['NominalValue'] ?? p['Value']);
          properties[psetName]![pName] = pVal;
        }
      }
    }
  } catch {
    // Property sets may not be available for all elements
  }

  return {
    id,
    type: getTypeName(api, typeId),
    name,
    globalId,
    properties,
  };
}

function extractPropertyValue(
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object' && 'value' in (value as object)) {
    return extractPropertyValue((value as Record<string, unknown>)['value']);
  }
  return String(value);
}
