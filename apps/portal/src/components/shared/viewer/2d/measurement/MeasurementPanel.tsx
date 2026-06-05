'use client';

import { DraftingCompass, Ruler, Square } from '@bimstitch/ui/icons';
import type { JSX } from 'react';

import type { DocumentViewerHandle, PdfMeasurement } from '@bimstitch/viewer';

import {
  MeasurementPanel as SharedMeasurementPanel,
  type MeasureModeDef,
} from '@/components/shared/viewer/measure/MeasurementPanel';

const MODE_DEFS: MeasureModeDef[] = [
  { id: 'distance', labelKey: 'modeDistance', icon: Ruler },
  { id: 'angle', labelKey: 'modeAngle', icon: DraftingCompass },
  { id: 'area', labelKey: 'modeArea', icon: Square },
];

const HELP_KEYS: Record<string, string> = {
  distance: 'helpDistance',
  angle: 'helpAngle',
  area: 'helpArea',
};

type Props = {
  handle: DocumentViewerHandle | null;
};

/**
 * 2D (PDF) measurement panel — a thin wrapper over the shared
 * {@link SharedMeasurementPanel}. Measurements are in raw PDF points, so the
 * plugin already carries a pre-formatted `label`; the mapper is the identity.
 */
export function PdfMeasurementPanel({ handle }: Props): JSX.Element {
  return (
    <SharedMeasurementPanel<PdfMeasurement>
      controller={handle}
      modes={MODE_DEFS}
      toListItem={(m) => ({ id: m.id, label: m.label, type: m.type, visible: m.visible })}
      helpKeys={HELP_KEYS}
      modeExitEvent="measure:modeExit"
      clearCommand="measure.clear"
    />
  );
}
