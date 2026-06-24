'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { CaretDownIcon, Crosshair, X } from '@bimstitch/ui/icons';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from 'react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@bimstitch/ui';
import { toast } from 'sonner';

import type {
  DocumentLoadedInfo,
  DocumentViewerHandle,
  ViewerHandle,
} from '@bimstitch/viewer';

import {
  ToolbarDivider,
  ToolbarGroup,
} from '@/components/shared/viewer/shared/_toolbarPrimitives';
import { useSheetCalibration } from '@/features/aligned-sheets/useSheetCalibration';
import { modelsWithVersionsKey } from '@/features/models/queryKeys';
import { useStoreys } from '@/features/storeys/useStoreys';
import { useFloorPlanData } from '@/features/viewer/2d/useFloorPlanData';
import { buildStoreyMembership } from '@/features/viewer/3d/minimap/storeyMembership';
import { useViewerBundle } from '@/features/viewer/shared/useViewerBundle';
import { listModelsWithVersions } from '@/lib/api/models';
import type { ModelWithVersions } from '@/lib/api/schemas';
import type { ModelMetadata } from '@/lib/api/viewerTypes';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

const DocumentViewer = dynamic(
  () => import('@bimstitch/viewer').then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Props = {
  projectId: string;
  /** The 3D model's API UUID — owns the storeys the sheet pins to. */
  planApiModelId: string | null;
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
  /** The 3D model's extraction metadata — for minimap calibration + storey isolation. */
  metadata: ModelMetadata | undefined;
  /** The 3D model's floor-plan artifact URL — supplies the plan axes for calibration. */
  floorPlansUrl: string | null;
  /** Leave calibration mode (e.g. to '2d' so the aligned sheet shows). */
  onExit: () => void;
};

/** Resolve a model's head ProjectFile id (restore pointer, else newest ready). */
function headFileId(model: ModelWithVersions): string | null {
  if (model.head_file_id) return model.head_file_id;
  const ready = model.versions
    .filter((v) => v.status === 'ready')
    .sort((a, b) => b.version_number - a.version_number);
  return ready[0]?.id ?? null;
}

/**
 * The right-hand pane of "calibration" view mode: a chosen PDF model rendered in
 * a DocumentViewer plus a launcher (PDF model · page · storey) and a stepper.
 * The 3D model stays live in the left pane (its `viewerHandle` is passed in), so
 * `useSheetCalibration` can arm guided picks on both surfaces and project the
 * model picks through `minimap.projectPoint`.
 */
export function CalibrationPane({
  projectId,
  planApiModelId,
  viewerHandle,
  viewerReady,
  metadata,
  floorPlansUrl,
  onExit,
}: Props): JSX.Element {
  const t = useTranslations('viewer');

  const modelsQuery = useAuthQuery({
    queryKey: modelsWithVersionsKey(projectId),
    queryFn: (token) => listModelsWithVersions(token, projectId),
    enabled: projectId.length > 0,
  });
  const pdfModels = useMemo(
    () => (modelsQuery.data ?? []).filter((m) => m.primary_file_type === 'pdf'),
    [modelsQuery.data],
  );

  const storeysQuery = useStoreys(projectId, planApiModelId ?? '');
  const storeys = useMemo(() => storeysQuery.data ?? [], [storeysQuery.data]);

  const [selectedPdfModelId, setSelectedPdfModelId] = useState<string | null>(null);
  const [selectedStoreyId, setSelectedStoreyId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [docHandle, setDocHandle] = useState<DocumentViewerHandle | null>(null);

  // Default the selections once data lands.
  useEffect(() => {
    if (selectedPdfModelId === null && pdfModels.length > 0) {
      setSelectedPdfModelId(pdfModels[0]!.id);
    }
  }, [pdfModels, selectedPdfModelId]);
  useEffect(() => {
    if (selectedStoreyId === null && storeys.length > 0) {
      setSelectedStoreyId(storeys[0]!.id);
    }
  }, [storeys, selectedStoreyId]);

  // Plan axes (for minimap calibration) + element→storey membership (for 3D
  // isolation). Both come from the 3D model's floor-plan artifact + metadata —
  // the SAME source the Split view uses, so the captured transform stays
  // consistent with how pins/markers are projected later.
  const levelFallback = useCallback((n: number) => String(n), []);
  const { planAxisX, planAxisY } = useFloorPlanData(floorPlansUrl, metadata, levelFallback);
  const storeyMembership = useMemo(() => buildStoreyMembership(metadata), [metadata]);
  const selectedStorey = useMemo(
    () => storeys.find((s) => s.id === selectedStoreyId) ?? null,
    [storeys, selectedStoreyId],
  );

  // Calibrate the minimap here too — in calibration mode neither the Split pane
  // nor the minimap pop-out is mounted, so without this `minimap.projectPoint`
  // returns null and every calibration fails with MINIMAP_NOT_CALIBRATED.
  const ifcBbox = metadata?.bbox;
  useEffect(() => {
    if (!viewerHandle || !viewerReady || !ifcBbox) return;
    void viewerHandle.commands
      .execute('minimap.calibrate', { ifcBbox, planAxisX, planAxisY })
      .catch(() => undefined);
  }, [viewerHandle, viewerReady, ifcBbox, planAxisX, planAxisY]);

  // Isolate the selected storey in 3D so only that floor's elements are pickable
  // — picking the matching model point is far easier without the other floors.
  // Restore the full model when the storey changes / the pane unmounts.
  useEffect(() => {
    if (!viewerHandle || !viewerReady) return undefined;
    const expressId = selectedStorey?.express_id;
    const localIds = expressId != null ? (storeyMembership.get(expressId) ?? []) : [];
    if (localIds.length > 0) {
      void viewerHandle.commands
        .execute('minimap.isolateItems', { localIds, label: selectedStorey?.name ?? null })
        .catch(() => undefined);
    } else {
      void viewerHandle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    }
    return () => {
      void viewerHandle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    };
  }, [viewerHandle, viewerReady, selectedStorey, storeyMembership]);

  const selectedModel = useMemo(
    () => pdfModels.find((m) => m.id === selectedPdfModelId) ?? null,
    [pdfModels, selectedPdfModelId],
  );
  const pdfFileId = selectedModel ? headFileId(selectedModel) : null;

  const bundleQuery = useViewerBundle(
    projectId,
    selectedPdfModelId ?? '',
    pdfFileId ?? '',
  );
  const fileUrl = bundleQuery.data?.file_url ?? null;

  const { step, errorCode, start, cancel } = useSheetCalibration({
    projectId,
    modelId: planApiModelId ?? '',
    storeyId: selectedStoreyId ?? '',
    pdfModelId: selectedPdfModelId ?? '',
    pageIndex,
    pdfFileId: pdfFileId ?? undefined,
    viewerHandle,
    documentHandle: docHandle,
    pickPdfMessage: t('aligned.pickPdf'),
    pickModelMessage: t('aligned.pickModel'),
  });

  // On success: toast + leave calibration to the 2D plan, which now shows the
  // freshly aligned sheet.
  useEffect(() => {
    if (step === 'done') {
      toast.success(t('aligned.step.done'));
      onExit();
    }
  }, [step, onExit, t]);

  const active = step !== 'idle' && step !== 'done' && step !== 'error';
  const ready =
    viewerReady &&
    docHandle !== null &&
    selectedStoreyId !== null &&
    selectedPdfModelId !== null;

  const stepLabel = ((): string | null => {
    switch (step) {
      case 'pdf-1':
        return t('aligned.step.pdf1');
      case 'model-1':
        return t('aligned.step.model1');
      case 'pdf-2':
        return t('aligned.step.pdf2');
      case 'model-2':
        return t('aligned.step.model2');
      case 'solving':
        return t('aligned.step.solving');
      default:
        return null;
    }
  })();

  const errorMessage =
    step === 'error'
      ? errorCode === 'MINIMAP_NOT_CALIBRATED'
        ? t('aligned.error.MINIMAP_NOT_CALIBRATED')
        : t('aligned.error.generic')
      : null;

  const onStart = useCallback(() => {
    void start();
  }, [start]);

  const pageOptions = useMemo(
    () => Array.from({ length: numPages ?? 1 }, (_, i) => i),
    [numPages],
  );

  const storeyLabel =
    storeys.find((s) => s.id === selectedStoreyId)?.name ?? t('aligned.pickStorey');
  const modelLabel = selectedModel?.name ?? t('aligned.pickPdfModel');

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-low" data-pick-block>
      {/* Launcher pill */}
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <ToolbarGroup className="gap-0.5">
          <Crosshair className="mx-1 h-3.5 w-3.5 text-foreground-tertiary" aria-hidden />
          <Dropdown label={modelLabel} disabled={active}>
            {pdfModels.map((m) => (
              <DropdownMenuItem key={m.id} onSelect={() => { setSelectedPdfModelId(m.id); }}>
                {m.name}
              </DropdownMenuItem>
            ))}
          </Dropdown>
          <ToolbarDivider />
          <Dropdown label={t('aligned.pickPage', { n: pageIndex + 1 })} disabled={active}>
            {pageOptions.map((i) => (
              <DropdownMenuItem key={i} onSelect={() => { setPageIndex(i); }}>
                {t('aligned.pickPage', { n: i + 1 })}
              </DropdownMenuItem>
            ))}
          </Dropdown>
          <ToolbarDivider />
          <Dropdown label={storeyLabel} disabled={active}>
            {storeys.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => { setSelectedStoreyId(s.id); }}>
                {s.name ?? s.id}
              </DropdownMenuItem>
            ))}
          </Dropdown>
          <ToolbarDivider />
          {active ? (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t('aligned.cancel')}
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" disabled={!ready} onClick={onStart}>
              {t('aligned.start')}
            </Button>
          )}
        </ToolbarGroup>
      </div>

      {/* Stepper / status banner */}
      {(stepLabel !== null || errorMessage !== null) && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md border border-border bg-surface-low px-3 py-1.5 text-caption font-medium shadow-md">
          {errorMessage !== null ? (
            <span className="text-danger">{errorMessage}</span>
          ) : (
            <span className="text-primary">{stepLabel}</span>
          )}
        </div>
      )}

      {/* Missing prerequisites hints */}
      {planApiModelId !== null && storeys.length === 0 && !storeysQuery.isLoading && (
        <div className="absolute inset-x-6 top-28 z-10 rounded-md border border-border bg-surface-low p-3 text-center text-caption text-foreground-secondary">
          {t('aligned.noStoreys')}
        </div>
      )}
      {pdfModels.length === 0 && !modelsQuery.isLoading && (
        <div className="absolute inset-x-6 top-40 z-10 rounded-md border border-border bg-surface-low p-3 text-center text-caption text-foreground-secondary">
          {t('aligned.noPdfModels')}
        </div>
      )}

      {/* PDF stage */}
      {fileUrl !== null ? (
        <DocumentViewer
          key={`${selectedPdfModelId ?? ''}:${pdfFileId ?? ''}`}
          ref={setDocHandle}
          fileUrl={fileUrl}
          currentPage={pageIndex + 1}
          className="absolute inset-0"
          onLoaded={(info: DocumentLoadedInfo) => { setNumPages(info.numPages); }}
        />
      ) : (
        <Skeleton className="absolute inset-0" />
      )}
    </div>
  );
}

/** Small dropdown trigger mirroring the FloorPlanPane level picker. */
function Dropdown({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 max-w-[160px] items-center gap-1 rounded-md px-2 text-caption font-medium text-foreground/80 hover:bg-foreground/[0.06] focus-visible:outline-none disabled:opacity-50"
        >
          <span className="truncate">{label}</span>
          <CaretDownIcon className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="max-h-60 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
