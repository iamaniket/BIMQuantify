'use client';

import { useQuery } from '@tanstack/react-query';
import {
  useCallback, useEffect, useMemo, useState,
} from 'react';

import type { ViewerBundle } from '@bimstitch/viewer';

import { federatedModelId } from '@/features/viewer/3d/federation/federatedModelId';
import { ApiError } from '@/lib/api/client';
import { getProjectViewerBundle, getViewerBundle } from '@/lib/api/projectFiles';
import type { ProjectViewerModelEntry, ViewerBundleResponse } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { viewerKeys } from './queryKeys';
import { useViewerTarget } from './viewerSelectionStore';

/**
 * The unified viewer's resolved scope. The page reads its `model`/`file`/
 * `metadata`/`bundle` from here instead of from path params, so a single page
 * serves both single-file and federated multi-model modes.
 *
 * Two notions of "model id" coexist and must not be confused:
 *  - **API model UUID** (`activeModelId`) — for finding/BCF association, model
 *    name lookups. Flows to the inspector/BCF as their `modelId` prop.
 *  - **Viewer scene id** (`activeViewerModelId` = `file-<fileId>`) — baked into
 *    every `ItemId` the viewer emits. Drives entity keys / `store.modelId` /
 *    `buildGlobalIdToLocalId`. Unified to `file-<fileId>` in BOTH modes so the
 *    single- and multi-model code paths key selection identically.
 */
export type ViewerScope = {
  /** True once the selection store has rehydrated from sessionStorage. */
  ready: boolean;
  mode: 'single' | 'multi';
  isLoading: boolean;
  isError: boolean;
  /** Single-bundle load error (404 "not processed", etc.), already humanized. */
  errorMessage: string | null;
  /** Multi-model, project genuinely has NO processed models (nothing to load). */
  isEmpty: boolean;
  /**
   * Multi-model, project HAS models but the user has deselected them all (zero
   * selected). The viewer renders a live, empty scene instead of the
   * "no models" panel so models can be re-added from the dropdown.
   */
  emptyScene: boolean;

  // What `IfcViewer` loads (IFC only; null for a single non-IFC file).
  primaryBundle: ViewerBundle | null;
  additionalBundles: ViewerBundle[];
  /** Identity of the loaded set — page reset / viewer-remount key. */
  sceneKey: string;

  // Active scope the side panels read.
  activeModelId: string;
  activeFileId: string;
  activeViewerModelId: string;
  /** Full bundle for the active file (single: fetched; multi: synthesized). */
  activeBundle: ViewerBundleResponse | null;

  // Floor-plan source (minimap + split/2D). Independent of the active model in
  // multi mode — the architectural model supplies the plan.
  planFloorPlansUrl: string | null;
  planMetadataUrl: string | null;
  planViewerModelId: string | null;
  planFileId: string | null;

  // Multi-model only.
  entries: ProjectViewerModelEntry[];
  /** Set the active model from a selected element's viewer model id. */
  setActiveByViewerModelId: (viewerModelId: string) => void;
  /** Set the active model from an API model UUID (layer-panel row click). */
  setActiveByModelId: (modelUuid: string) => void;

  deepLinkFindingId: string | null;
}

function bundleErrorMessage(err: Error | null): string | null {
  if (err === null) return null;
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return 'This file has not been processed yet, or extraction failed.';
    }
    return err.detail;
  }
  return 'Failed to load viewer bundle.';
}

/** IFC `ViewerBundle` (load input) for a single fetched bundle, keyed by file. */
function singlePrimaryBundle(
  resp: ViewerBundleResponse,
  fileId: string,
): ViewerBundle | null {
  if (resp.fragments_url === null) return null; // non-IFC (PDF/DXF/DWG)
  const out: ViewerBundle = {
    fragmentsUrl: resp.fragments_url,
    modelId: federatedModelId(fileId),
  };
  if (resp.metadata_url !== null) out.metadataUrl = resp.metadata_url;
  if (resp.properties_url !== null) out.propertiesUrl = resp.properties_url;
  if (resp.outline_url !== null) out.outlineUrl = resp.outline_url;
  if (resp.fragments_key !== null) out.cacheKey = resp.fragments_key;
  return out;
}

/** IFC `ViewerBundle` (load input) for a manifest entry. */
function entryToBundle(entry: ProjectViewerModelEntry): ViewerBundle {
  const out: ViewerBundle = {
    fragmentsUrl: entry.fragments_url!,
    modelId: federatedModelId(entry.file_id),
  };
  if (entry.metadata_url !== null) out.metadataUrl = entry.metadata_url;
  if (entry.properties_url !== null) out.propertiesUrl = entry.properties_url;
  if (entry.outline_url !== null) out.outlineUrl = entry.outline_url;
  if (entry.fragments_key !== null) out.cacheKey = entry.fragments_key;
  return out;
}

/** Synthesize the panel-facing bundle for a manifest entry (always IFC). */
function entryToBundleResponse(
  entry: ProjectViewerModelEntry,
  expiresIn: number,
): ViewerBundleResponse {
  return {
    file_type: 'ifc',
    fragments_url: entry.fragments_url,
    fragments_key: entry.fragments_key,
    metadata_url: entry.metadata_url,
    properties_url: entry.properties_url,
    geometry_url: null,
    outline_url: entry.outline_url,
    floor_plans_url: entry.floor_plans_url,
    file_url: null,
    expires_in: expiresIn,
  };
}

export function useViewerScope(projectId: string, ready: boolean): ViewerScope {
  const target = useViewerTarget(projectId);
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  const isSingle = target.kind === 'single';
  const singleModelId = target.kind === 'single' ? target.modelId : '';
  const singleFileId = target.kind === 'single' ? target.fileId : '';

  const singleQuery = useQuery({
    queryKey: viewerKeys.bundle(projectId, singleModelId, singleFileId),
    queryFn: () => {
      if (accessToken === null) throw new Error('Not authenticated');
      return getViewerBundle(accessToken, projectId, singleModelId, singleFileId);
    },
    enabled: ready && isSingle && accessToken !== null,
    staleTime: 60_000,
  });

  const manifestQuery = useQuery({
    queryKey: viewerKeys.projectBundle(projectId),
    queryFn: () => {
      if (accessToken === null) throw new Error('Not authenticated');
      return getProjectViewerBundle(accessToken, projectId);
    },
    enabled: ready && !isSingle && accessToken !== null,
    staleTime: 60_000,
  });

  // ── Multi-model entry set (filtered to the explicit subset for kind 'models') ──
  const entries = useMemo<ProjectViewerModelEntry[]>(() => {
    if (isSingle) return [];
    const all = manifestQuery.data?.models ?? [];
    if (target.kind === 'models') {
      const wanted = new Set(target.modelIds);
      return all.filter((m) => wanted.has(m.model_id));
    }
    return all;
  }, [isSingle, target, manifestQuery.data]);

  const primaryIndex = useMemo(() => {
    if (entries.length === 0) return -1;
    const arch = entries.findIndex((m) => m.detected_kind === 'architectural');
    if (arch >= 0) return arch;
    const mixed = entries.findIndex((m) => m.detected_kind === 'mixed');
    return mixed >= 0 ? mixed : 0;
  }, [entries]);
  const primary = primaryIndex >= 0 ? entries[primaryIndex]! : null;

  // Active model (multi mode) — defaults to primary; follows selection / layer
  // clicks. Stored by file_id; reset when it leaves the loaded set.
  const [activeFileIdState, setActiveFileIdState] = useState<string | null>(null);
  useEffect(() => {
    if (isSingle) return;
    const stillLoaded =
      activeFileIdState !== null
      && entries.some((e) => e.file_id === activeFileIdState);
    if (!stillLoaded) setActiveFileIdState(primary === null ? null : primary.file_id);
  }, [isSingle, entries, primary, activeFileIdState]);

  const activeEntry = useMemo(
    () => (isSingle
      ? null
      : entries.find((e) => e.file_id === activeFileIdState) ?? primary ?? null),
    [isSingle, entries, activeFileIdState, primary],
  );

  const planEntry = useMemo(() => {
    if (isSingle) return null;
    return (
      entries.find((m) => m.detected_kind === 'architectural' && m.floor_plans_url)
      ?? entries.find((m) => m.floor_plans_url !== null)
      ?? null
    );
  }, [isSingle, entries]);

  const setActiveByViewerModelId = useCallback((viewerModelId: string) => {
    // viewer model id is `file-<fileId>`.
    const fileId = viewerModelId.startsWith('file-') ? viewerModelId.slice(5) : null;
    if (fileId !== null) setActiveFileIdState(fileId);
  }, []);
  const setActiveByModelId = useCallback(
    (modelUuid: string) => {
      const hit = entries.find((e) => e.model_id === modelUuid);
      if (hit) setActiveFileIdState(hit.file_id);
    },
    [entries],
  );

  // ── Single-mode bundle ──
  const singleBundle = singleQuery.data ?? null;

  // ── Assemble the resolved scope ──
  if (isSingle) {
    const activeBundle = singleBundle;
    const isIfc = activeBundle?.file_type === 'ifc';
    return {
      ready,
      mode: 'single',
      isLoading: ready && singleQuery.isLoading,
      isError: singleQuery.isError,
      errorMessage: bundleErrorMessage(singleQuery.error),
      isEmpty: false,
      emptyScene: false,
      primaryBundle:
        activeBundle !== null && isIfc
          ? singlePrimaryBundle(activeBundle, singleFileId)
          : null,
      additionalBundles: [],
      sceneKey: `single:${singleFileId}`,
      activeModelId: singleModelId,
      activeFileId: singleFileId,
      activeViewerModelId: federatedModelId(singleFileId),
      activeBundle,
      planFloorPlansUrl: isIfc ? activeBundle.floor_plans_url : null,
      planMetadataUrl: isIfc ? activeBundle.metadata_url : null,
      planViewerModelId: null, // single model — minimap targets the lone model
      planFileId: isIfc ? singleFileId : null,
      entries: [],
      setActiveByViewerModelId,
      setActiveByModelId,
      deepLinkFindingId: target.findingId ?? null,
    };
  }

  // Multi-model.
  const expiresIn = manifestQuery.data?.expires_in ?? 0;
  const activeBundle = activeEntry !== null ? entryToBundleResponse(activeEntry, expiresIn) : null;
  // Manifest loaded cleanly (not loading, not errored). The two "no visible
  // model" states are split off this: a genuinely empty PROJECT vs. a user who
  // cleared the selection. Errors fall through to errorMessage, not either flag.
  const manifestModels = manifestQuery.data?.models ?? [];
  const manifestLoadedOk = !manifestQuery.isLoading && !manifestQuery.isError;
  return {
    ready,
    mode: 'multi',
    isLoading: ready && manifestQuery.isLoading,
    isError: manifestQuery.isError,
    // Surface manifest failures (was hardcoded null, which rendered the silent
    // empty-state — a failed federated load looked identical to "no models").
    errorMessage: bundleErrorMessage(manifestQuery.error),
    // Genuinely empty PROJECT: nothing has been processed → "no models" panel.
    isEmpty: manifestLoadedOk && manifestModels.length === 0,
    // Cleared selection: the project HAS models but none are selected → render a
    // live, empty viewer (handled by the page) instead of the panel.
    emptyScene: manifestLoadedOk && manifestModels.length > 0 && entries.length === 0,
    primaryBundle: primary !== null ? entryToBundle(primary) : null,
    additionalBundles: entries
      .filter((_, i) => i !== primaryIndex)
      .map(entryToBundle),
    // Anchor key = the project, NOT any individual model. The viewer mounts once
    // per project and the IfcViewer diff effect loads/unloads the delta in place,
    // so toggling ANY model (including the one that happens to be primary) never
    // changes this key and never remounts the viewer. The key still changes on a
    // genuine scene change (different project, or single↔multi), which is exactly
    // when the page's reset effects should fire.
    sceneKey: `multi:${projectId}`,
    activeModelId: activeEntry?.model_id ?? '',
    activeFileId: activeEntry?.file_id ?? '',
    activeViewerModelId: activeEntry ? federatedModelId(activeEntry.file_id) : '',
    activeBundle,
    planFloorPlansUrl: planEntry?.floor_plans_url ?? null,
    planMetadataUrl: planEntry?.metadata_url ?? null,
    planViewerModelId: planEntry ? federatedModelId(planEntry.file_id) : null,
    planFileId: planEntry?.file_id ?? null,
    entries,
    setActiveByViewerModelId,
    setActiveByModelId,
    deepLinkFindingId: null,
  };
}
