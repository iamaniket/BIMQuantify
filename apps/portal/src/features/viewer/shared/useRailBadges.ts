'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useMemo, useState,
} from 'react';

import type {
  DocumentViewerHandle, MeasurementController, SectionPlane, ViewerHandle,
} from '@bimstitch/viewer';

import type { PanelId, RailBadge } from '@/components/shared/viewer/shared/SideRail';
import type { ViewerFormat } from '@/components/shared/viewer/shared/viewerMode';
import { useFileFindingCount } from '@/features/findings/useFindings';

type MeasureItem = { id: string; visible: boolean };

type Params = {
  format: ViewerFormat;
  viewerHandle: ViewerHandle | null;
  documentHandle: DocumentViewerHandle | null;
  viewerReady: boolean;
  projectId: string;
  /** Active file id (may be `''`/`undefined` until a multi-model manifest resolves). */
  fileId: string | null | undefined;
  /** Persisted finding-pin visibility (the page owns the setting). */
  findingPinsVisible: boolean;
  onToggleFindingPins: () => void;
};

/**
 * Computes the side-rail count + visibility indicators (`RailBadge`s) for the
 * annotation layers drawn in the scene: measurements (3D & PDF), section planes
 * (3D), and finding pins (counted on the Findings tab, 3D & PDF). Each badge's
 * count is live (viewer events / React Query) and its toggle drives the matching
 * viewer command. Returns `{}` for drawing formats (no annotation layers).
 */
export function useRailBadges({
  format,
  viewerHandle,
  documentHandle,
  viewerReady,
  projectId,
  fileId,
  findingPinsVisible,
  onToggleFindingPins,
}: Params): Partial<Record<PanelId, RailBadge>> {
  const t = useTranslations('viewer.sidePanel');
  const isIfc = format === 'ifc';
  const isPdf = format === 'pdf';

  // The measure layer lives on the 3D viewer handle for IFC and the document
  // handle for PDF; both satisfy the engine-agnostic MeasurementController.
  const measureHandle: MeasurementController | null = isIfc
    ? viewerHandle
    : isPdf
      ? documentHandle
      : null;

  // ── Measurements ──────────────────────────────────────────────────────────
  // NOTE: in PDF mode `measure.list` returns the *current page's* measurements,
  // so the badge counts per page — off-page measurements aren't drawn anyway.
  const [measureItems, setMeasureItems] = useState<MeasureItem[]>([]);
  const refetchMeasure = useCallback(() => {
    if (!measureHandle) return;
    measureHandle.commands
      .execute<MeasureItem[]>('measure.list')
      .then((list) => {
        setMeasureItems((list ?? []).map((m) => ({ id: m.id, visible: m.visible })));
      })
      .catch(() => undefined);
  }, [measureHandle]);

  useEffect(() => {
    if (!measureHandle) {
      setMeasureItems([]);
      return undefined;
    }
    refetchMeasure();
    return measureHandle.events.on('measurement:change', refetchMeasure);
  }, [measureHandle, refetchMeasure]);

  const measureCount = measureItems.length;
  const measureVisible = measureCount > 0 && measureItems.some((m) => m.visible);
  const toggleMeasure = useCallback(() => {
    measureHandle?.commands
      .execute('measure.setAllVisible', { visible: !measureVisible })
      .catch(() => undefined);
  }, [measureHandle, measureVisible]);

  // ── Section planes (IFC only) ─────────────────────────────────────────────
  const [sectionCount, setSectionCount] = useState(0);
  const [sectionEnabled, setSectionEnabled] = useState(true);
  useEffect(() => {
    if (!isIfc || !viewerHandle || !viewerReady) {
      setSectionCount(0);
      return undefined;
    }
    const refresh = (): void => {
      viewerHandle.commands
        .execute<SectionPlane[]>('section.list')
        .then((list) => { setSectionCount(list?.length ?? 0); })
        .catch(() => undefined);
    };
    refresh();
    viewerHandle.commands
      .execute<boolean>('section.isEnabled')
      .then((v) => { setSectionEnabled(v ?? true); })
      .catch(() => undefined);
    const offChange = viewerHandle.events.on('section:change', refresh);
    const offEnabled = viewerHandle.events.on('feature:enabled', ({ name, enabled }) => {
      if (name === 'section') setSectionEnabled(enabled);
    });
    return () => { offChange(); offEnabled(); };
  }, [isIfc, viewerHandle, viewerReady]);

  const toggleSection = useCallback(() => {
    viewerHandle?.commands
      .execute('section.setEnabled', { enabled: !sectionEnabled })
      .catch(() => undefined);
  }, [viewerHandle, sectionEnabled]);

  // ── Findings (Findings tab; matches the status bar's count) ────────────────
  const findingCount = useFileFindingCount(
    projectId,
    (isIfc || isPdf) ? (fileId ?? null) : null,
  );

  return useMemo(() => {
    const badges: Partial<Record<PanelId, RailBadge>> = {};
    if (isIfc || isPdf) {
      badges.measure = {
        count: measureCount,
        visible: measureVisible,
        onToggleVisible: toggleMeasure,
        toggleLabel: t(measureVisible ? 'layerHide' : 'layerShow', { layer: t('titleMeasure') }),
      };
      badges.findings = {
        count: findingCount,
        visible: findingPinsVisible,
        onToggleVisible: onToggleFindingPins,
        toggleLabel: t(findingPinsVisible ? 'layerHide' : 'layerShow', { layer: t('titleFindings') }),
      };
    }
    if (isIfc) {
      badges.section = {
        count: sectionCount,
        visible: sectionEnabled,
        onToggleVisible: toggleSection,
        toggleLabel: t(sectionEnabled ? 'layerHide' : 'layerShow', { layer: t('titleSection') }),
      };
    }
    return badges;
  }, [
    isIfc, isPdf,
    measureCount, measureVisible, toggleMeasure,
    sectionCount, sectionEnabled, toggleSection,
    findingCount, findingPinsVisible, onToggleFindingPins,
    t,
  ]);
}
