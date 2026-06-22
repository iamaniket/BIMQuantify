/**
 * Exception list (Part D). IFC categories the visibility plugin controls
 * individually (default `IfcSpace`). They are auto-hidden at model load and
 * kept hidden through bulk show/hide — flipped only via
 * `visibility.setTypeVisible` (the toolbar spaces toggle calls that).
 *
 * Owns its own maps (`managedTypes` / `typeHidden` / `exceptionIdsByModel`) and
 * resolves category queries against the viewer's models on demand. It mutates
 * visibility state only — it never flushes or renders; the factory's command
 * handlers run exactly one `flush()` after they emit `visibility:change`.
 */

import type { ItemId, ViewerContext } from '../../../core/types.js';

/** Normalize an IFC type to the upper-case category key fragments uses (`IFCSPACE`). */
export const normalizeType = (t: string): string => t.trim().toUpperCase();

export interface ExceptionManager {
  /** type key -> currently hidden? Default: hidden, so spaces are off by default. */
  readonly typeHidden: Map<string, boolean>;
  /** IFC categories the plugin controls individually (upper-cased keys). */
  readonly managedTypes: Set<string>;
  /** modelId -> (type key -> localIds), resolved from the model at load time. */
  readonly exceptionIdsByModel: Map<string, Map<string, number[]>>;
  /** Resolve a category's localIds for one model (handles errors → []). */
  resolveCategory(
    model: { getItemsOfCategories(c: RegExp[]): Promise<Record<string, number[]>> },
    key: string,
  ): Promise<number[]>;
  /** Resolve every managed type's localIds for one model (called on model load). */
  resolveExceptionsForModel(modelId: string): Promise<void>;
  /** All ItemIds of a managed type across loaded models (optionally one model). */
  exceptionItems(key: string, modelId?: string): ItemId[];
  /** ItemIds for every managed type that is currently toggled hidden. */
  managedHiddenItems(): ItemId[];
}

export function createExceptionManager(
  exceptionTypes: string[] | undefined,
  getCtx: () => ViewerContext | null,
): ExceptionManager {
  // IFC categories the plugin controls individually. Auto-hidden at load and
  // kept hidden through bulk ops; flipped only via `visibility.setTypeVisible`.
  const managedTypes = new Set<string>(
    (exceptionTypes ?? ['IfcSpace']).map(normalizeType),
  );
  // type key -> currently hidden? Default: hidden, so spaces are off by default
  // even before the host pushes a preference.
  const typeHidden = new Map<string, boolean>();
  for (const key of managedTypes) typeHidden.set(key, true);
  // modelId -> (type key -> localIds), resolved from the model at load time.
  const exceptionIdsByModel = new Map<string, Map<string, number[]>>();

  const resolveCategory = async (
    model: { getItemsOfCategories(c: RegExp[]): Promise<Record<string, number[]>> },
    key: string,
  ): Promise<number[]> => {
    try {
      const res = await model.getItemsOfCategories([new RegExp(`^${key}$`, 'i')]);
      return Object.values(res).flat();
    } catch {
      return [];
    }
  };

  // Resolve every managed type's localIds for one model (called on model load).
  const resolveExceptionsForModel = async (modelId: string): Promise<void> => {
    const ctx = getCtx();
    if (!ctx) return;
    const model = ctx.models().get(modelId);
    if (!model) return;
    let perType = exceptionIdsByModel.get(modelId);
    if (!perType) {
      perType = new Map();
      exceptionIdsByModel.set(modelId, perType);
    }
    for (const key of managedTypes) {
      perType.set(key, await resolveCategory(model, key));
    }
  };

  // All ItemIds of a managed type across loaded models (optionally one model).
  const exceptionItems = (key: string, modelId?: string): ItemId[] => {
    const out: ItemId[] = [];
    for (const [mId, perType] of exceptionIdsByModel) {
      if (modelId && mId !== modelId) continue;
      for (const localId of perType.get(key) ?? []) out.push({ modelId: mId, localId });
    }
    return out;
  };

  // ItemIds for every managed type that is currently toggled hidden.
  const managedHiddenItems = (): ItemId[] => {
    const out: ItemId[] = [];
    for (const key of managedTypes) {
      if (typeHidden.get(key)) out.push(...exceptionItems(key));
    }
    return out;
  };

  return {
    typeHidden,
    managedTypes,
    exceptionIdsByModel,
    resolveCategory,
    resolveExceptionsForModel,
    exceptionItems,
    managedHiddenItems,
  };
}
