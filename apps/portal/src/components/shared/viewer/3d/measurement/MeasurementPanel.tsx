'use client';

import { Crosshair, DraftingCompass, Ruler, Settings, Square } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useState, type JSX, type ReactNode,
} from 'react';

import {
  AppDialog, DialogField, DialogSection, Select, Slider, cn,
} from '@bimstitch/ui';
import type {
  Measurement, MeasurementConfig, MeasurementMode, ViewerHandle,
} from '@bimstitch/viewer';

import {
  MeasurementPanel as SharedMeasurementPanel,
  type MeasureModeDef,
} from '@/components/shared/viewer/measure/MeasurementPanel';

type Props = {
  handle: ViewerHandle | null;
};

const MODE_DEFS: MeasureModeDef[] = [
  { id: 'distance', labelKey: 'modeDistance', icon: Ruler },
  { id: 'angle', labelKey: 'modeAngle', icon: DraftingCompass },
  { id: 'area', labelKey: 'modeArea', icon: Square },
];

const HELP_KEYS: Record<MeasurementMode, string> = {
  distance: 'helpDistance',
  angle: 'helpAngle',
  area: 'helpArea',
  volume: 'helpVolume',
};

const AXIS_COLORS: Record<string, string> = {
  x: 'bg-red-500',
  y: 'bg-green-500',
  z: 'bg-blue-500',
};

function formatValue(m: Measurement): string {
  if (m.type === 'angle') return `${m.value.toFixed(1)}°`;
  if (m.type === 'area') {
    if (m.value < 0.01) return `${(m.value * 1e4).toFixed(1)} cm²`;
    return `${m.value.toFixed(3)} m²`;
  }
  if (m.type === 'volume') {
    if (m.value < 0.001) return `${(m.value * 1e6).toFixed(1)} cm³`;
    return `${m.value.toFixed(3)} m³`;
  }
  if (m.value < 0.01) return `${(m.value * 1000).toFixed(1)} mm`;
  if (m.value < 1) return `${(m.value * 1000).toFixed(0)} mm`;
  if (m.value < 100) return `${m.value.toFixed(3)} m`;
  return `${m.value.toFixed(1)} m`;
}

/**
 * 3D measurement panel — a thin wrapper over the shared {@link SharedMeasurementPanel}.
 * It supplies the 3D mode set, meters/m²/° formatting, the `mode:exit` event, and
 * the axis-lock badge; the snapping toggle + settings live in
 * {@link MeasurementHeaderActions} (rendered as the side-panel header action).
 */
export function MeasurementPanel({ handle }: Props): JSX.Element {
  const t = useTranslations('viewer.measurement');
  const [axisLock, setAxisLock] = useState<{ active: boolean; axis: string | null }>({
    active: false,
    axis: null,
  });

  useEffect(() => {
    if (!handle) return undefined;
    const offLock = handle.events.on(
      'measurement:axisLock',
      (d: { active: boolean; axis: string | null }) => { setAxisLock(d); },
    );
    const offExit = handle.events.on('mode:exit', () => { setAxisLock({ active: false, axis: null }); });
    return () => { offLock(); offExit(); };
  }, [handle]);

  const renderStatusExtra = useCallback((): ReactNode => {
    if (!axisLock.active || axisLock.axis === null) return null;
    return (
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white',
          AXIS_COLORS[axisLock.axis] ?? 'bg-foreground-secondary',
        )}
      >
        {axisLock.axis}-{t('lock')}
      </span>
    );
  }, [axisLock, t]);

  return (
    <SharedMeasurementPanel<Measurement>
      controller={handle}
      modes={MODE_DEFS}
      toListItem={(m) => ({ id: m.id, label: formatValue(m), type: m.type, visible: m.visible })}
      helpKeys={HELP_KEYS}
      modeExitEvent="mode:exit"
      clearCommand="measure.clear"
      renderStatusExtra={renderStatusExtra}
    />
  );
}

// ---- helpers ----

function hexFromNumber(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function numberFromHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

const PRECISION_OPTIONS = [
  { value: 0, label: '0 (1 m)' },
  { value: 1, label: '1 (1.2 m)' },
  { value: 2, label: '2 (1.23 m)' },
  { value: 3, label: '3 (1.234 m)' },
];

// ---- settings dialog ----

type SettingsDialogProps = {
  handle: ViewerHandle;
  open: boolean;
  onClose: () => void;
};

function MeasurementSettingsDialog({ handle, open, onClose }: SettingsDialogProps): JSX.Element {
  const t = useTranslations('viewer.measurement');
  const [cfg, setCfg] = useState<MeasurementConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    handle.commands
      .execute<MeasurementConfig>('measure.getConfig')
      .then((c) => { setCfg(c ?? null); })
      .catch(() => undefined);
  }, [handle, open]);

  const update = useCallback(
    (partial: Partial<MeasurementConfig>) => {
      setCfg((prev) => (prev ? { ...prev, ...partial } : prev));
      handle.commands.execute('measure.setConfig', partial).catch(() => undefined);
    },
    [handle],
  );

  if (!cfg) return <></>;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t('settingsTitle')}
      subtitle={t('settingsSubtitle')}
      width={400}
    >
      <div className="flex flex-col gap-5">
        <DialogSection title={t('sectionColors')}>
          <DialogField label={t('directLine')}>
            <input
              type="color"
              value={hexFromNumber(cfg.directColor)}
              onChange={(e) => { update({ directColor: numberFromHex(e.target.value) }); }}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label={t('xAxis')}>
            <input
              type="color"
              value={hexFromNumber(cfg.xColor)}
              onChange={(e) => { update({ xColor: numberFromHex(e.target.value) }); }}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label={t('yAxis')}>
            <input
              type="color"
              value={hexFromNumber(cfg.yColor)}
              onChange={(e) => { update({ yColor: numberFromHex(e.target.value) }); }}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label={t('zAxis')}>
            <input
              type="color"
              value={hexFromNumber(cfg.zColor)}
              onChange={(e) => { update({ zColor: numberFromHex(e.target.value) }); }}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
        </DialogSection>

        <DialogSection title={t('sectionAppearance')}>
          <DialogField label={t('showHeightHorizontal')}>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.showDecomposition}
              onClick={() => { update({ showDecomposition: !cfg.showDecomposition }); }}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
                cfg.showDecomposition ? 'bg-primary' : 'bg-border',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200',
                  cfg.showDecomposition ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </DialogField>

          <DialogField label={t('labelSize', { size: t(labelSizeKey(cfg.labelScale)) })}>
            <Slider
              min={0.5}
              max={2}
              step={0.1}
              value={cfg.labelScale}
              onChange={(e) => { update({ labelScale: parseFloat(e.target.value) }); }}
              className="w-full"
            />
          </DialogField>

          <DialogField label={t('dotSize', { size: t(dotSizeKey(cfg.dotScale)) })}>
            <Slider
              min={0.5}
              max={3}
              step={0.25}
              value={cfg.dotScale}
              onChange={(e) => { update({ dotScale: parseFloat(e.target.value) }); }}
              className="w-full"
            />
          </DialogField>
        </DialogSection>

        <DialogSection title={t('sectionPrecision')}>
          <DialogField label={t('decimalPlaces')}>
            <Select
              value={cfg.precision}
              onChange={(e) => { update({ precision: parseInt(e.target.value, 10) }); }}
              className="h-8 px-2 text-xs"
            >
              {PRECISION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </DialogField>
        </DialogSection>

        <DialogSection title={t('sectionSnapping')}>
          <DialogField
            label={t('snapThreshold', { value: cfg.snapThreshold })}
            hint={t('snapThresholdHint')}
          >
            <Slider
              min={5}
              max={40}
              step={1}
              value={cfg.snapThreshold}
              onChange={(e) => { update({ snapThreshold: parseInt(e.target.value, 10) }); }}
              className="w-full"
            />
          </DialogField>
        </DialogSection>
      </div>
    </AppDialog>
  );
}

function labelSizeKey(scale: number): string {
  if (scale <= 0.6) return 'sizeSmall';
  if (scale <= 1.1) return 'sizeMedium';
  if (scale <= 1.5) return 'sizeLarge';
  return 'sizeExtraLarge';
}

function dotSizeKey(scale: number): string {
  if (scale <= 0.6) return 'sizeSmall';
  if (scale <= 1.2) return 'sizeMedium';
  if (scale <= 2.0) return 'sizeLarge';
  return 'sizeExtraLarge';
}

// ---- header actions (snapping toggle + settings) ----

const headerBtnClass = 'inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-background hover:text-primary';

export function MeasurementHeaderActions({ handle }: { handle: ViewerHandle | null }): JSX.Element {
  const t = useTranslations('viewer.measurement');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(false);

  useEffect(() => {
    if (!handle) return undefined;
    handle.commands.execute<boolean>('snapping.isEnabled')
      .then((v) => { setSnappingEnabled(v ?? false); })
      .catch(() => undefined);

    const unsub = handle.events.on('snapping:change', (data: { enabled: boolean }) => {
      setSnappingEnabled(data.enabled);
    });
    return unsub;
  }, [handle]);

  if (!handle) return <></>;

  return (
    <>
      <button
        type="button"
        onClick={() => { handle.commands.execute('snapping.toggle').catch(() => undefined); }}
        title={t('snappingTooltip', { state: snappingEnabled ? t('snappingOn') : t('snappingOff') })}
        className={cn(
          headerBtnClass,
          snappingEnabled ? 'text-primary' : 'text-foreground-placeholder',
        )}
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => { setSettingsOpen(true); }}
        title={t('settings')}
        className={cn(headerBtnClass, 'text-foreground-placeholder')}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <MeasurementSettingsDialog handle={handle} open={settingsOpen} onClose={() => { setSettingsOpen(false); }} />
    </>
  );
}

// Keep backward compat export
export const MeasurementSettingsButton = MeasurementHeaderActions;
