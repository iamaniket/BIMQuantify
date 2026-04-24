/**
 * Represents a single element extracted from an IFC model.
 */
export interface IfcElement {
  /** IFC express ID */
  id: number;
  /** IFC entity type, e.g. "IFCWALL", "IFCSLAB" */
  type: string;
  /** Human-readable name from IFC Name attribute */
  name: string | null;
  /** IFC GlobalId (GUID) */
  globalId: string | null;
  /** Flat map of property set name → property name → value */
  properties: Record<string, Record<string, string | number | boolean | null>>;
}

/**
 * Result returned after parsing an IFC file.
 */
export interface IfcParseResult {
  /** Parsed elements */
  elements: IfcElement[];
  /** Total element count */
  count: number;
  /** Parsing duration in milliseconds */
  durationMs: number;
}
