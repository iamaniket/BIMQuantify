import type { IfcElement } from '@bim-quantify/ifc-parser';

/** A single takeoff line item */
export interface TakeoffItem {
  /** Reference to the source IFC element */
  elementId: number;
  elementType: string;
  elementName: string | null;
  /** Human-readable material description */
  material: string;
  /** Unit of measure, e.g. "m²", "m³", "EA", "LM" */
  unit: string;
  /** Computed quantity */
  quantity: number;
  /** Optional unit cost in USD */
  unitCost?: number;
  /** Optional total cost = quantity * unitCost */
  totalCost?: number;
  /** Confidence score 0–1 from AI */
  confidence: number;
}

/** Input to the AI takeoff engine */
export interface TakeoffInput {
  elements: IfcElement[];
  /** Optional project context for the AI prompt */
  projectDescription?: string;
}

/** Result returned by the AI takeoff engine */
export interface TakeoffResult {
  items: TakeoffItem[];
  count: number;
  durationMs: number;
  /** Total estimated cost if unit costs were provided */
  totalCost?: number;
  /** Raw AI model used */
  model: string;
}
