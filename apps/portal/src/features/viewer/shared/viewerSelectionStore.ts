'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * What the unified viewer should load for a given project. Held client-side
 * (not in the URL) so the viewer URL stays a clean `/projects/<id>/viewer`
 * with no model/file GUIDs. Persisted to sessionStorage so a refresh keeps
 * the same scene within the tab.
 *
 * - `all`    — every ready IFC model of the project (the federated default).
 * - `models` — an explicit subset (the models-table "Load selected" + the
 *              viewer dropdown checkboxes).
 * - `single` — one exact file: a specific version, a PDF/drawing, or a
 *              finding deep-link. The only mode for non-IFC files.
 */
export type ViewerTarget =
  | { kind: 'all' }
  | { kind: 'models'; modelIds: string[] }
  | { kind: 'single'; modelId: string; fileId: string; findingId?: string };

const DEFAULT_TARGET: ViewerTarget = { kind: 'all' };

type ViewerSelectionState = {
  byProject: Record<string, ViewerTarget>;
  setTarget: (projectId: string, target: ViewerTarget) => void;
}

// SSR-safe wrapper — `window` is undefined during server rendering.
const safeSessionStorage = {
  getItem: (name: string): string | null => (typeof window === 'undefined' ? null : window.sessionStorage.getItem(name)),
  setItem: (name: string, value: string): void => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(name, value);
  },
  removeItem: (name: string): void => {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(name);
  },
};

export const useViewerSelectionStore = create<ViewerSelectionState>()(
  persist(
    (set) => ({
      byProject: {},
      setTarget: (projectId, target) => set((s) => ({ byProject: { ...s.byProject, [projectId]: target } })),
    }),
    {
      name: 'bimstitch.viewerSelection',
      storage: createJSONStorage(() => safeSessionStorage),
      // Manual rehydrate (see useViewerSelectionHydrated) so the server and the
      // first client render always agree on the default — avoids hydration
      // mismatch — and a refresh of the viewer page reloads the persisted target.
      skipHydration: true,
    },
  ),
);

/** Reactive selector — the target for a project (defaults to "all models"). */
export function useViewerTarget(projectId: string): ViewerTarget {
  return useViewerSelectionStore((s) => s.byProject[projectId] ?? DEFAULT_TARGET);
}

/** Imperative setter — used by every "open viewer" entry point. */
export function setViewerTarget(projectId: string, target: ViewerTarget): void {
  useViewerSelectionStore.getState().setTarget(projectId, target);
}

/**
 * Rehydrate the persisted target on mount (the store uses `skipHydration` so
 * server and first client render agree on the default). Returns true once
 * sessionStorage has been read; the viewer defers scope resolution until then
 * so a refresh restores the exact scene rather than falling back to "all".
 */
export function useViewerSelectionHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const result = useViewerSelectionStore.persist.rehydrate();
    void Promise.resolve(result).finally(() => {
      setHydrated(true);
    });
  }, []);
  return hydrated;
}
