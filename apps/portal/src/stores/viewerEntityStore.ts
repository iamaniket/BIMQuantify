import { create } from 'zustand';

import type { EntityAppearance } from '@bimstitch/viewer';

export type { EntityAppearance };

export type EntityKey = string; // "modelId::localId"

export function toEntityKey(modelId: string, localId: number): EntityKey {
  return `${modelId}::${String(localId)}`;
}

export function parseEntityKey(key: EntityKey): { modelId: string; localId: number } | null {
  const sep = key.indexOf('::');
  if (sep < 0) return null;
  const localId = Number(key.slice(sep + 2));
  if (Number.isNaN(localId)) return null;
  return { modelId: key.slice(0, sep), localId };
}

export type ViewerFeature = 'hover' | 'selection' | 'xray' | 'visibility';

export interface ViewerFeatureFlags {
  hover: boolean;
  selection: boolean;
  xray: boolean;
  visibility: boolean;
}

interface ViewerEntityState {
  modelId: string | null;

  selected: Set<EntityKey>;
  hidden: Set<EntityKey>;
  isolated: Set<EntityKey>;
  xrayed: Set<EntityKey>;
  opacityOverrides: Map<EntityKey, number>;
  isolationActive: boolean;

  enabled: ViewerFeatureFlags;

  _syncDepth: number;

  select: (keys: EntityKey[]) => void;
  addToSelection: (keys: EntityKey[]) => void;
  removeFromSelection: (keys: EntityKey[]) => void;
  clearSelection: () => void;

  hideItems: (keys: EntityKey[]) => void;
  showItems: (keys: EntityKey[]) => void;
  showAll: () => void;
  isolateItems: (keys: EntityKey[]) => void;

  xrayItems: (keys: EntityKey[]) => void;
  unxrayItems: (keys: EntityKey[]) => void;
  clearXray: () => void;

  setOpacity: (keys: EntityKey[], opacity: number) => void;
  resetOpacity: (keys: EntityKey[]) => void;

  setFeatureEnabled: (feature: ViewerFeature, on: boolean) => void;

  _applyViewerSelection: (keys: EntityKey[]) => void;
  _applyViewerVisibility: (
    hidden: EntityKey[],
    isolated: EntityKey[],
    active: boolean,
  ) => void;
  _applyViewerXray: (xrayed: EntityKey[]) => void;
  _applyViewerOpacity: (overrides: Array<[EntityKey, number]>) => void;
  _applyViewerFeatureEnabled: (feature: ViewerFeature, on: boolean) => void;
  _setModelId: (id: string) => void;
  _reset: () => void;
}

const EMPTY_SET = new Set<EntityKey>();
const EMPTY_MAP = new Map<EntityKey, number>();
const DEFAULT_FEATURES: ViewerFeatureFlags = {
  hover: true,
  selection: true,
  xray: true,
  visibility: true,
};

export const useViewerEntityStore = create<ViewerEntityState>()((set) => ({
  modelId: null,

  selected: EMPTY_SET,
  hidden: EMPTY_SET,
  isolated: EMPTY_SET,
  xrayed: EMPTY_SET,
  opacityOverrides: EMPTY_MAP,
  isolationActive: false,

  enabled: DEFAULT_FEATURES,

  _syncDepth: 0,

  select: (keys) => set({ selected: new Set(keys) }),
  addToSelection: (keys) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const k of keys) next.add(k);
      return { selected: next };
    }),
  removeFromSelection: (keys) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const k of keys) next.delete(k);
      return { selected: next };
    }),
  clearSelection: () => set({ selected: EMPTY_SET }),

  hideItems: (keys) =>
    set((s) => {
      const next = new Set(s.hidden);
      for (const k of keys) next.add(k);
      return { hidden: next };
    }),
  showItems: (keys) =>
    set((s) => {
      const next = new Set(s.hidden);
      for (const k of keys) next.delete(k);
      return { hidden: next };
    }),
  showAll: () =>
    set({
      hidden: EMPTY_SET,
      isolated: EMPTY_SET,
      isolationActive: false,
    }),
  isolateItems: (keys) =>
    set({
      isolated: new Set(keys),
      isolationActive: true,
    }),

  xrayItems: (keys) =>
    set((s) => {
      const next = new Set(s.xrayed);
      for (const k of keys) next.add(k);
      return { xrayed: next };
    }),
  unxrayItems: (keys) =>
    set((s) => {
      const next = new Set(s.xrayed);
      for (const k of keys) next.delete(k);
      return { xrayed: next };
    }),
  clearXray: () => set({ xrayed: EMPTY_SET }),

  setOpacity: (keys, opacity) =>
    set((s) => {
      const next = new Map(s.opacityOverrides);
      for (const k of keys) next.set(k, opacity);
      return { opacityOverrides: next };
    }),
  resetOpacity: (keys) =>
    set((s) => {
      const next = new Map(s.opacityOverrides);
      for (const k of keys) next.delete(k);
      return { opacityOverrides: next.size ? next : EMPTY_MAP };
    }),

  setFeatureEnabled: (feature, on) =>
    set((s) => ({ enabled: { ...s.enabled, [feature]: on } })),

  _applyViewerSelection: (keys) =>
    set((s) => ({
      _syncDepth: s._syncDepth + 1,
      selected: new Set(keys),
    })),
  _applyViewerVisibility: (hidden, isolated, active) =>
    set((s) => ({
      _syncDepth: s._syncDepth + 1,
      hidden: new Set(hidden),
      isolated: new Set(isolated),
      isolationActive: active,
    })),
  _applyViewerXray: (xrayed) =>
    set((s) => ({
      _syncDepth: s._syncDepth + 1,
      xrayed: new Set(xrayed),
    })),

  _applyViewerOpacity: (overrides) =>
    set((s) => {
      const next = new Map<EntityKey, number>();
      for (const [k, o] of overrides) next.set(k, o);
      return {
        _syncDepth: s._syncDepth + 1,
        opacityOverrides: next.size ? next : EMPTY_MAP,
      };
    }),

  _applyViewerFeatureEnabled: (feature, on) =>
    set((s) => ({
      _syncDepth: s._syncDepth + 1,
      enabled: { ...s.enabled, [feature]: on },
    })),

  _setModelId: (id) => set({ modelId: id }),
  _reset: () =>
    set({
      modelId: null,
      selected: EMPTY_SET,
      hidden: EMPTY_SET,
      isolated: EMPTY_SET,
      xrayed: EMPTY_SET,
      opacityOverrides: EMPTY_MAP,
      isolationActive: false,
      enabled: DEFAULT_FEATURES,
      _syncDepth: 0,
    }),
}));

export function getAppearance(key: EntityKey): EntityAppearance {
  const s = useViewerEntityStore.getState();
  return {
    selected: s.selected.has(key),
    visible: !s.hidden.has(key),
    xray: s.xrayed.has(key),
    opacity: s.opacityOverrides.get(key) ?? null,
  };
}
