'use client';

import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';
import type { ViewerBundle, ViewerHandle } from '@bimstitch/viewer';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { federatedModelId } from '@/features/viewer/3d/federation/federatedModelId';
import { ModelLayersPanel } from '@/features/viewer/3d/federation/ModelLayersPanel';
import { MinimapView } from '@/features/viewer/3d/minimap/MinimapView';
import { useModelMetadata } from '@/features/viewer/3d/useModelMetadata';
import { viewerKeys } from '@/features/viewer/shared/queryKeys';
import { getProjectViewerBundle } from '@/lib/api/projectFiles';
import type { ProjectViewerModelEntry } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

// WASM-dependent; must load client-only.
const IfcViewer = dynamic(() => import('@bimstitch/viewer').then((m) => m.IfcViewer), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

function entryToBundle(entry: ProjectViewerModelEntry): ViewerBundle {
  // The manifest only includes entries with a fragments artifact.
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

/**
 * Federated multi-discipline viewer: loads every ready IFC model of a project
 * into one 3D scene. The architectural model supplies the 2D floor plan (the
 * other disciplines overlay in 3D); a layer panel toggles each on/off.
 */
export default function FederatedViewerPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const locale = useLocale();
  const t = useTranslations('viewer.federated');
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const query = useQuery({
    queryKey: viewerKeys.projectBundle(projectId),
    enabled: accessToken !== null,
    queryFn: () => getProjectViewerBundle(accessToken!, projectId),
  });

  const models = useMemo<ProjectViewerModelEntry[]>(
    () => query.data?.models ?? [],
    [query.data],
  );

  // Primary model frames the scene + anchors the cache; prefer the model that
  // supplies the 2D plan — architectural first, then mixed (also arch-bearing),
  // else the first model.
  const primaryIndex = useMemo(() => {
    const arch = models.findIndex((m) => m.detected_kind === 'architectural');
    if (arch >= 0) return arch;
    const mixed = models.findIndex((m) => m.detected_kind === 'mixed');
    return mixed >= 0 ? mixed : 0;
  }, [models]);
  const primary = models[primaryIndex] ?? null;

  const bundle = useMemo(
    () => (primary ? entryToBundle(primary) : null),
    [primary],
  );
  const additionalBundles = useMemo(
    () => models.filter((_, i) => i !== primaryIndex).map(entryToBundle),
    [models, primaryIndex],
  );

  // 2D floor plan source: the architectural entry that actually has a plan
  // artifact (MEP/structural models are 3D-only — no floor plan generated).
  const planEntry = useMemo(
    () =>
      models.find((m) => m.detected_kind === 'architectural' && m.floor_plans_url) ??
      models.find((m) => m.floor_plans_url !== null) ??
      null,
    [models],
  );
  const { data: planMetadata } = useModelMetadata(planEntry?.metadata_url ?? null);

  // --- conditional rendering (all hooks above) ---
  if (query.isLoading || accessToken === null) {
    return <Skeleton className="h-full w-full" />;
  }
  if (query.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorBanner message={t('loadError')} />
      </div>
    );
  }
  if (bundle === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-body2 font-semibold text-foreground">{t('empty')}</p>
        <p className="max-w-sm text-body3 text-foreground-secondary">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <IfcViewer
        ref={viewerHandleRef}
        bundle={bundle}
        additionalBundles={additionalBundles}
        className="absolute inset-0"
        viewCube={{ enabled: true, locale: locale as 'en' | 'nl' }}
        outline={{ enabled: true }}
        shadows={{ enabled: true }}
        onReady={(handle) => {
          viewerHandleRef.current = handle;
          setViewerReady(true);
        }}
      />
      <ModelLayersPanel
        handle={viewerHandleRef.current}
        models={models}
        viewerReady={viewerReady}
      />
      {planEntry?.floor_plans_url ? (
        <MinimapView
          handle={viewerHandleRef.current}
          viewerReady={viewerReady}
          floorPlansUrl={planEntry.floor_plans_url}
          metadata={planMetadata}
          planModelId={federatedModelId(planEntry.file_id)}
          variant="overlay"
        />
      ) : null}
    </div>
  );
}
