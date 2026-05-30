'use client';

import { useMemo } from 'react';

import type {
  ElementEntry,
  ElementProperties,
  ModelMetadata,
  ModelProperties,
  PropertySet,
  PropertyValue,
} from '@/lib/api/viewerTypes';
import {
  parseEntityKey,
  useViewerEntityStore,
} from '@/stores/viewerEntityStore';

/** Sentinel value used when a property exists across all selected elements but
 *  with differing values. Consumers (PropertyRow) render this as a localised
 *  "Mixed" label. */
export const MIXED_VALUE = '__mixed__' as const;

export type TypeBreakdownEntry = { type: string; count: number };
export type TypeBreakdown = TypeBreakdownEntry[];

export type MultiSelectedPropertiesState = {
  /** Intersected property sets — only psets & keys present in every selected
   *  element. Values equal across all elements pass through; differing values
   *  are replaced with `MIXED_VALUE`. */
  commonPsets: ElementProperties;
  /** Total number of common property keys across all shared psets. */
  commonCount: number;
  /** Number of selected elements. */
  selectedCount: number;
  /** Type breakdown sorted by count descending, e.g. [{ type: 'IfcBeam', count: 2 }]. */
  typeBreakdown: TypeBreakdown;
  /** True when selected.size > 100 — too many to intersect cheaply. */
  tooMany: boolean;
};

const MAX_MULTI_SELECT = 100;

function valuesEqual(a: PropertyValue, b: PropertyValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  return false;
}

function isPset(value: unknown): value is PropertySet {
  return typeof value === 'object' && value !== null;
}

function intersectKeys(target: Set<string>, source: Set<string>): void {
  for (const k of target) {
    if (!source.has(k)) target.delete(k);
  }
}

function buildCommonPsets(
  allProps: ElementProperties[],
): { commonPsets: ElementProperties; commonCount: number } {
  const first = allProps[0];
  if (first === undefined) return { commonPsets: {}, commonCount: 0 };

  // Step 1: intersect pset names
  const psetNames = new Set(
    Object.keys(first).filter((k) => k !== '_element_type' && isPset(first[k])),
  );
  for (let i = 1; i < allProps.length; i += 1) {
    const ep = allProps[i];
    if (ep === undefined) return { commonPsets: {}, commonCount: 0 };
    const names = new Set(
      Object.keys(ep).filter((k) => k !== '_element_type' && isPset(ep[k])),
    );
    intersectKeys(psetNames, names);
  }

  if (psetNames.size === 0) return { commonPsets: {}, commonCount: 0 };

  // Step 2: for each pset, intersect keys and merge values
  const commonPsets: ElementProperties = {};
  let commonCount = 0;

  for (const psetName of psetNames) {
    const firstPset = first[psetName];
    if (!firstPset) { /* empty — skip */ } else {
      const keys = new Set(Object.keys(firstPset));

      for (let i = 1; i < allProps.length; i += 1) {
        const ep = allProps[i];
        if (ep === undefined) break;
        const pset = ep[psetName];
        if (pset) {
          intersectKeys(keys, new Set(Object.keys(pset)));
        } else {
          keys.clear();
        }
      }

      if (keys.size > 0) {
        const merged: PropertySet = {};

        for (const key of keys) {
          const firstVal = firstPset[key] ?? null;
          let allSame = true;

          for (let i = 1; i < allProps.length && allSame; i += 1) {
            const ep = allProps[i];
            if (ep === undefined) break;
            const pset = ep[psetName];
            const val = (pset !== undefined ? pset[key] : undefined) ?? null;
            if (!valuesEqual(firstVal, val)) allSame = false;
          }

          merged[key] = allSame ? firstVal : MIXED_VALUE;
        }

        commonPsets[psetName] = merged;
        commonCount += keys.size;
      }
    }
  }

  return { commonPsets, commonCount };
}

export function useMultiSelectedProperties(
  metadata: ModelMetadata | undefined,
  properties: ModelProperties | undefined,
): MultiSelectedPropertiesState {
  const selected = useViewerEntityStore((s) => s.selected);

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (metadata === undefined || metadata.elements === undefined) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  return useMemo(() => {
    const empty: MultiSelectedPropertiesState = {
      commonPsets: {},
      commonCount: 0,
      selectedCount: selected.size,
      typeBreakdown: [],
      tooMany: false,
    };

    if (selected.size < 2) return empty;
    if (selected.size > MAX_MULTI_SELECT) return { ...empty, tooMany: true };

    // Resolve each selected key to its ElementProperties
    const allProps: ElementProperties[] = [];
    const typeCounts = new Map<string, number>();

    for (const key of selected) {
      const parsed = parseEntityKey(key);
      if (parsed !== null) {
        const el = elementsByExpressId.get(parsed.localId);
        if (el?.globalId !== null && el?.globalId !== undefined && properties !== undefined) {
          const elProps = properties[el.globalId];
          if (elProps !== undefined) {
            allProps.push(elProps);
            typeCounts.set(el.type, (typeCounts.get(el.type) ?? 0) + 1);
          }
        }
      }
    }

    if (allProps.length < 2) return empty;

    // Type breakdown sorted by count desc
    const typeBreakdown: TypeBreakdown = [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const { commonPsets, commonCount } = buildCommonPsets(allProps);

    if (commonCount === 0) {
      return { ...empty, selectedCount: selected.size, typeBreakdown };
    }

    return {
      commonPsets,
      commonCount,
      selectedCount: selected.size,
      typeBreakdown,
      tooMany: false,
    };
  }, [selected, properties, elementsByExpressId]);
}
