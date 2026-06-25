'use client';

import { useCallback, useRef, useState } from 'react';

import type { DocumentViewerHandle, ViewerHandle } from '@bimdossier/viewer';

import { ApiError } from '@/lib/api/client';

import { useCalibrateAlignedSheet, useCreateAlignedSheet } from './hooks';

/**
 * Drives the manual 2-point sheet-alignment capture, mirroring the proven
 * `FindingPinButton` guided-pick pattern:
 *
 *   for each of 2 control points:
 *     arm a 2D pick on the PDF  → `interaction:resolved { kind:'page' }`  (u,v)
 *     arm a 3D pick on the model → `interaction:resolved { kind:'point' }` (world)
 *     project the world point to PLAN space via `minimap.projectPoint`
 *   POST the 2 pdf + 2 plan points to `/calibrate` (server solves the similarity)
 *
 * It captures in *plan* space (not PDF space): `minimap.setSheetTransform(null)`
 * is forced first so `projectPoint` returns raw plan coords. The PDF picks stay
 * raw normalized page coords — the same space the rendered markers/pose use, so
 * no flip is introduced here (capture and render share one convention).
 *
 * String-agnostic: the caller passes already-translated banner messages.
 */
export type CalibrationStep =
  | 'idle'
  | 'pdf-1'
  | 'model-1'
  | 'pdf-2'
  | 'model-2'
  | 'solving'
  | 'done'
  | 'error';

type PagePick = { x: number; y: number; page: number };
type WorldPick = { x: number; y: number; z: number };
type PlanPick = { x: number; y: number; elevation: number };
type Point2 = [number, number];

export type UseSheetCalibrationArgs = {
  projectId: string;
  /** The 3D model (supplies world coords to calibrate against). */
  modelId: string;
  /** The project Level the sheet pins to. */
  levelId: string;
  /** The PDF model whose page is aligned. */
  pdfModelId: string;
  pageIndex: number;
  /** The exact rendered PDF version (drift detection). */
  pdfFileId?: string | undefined;
  /** Reuse an existing (uncalibrated) sheet instead of creating one. */
  existingSheetId?: string | undefined;
  viewerHandle: ViewerHandle | null;
  documentHandle: DocumentViewerHandle | null;
  /** Already-translated banner strings for the two pick surfaces. */
  pickPdfMessage: string;
  pickModelMessage: string;
};

export type UseSheetCalibrationResult = {
  step: CalibrationStep;
  errorCode: string | null;
  /** Run the full 4-pick capture + solve. No-op if already running or unready. */
  start: () => Promise<void>;
  /** Abort an in-flight capture (cancels the active guided pick). */
  cancel: () => void;
};

function awaitPagePick(
  handle: DocumentViewerHandle,
  message: string,
  registerCancel: (fn: () => void) => void,
): Promise<PagePick | null> {
  return new Promise((resolve) => {
    const offResolved = handle.events.on('interaction:resolved', (evt) => {
      if (evt.kind !== 'page') return;
      cleanup();
      resolve({ x: evt.x, y: evt.y, page: evt.page });
    });
    const offCancelled = handle.events.on('interaction:cancelled', () => {
      cleanup();
      resolve(null);
    });
    function cleanup(): void {
      offResolved();
      offCancelled();
    }
    registerCancel(() => {
      cleanup();
      void handle.commands.execute('interaction.cancel').catch(() => undefined);
      resolve(null);
    });
    void handle.commands.execute('interaction.request', { message, placeType: 'finding' });
  });
}

function awaitModelPick(
  handle: ViewerHandle,
  message: string,
  registerCancel: (fn: () => void) => void,
): Promise<WorldPick | null> {
  return new Promise((resolve) => {
    const offResolved = handle.events.on('interaction:resolved', (evt) => {
      if (evt.kind !== 'point') return;
      cleanup();
      resolve(evt.point);
    });
    const offCancelled = handle.events.on('interaction:cancelled', () => {
      cleanup();
      resolve(null);
    });
    function cleanup(): void {
      offResolved();
      offCancelled();
    }
    registerCancel(() => {
      cleanup();
      void handle.commands.execute('interaction.cancel').catch(() => undefined);
      resolve(null);
    });
    void handle.commands.execute('interaction.request', { message });
  });
}

export function useSheetCalibration(
  args: UseSheetCalibrationArgs,
): UseSheetCalibrationResult {
  const {
    projectId,
    modelId,
    levelId,
    pdfModelId,
    pageIndex,
    pdfFileId,
    existingSheetId,
    viewerHandle,
    documentHandle,
    pickPdfMessage,
    pickModelMessage,
  } = args;

  const [step, setStep] = useState<CalibrationStep>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const createSheet = useCreateAlignedSheet();
  const calibrate = useCalibrateAlignedSheet();

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    runningRef.current = false;
    setStep('idle');
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current || !viewerHandle || !documentHandle) return;
    runningRef.current = true;
    setErrorCode(null);

    // Capture in plan space: clear any active sheet transform so projectPoint
    // returns raw plan coords (not PDF coords).
    await viewerHandle.commands.execute('minimap.setSheetTransform', null).catch(() => undefined);

    const pdfPoints: Point2[] = [];
    const planPoints: Point2[] = [];
    const setCancel = (fn: () => void): void => {
      cancelRef.current = fn;
    };

    try {
      for (let i = 0; i < 2; i += 1) {
        setStep(i === 0 ? 'pdf-1' : 'pdf-2');
        const pdf = await awaitPagePick(documentHandle, pickPdfMessage, setCancel);
        if (!pdf) {
          runningRef.current = false;
          setStep('idle');
          return;
        }

        setStep(i === 0 ? 'model-1' : 'model-2');
        const world = await awaitModelPick(viewerHandle, pickModelMessage, setCancel);
        if (!world) {
          runningRef.current = false;
          setStep('idle');
          return;
        }

        const plan = await viewerHandle.commands
          .execute<PlanPick | null>('minimap.projectPoint', world)
          .catch(() => null);
        if (!plan) {
          // The minimap isn't calibrated → can't project. Surface, don't crash.
          runningRef.current = false;
          setErrorCode('MINIMAP_NOT_CALIBRATED');
          setStep('error');
          return;
        }

        pdfPoints.push([pdf.x, pdf.y]);
        planPoints.push([plan.x, plan.y]);
      }

      setStep('solving');
      const sheetId =
        existingSheetId ??
        (
          await createSheet.mutateAsync({
            projectId,
            input: {
              document_id: modelId,
              level_id: levelId,
              pdf_document_id: pdfModelId,
              page_index: pageIndex,
            },
          })
        ).id;

      await calibrate.mutateAsync({
        projectId,
        sheetId,
        input: {
          pdf_points: pdfPoints,
          plan_points: planPoints,
          ...(pdfFileId !== undefined ? { pdf_file_id: pdfFileId } : {}),
        },
      });
      runningRef.current = false;
      cancelRef.current = null;
      setStep('done');
    } catch (err) {
      runningRef.current = false;
      cancelRef.current = null;
      setErrorCode(err instanceof ApiError ? (err.code ?? 'CALIBRATE_FAILED') : 'CALIBRATE_FAILED');
      setStep('error');
    }
  }, [
    viewerHandle,
    documentHandle,
    pickPdfMessage,
    pickModelMessage,
    existingSheetId,
    createSheet,
    calibrate,
    projectId,
    modelId,
    levelId,
    pdfModelId,
    pageIndex,
    pdfFileId,
  ]);

  return { step, errorCode, start, cancel };
}
