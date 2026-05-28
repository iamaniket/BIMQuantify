'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Loader2, MousePointerClick } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { getElementInspections } from '@/lib/api/elementInspections.js';
import type { ModelMetadata, ElementEntry } from '@/lib/api/viewerTypes';
import { useAuth } from '@/providers/AuthProvider';
import {
  useViewerEntityStore,
  parseEntityKey,
  toEntityKey,
} from '@/stores/viewerEntityStore';
import { viewerKeys } from '@/features/viewer/queryKeys.js';

import { InspectionItemRow } from './InspectionItemRow.js';

type InspectionsPanelProps = {
  metadata: ModelMetadata | undefined;
  projectId: string;
  fileId: string;
};

export function InspectionsPanel({
  metadata,
  projectId,
  fileId,
}: InspectionsPanelProps): JSX.Element {
  const t = useTranslations('viewerInspections');
  const { tokens } = useAuth();
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const modelId = useViewerEntityStore((s) => s.modelId);

  // Build expressID -> ElementEntry lookup (same pattern as PropertiesPanel).
  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  // Resolve the single selected element to its globalId.
  const selectedElement = useMemo((): ElementEntry | null => {
    if (selectedAll || selected.size !== 1) return null;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return null;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return null;
    return elementsByExpressId.get(parsed.localId) ?? null;
  }, [selected, selectedAll, elementsByExpressId]);

  const globalId = selectedElement?.globalId ?? null;
  const accessToken = tokens?.access_token ?? null;

  const { data, isLoading } = useQuery({
    queryKey: viewerKeys.elementInspections(projectId, fileId, globalId ?? ''),
    queryFn: () => {
      if (accessToken === null || globalId === null) {
        throw new Error('Missing auth or globalId');
      }
      return getElementInspections(accessToken, projectId, fileId, globalId);
    },
    enabled: accessToken !== null && globalId !== null,
    staleTime: 30_000,
  });

  // Reverse navigation: clicking a row re-selects the element in the viewer.
  const handleItemClick = useMemo(() => {
    if (globalId === null || modelId === null || !metadata?.elements) {
      return undefined;
    }
    // Find the expressID for the current globalId.
    const entry = metadata.elements.find((e) => e.globalId === globalId);
    if (!entry) return undefined;
    const key = toEntityKey(modelId, entry.expressID);
    return () => {
      useViewerEntityStore.getState().select([key]);
    };
  }, [globalId, modelId, metadata]);

  // --- Render states ---

  if (selected.size === 0 && !selectedAll) {
    return (
      <PanelEmptyState icon={MousePointerClick} message={t('emptyNoSelection')} />
    );
  }

  if (selectedAll || selected.size > 1) {
    return (
      <PanelEmptyState icon={ClipboardCheck} message={t('emptyMultiSelection')} />
    );
  }

  if (globalId === null) {
    return (
      <PanelEmptyState icon={ClipboardCheck} message={t('emptyNoItems')} />
    );
  }

  if (isLoading) {
    return <PanelEmptyState icon={Loader2} message={t('loading')} />;
  }

  if (!data || data.items.length === 0) {
    return (
      <PanelEmptyState icon={ClipboardCheck} message={t('emptyNoItems')} />
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-1.5">
      {data.items.map((item) => (
        <InspectionItemRow
          key={item.checklist_item.id}
          item={item}
          onClick={handleItemClick}
        />
      ))}
    </div>
  );
}
