import OpenAI from 'openai';
import type { IfcElement } from '@bim-quantify/ifc-parser';
import type { TakeoffInput, TakeoffItem, TakeoffResult } from './types.js';

const TAKEOFF_MODEL = 'gpt-4o';
const MAX_ELEMENTS_PER_BATCH = 50;

const SYSTEM_PROMPT = `You are an expert quantity surveyor and BIM specialist.
Given a list of BIM elements parsed from an IFC file, you must produce a detailed
quantity takeoff. For each element provide:
- material: primary material description
- unit: unit of measure (m², m³, EA, LM, KG, etc.)
- quantity: numeric quantity (estimate from element type and available properties)
- unitCost: optional unit cost in USD
- confidence: confidence score 0.0–1.0

Respond ONLY with a JSON array of objects matching this schema — no markdown, no explanation.`;

/**
 * Run an AI-powered quantity takeoff on a list of IFC elements.
 *
 * @param input - Parsed IFC elements and optional project context
 * @param apiKey - OpenAI API key (falls back to OPENAI_API_KEY env var)
 * @returns Takeoff result with line items
 */
export async function runTakeoff(
  input: TakeoffInput,
  apiKey?: string,
): Promise<TakeoffResult> {
  const start = Date.now();
  const client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });

  const allItems: TakeoffItem[] = [];

  // Process elements in batches to stay within context window limits
  for (let i = 0; i < input.elements.length; i += MAX_ELEMENTS_PER_BATCH) {
    const batch = input.elements.slice(i, i + MAX_ELEMENTS_PER_BATCH);
    const batchItems = await processBatch(client, batch, input.projectDescription);
    allItems.push(...batchItems);
  }

  const totalCost = allItems.reduce(
    (sum, item) => sum + (item.totalCost ?? 0),
    0,
  );

  return {
    items: allItems,
    count: allItems.length,
    durationMs: Date.now() - start,
    totalCost: totalCost > 0 ? totalCost : undefined,
    model: TAKEOFF_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function processBatch(
  client: OpenAI,
  elements: IfcElement[],
  projectDescription?: string,
): Promise<TakeoffItem[]> {
  const userPrompt = buildUserPrompt(elements, projectDescription);

  const response = await client.chat.completions.create({
    model: TAKEOFF_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message.content ?? '[]';
  const raw = parseJsonSafely(content) as RawTakeoffItem[];

  return raw.map((item, idx) => {
    const el = elements[idx % elements.length]!;
    const quantity = Number(item.quantity) || 1;
    const unitCost = item.unitCost != null ? Number(item.unitCost) : undefined;
    return {
      elementId: el.id,
      elementType: el.type,
      elementName: el.name,
      material: String(item.material ?? 'Unknown'),
      unit: String(item.unit ?? 'EA'),
      quantity,
      unitCost,
      totalCost: unitCost != null ? quantity * unitCost : undefined,
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
    };
  });
}

interface RawTakeoffItem {
  material?: unknown;
  unit?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  confidence?: unknown;
}

function buildUserPrompt(elements: IfcElement[], projectDescription?: string): string {
  const context = projectDescription ? `Project context: ${projectDescription}\n\n` : '';
  const elementSummaries = elements.map((el) => ({
    id: el.id,
    type: el.type,
    name: el.name,
    properties: Object.entries(el.properties)
      .slice(0, 3)
      .map(([pset, props]) => ({ pset, props: Object.entries(props).slice(0, 5) })),
  }));
  return `${context}Elements:\n${JSON.stringify(elementSummaries, null, 2)}\n\nProvide the takeoff JSON array:`;
}

function parseJsonSafely(text: string): unknown {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}
