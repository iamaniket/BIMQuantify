'use client';

import { Box, Crosshair, DraftingCompass, Download, Eraser, Eye, EyeOff, Ruler, Settings, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { AppDialog, ConfirmDialog, DialogField, DialogSection, Select, cn } from '@bimstitch/ui';
import type { Measurement, MeasurementConfig, MeasurementMode, ViewerHandle } from '@bimstitch/viewer';

import { PanelEmptyState } from '../PanelEmptyState';

type Props = {
  handle: ViewerHandle | null;
};

const MODE_DEFS: Array<{ id: MeasurementMode; label: string; icon: typeof Ruler }> = [
  { id: 'distance', label: 'Distance', icon: Ruler },
  { id: 'angle', label: 'Angle', icon: DraftingCompass },
  { id: 'area', label: 'Area', icon: Square },
  { id: 'volume', label: 'Volume', icon: Box },
];

const HELP_TEXT: Record<MeasurementMode, string> = {
  distance: 'Click two points to measure distance',
  angle: 'Click three points to measure angle (2nd point is the vertex)',
  area: 'Click points to define a polygon, close near the first point or right-click to finish',
  volume: 'Click points for base polygon, close to finish, then click to set height',
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

function exportMeasurementsCSV(measurements: Measurement[]): void {
  const rows = [['Type', 'Value', 'Unit', 'Points']];
  for (const m of measurements) {
    const pts = m.points.map((p) => `(${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)})`).join(';');
    rows.push([m.type, String(m.value), m.unit, pts]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `measurements-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MeasurementPanel({ handle }: Props): JSX.Element {
  const [activeMode, setActiveMode] = useState<MeasurementMode | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [axisLock, setAxisLock] = useState<{ active: boolean; axis: string | null }>({ active: false, axis: null });
  const mountedRef = useRef(true);

  // Fetch existing measurements on mount
  useEffect(() => {
    mountedRef.current = true;
    if (!handle) return undefined;

    handle.commands.execute<Measurement[]>('measure.list')
      .then((list) => {
        if (mountedRef.current) setMeasurements(list ?? []);
      })
      .catch(() => undefined);

    return () => {
      mountedRef.current = false;
      handle.commands.execute('measure.deactivate').catch(() => undefined);
    };
  }, [handle]);

  // Subscribe to measurement events
  useEffect(() => {
    if (!handle) return undefined;

    const unsub = handle.events.on('measurement:change', () => {
      handle.commands
        .execute<Measurement[]>('measure.list')
        .then((list) => {
          if (mountedRef.current) setMeasurements(list ?? []);
        })
        .catch(() => undefined);
    });

    return unsub;
  }, [handle]);

  // Sync activeMode when edit mode exits (e.g. via ESC)
  useEffect(() => {
    if (!handle) return undefined;

    const unsub = handle.events.on('mode:exit', () => {
      if (mountedRef.current) {
        setActiveMode(null);
        setAxisLock({ active: false, axis: null });
      }
    });

    return unsub;
  }, [handle]);

  // Axis-lock indicator
  useEffect(() => {
    if (!handle) return undefined;

    const unsub = handle.events.on('measurement:axisLock', (data: { active: boolean; axis: string | null }) => {
      if (mountedRef.current) setAxisLock(data);
    });

    return unsub;
  }, [handle]);

  const switchMode = useCallback(
    (mode: MeasurementMode) => {
      if (!handle) return;
      if (activeMode === mode) {
        handle.commands.execute('measure.deactivate').catch(() => undefined);
        setActiveMode(null);
      } else {
        handle.commands
          .execute('measure.activate', { mode })
          .catch(() => undefined);
        setActiveMode(mode);
      }
    },
    [handle, activeMode],
  );

  const remove = useCallback(
    (id: string) => {
      if (!handle) return;
      handle.commands.execute('measure.remove', { id }).catch(() => undefined);
    },
    [handle],
  );

  const toggleVisibility = useCallback(
    (id: string, currentlyVisible: boolean) => {
      if (!handle) return;
      handle.commands
        .execute('measure.setVisible', { id, visible: !currentlyVisible })
        .catch(() => undefined);
    },
    [handle],
  );

  const cancelPending = useCallback(() => {
    if (!handle) return;
    handle.commands.execute('measure.cancelPending').catch(() => undefined);
  }, [handle]);

  const stopMeasuring = useCallback(() => {
    if (!handle) return;
    handle.commands.execute('measure.deactivate').catch(() => undefined);
    setActiveMode(null);
  }, [handle]);

  const clearAll = useCallback(() => {
    if (!handle) return;
    handle.commands.execute('measure.clear').catch(() => undefined);
    setShowClearConfirm(false);
  }, [handle]);

  return (
    <div className="flex h-full flex-col">
      {/* Mode toggle */}
      <div className="flex shrink-0 gap-1.5 border-b border-border px-3 py-2.5">
        {MODE_DEFS.map(({ id, label, icon: Icon }) => {
          const isActive = activeMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => switchMode(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary-lighter text-primary border border-primary-light shadow-sm'
                  : 'bg-background-secondary text-foreground-secondary border border-transparent shadow-sm hover:bg-primary/5 hover:text-primary hover:border-primary-light',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Measurement list */}
      <div className="min-h-0 flex-1 overflow-auto">
        {measurements.length === 0 ? (
          <PanelEmptyState
            icon={Ruler}
            message="Select a mode above to measure distances, angles, areas, or volumes"
          />
        ) : (
          <ul className="divide-y divide-border">
            {measurements.map((m) => {
              const Icon = m.type === 'angle' ? DraftingCompass : m.type === 'area' ? Square : m.type === 'volume' ? Box : Ruler;
              const isVisible = m.visible !== false;
              return (
                <li
                  key={m.id}
                  className={cn(
                    'group flex items-center gap-2.5 px-3 py-2 hover:bg-background-secondary/50',
                    !isVisible && 'opacity-40',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                  <span className="flex-1 truncate text-xs font-medium text-foreground">
                    {formatValue(m)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleVisibility(m.id, isVisible)}
                    title={isVisible ? 'Hide measurement' : 'Show measurement'}
                    className={cn(
                      'shrink-0 rounded p-0.5 transition-colors hover:!bg-background-tertiary',
                      isVisible
                        ? 'text-foreground-secondary/0 group-hover:text-foreground-secondary'
                        : 'text-foreground-secondary',
                    )}
                  >
                    {isVisible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    title="Remove measurement"
                    className="shrink-0 rounded p-1 text-foreground-secondary transition-colors hover:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-3 py-2">
        {activeMode !== null ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-body3 text-foreground-secondary">
              {HELP_TEXT[activeMode]}
            </p>
            {axisLock.active && axisLock.axis !== null && (
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white', AXIS_COLORS[axisLock.axis] ?? 'bg-foreground-secondary')}>
                {axisLock.axis}-Lock
              </span>
            )}
            <button
              type="button"
              onClick={cancelPending}
              title="Cancel pending points"
              className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={stopMeasuring}
              title="Stop measuring"
              className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-secondary"
            >
              Done
            </button>
          </div>
        ) : measurements.length > 0 ? (
          <div className="flex items-center gap-3 text-xs text-foreground-secondary">
            <span>{measurements.length} measurement{measurements.length !== 1 ? 's' : ''}</span>
            {measurements.some((m) => m.type === 'distance') && (
              <span className="flex items-center gap-1">
                <Ruler className="h-3 w-3" />
                {measurements.filter((m) => m.type === 'distance').length}
              </span>
            )}
            {measurements.some((m) => m.type === 'angle') && (
              <span className="flex items-center gap-1">
                <DraftingCompass className="h-3 w-3" />
                {measurements.filter((m) => m.type === 'angle').length}
              </span>
            )}
            {measurements.some((m) => m.type === 'area') && (
              <span className="flex items-center gap-1">
                <Square className="h-3 w-3" />
                {measurements.filter((m) => m.type === 'area').length}
              </span>
            )}
            {measurements.some((m) => m.type === 'volume') && (
              <span className="flex items-center gap-1">
                <Box className="h-3 w-3" />
                {measurements.filter((m) => m.type === 'volume').length}
              </span>
            )}
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              title="Clear all measurements"
              className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:text-error"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear all measurements"
        description={`This will remove all ${measurements.length} measurement${measurements.length !== 1 ? 's' : ''}. This cannot be undone.`}
        confirmLabel="Clear all"
        cancelLabel="Cancel"
        onConfirm={clearAll}
        variant="destructive"
        isPending={false}
        errorMessage={null}
      />
    </div>
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
  const [cfg, setCfg] = useState<MeasurementConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    handle.commands
      .execute<MeasurementConfig>('measure.getConfig')
      .then((c) => setCfg(c ?? null))
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
      title="Measurement Settings"
      subtitle="Configure how measurements appear in the viewer"
      width={400}
    >
      <div className="flex flex-col gap-5">
        <DialogSection title="Colors">
          <DialogField label="Direct line">
            <input
              type="color"
              value={hexFromNumber(cfg.directColor)}
              onChange={(e) => update({ directColor: numberFromHex(e.target.value) })}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label="X axis">
            <input
              type="color"
              value={hexFromNumber(cfg.xColor)}
              onChange={(e) => update({ xColor: numberFromHex(e.target.value) })}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label="Y axis">
            <input
              type="color"
              value={hexFromNumber(cfg.yColor)}
              onChange={(e) => update({ yColor: numberFromHex(e.target.value) })}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
          <DialogField label="Z axis">
            <input
              type="color"
              value={hexFromNumber(cfg.zColor)}
              onChange={(e) => update({ zColor: numberFromHex(e.target.value) })}
              className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
            />
          </DialogField>
        </DialogSection>

        <DialogSection title="Appearance">
          <DialogField label="Show height & horizontal">
            <button
              type="button"
              role="switch"
              aria-checked={cfg.showDecomposition}
              onClick={() => update({ showDecomposition: !cfg.showDecomposition })}
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

          <DialogField label={`Label size — ${labelSizeLabel(cfg.labelScale)}`}>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={cfg.labelScale}
              onChange={(e) => update({ labelScale: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </DialogField>

          <DialogField label={`Dot size — ${dotSizeLabel(cfg.dotScale)}`}>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.25"
              value={cfg.dotScale}
              onChange={(e) => update({ dotScale: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </DialogField>
        </DialogSection>

        <DialogSection title="Precision">
          <DialogField label="Decimal places">
            <Select
              value={cfg.precision}
              onChange={(e) => update({ precision: parseInt(e.target.value, 10) })}
              className="h-8 px-2 text-xs"
            >
              {PRECISION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </DialogField>
        </DialogSection>

        <DialogSection title="Snapping">
          <DialogField
            label={`Snap threshold — ${String(cfg.snapThreshold)}px`}
            hint="Pixel distance for snap detection"
          >
            <input
              type="range"
              min="5"
              max="40"
              step="1"
              value={cfg.snapThreshold}
              onChange={(e) => update({ snapThreshold: parseInt(e.target.value, 10) })}
              className="w-full accent-primary"
            />
          </DialogField>
        </DialogSection>
      </div>
    </AppDialog>
  );
}

function labelSizeLabel(scale: number): string {
  if (scale <= 0.6) return 'Small';
  if (scale <= 1.1) return 'Medium';
  if (scale <= 1.5) return 'Large';
  return 'Extra Large';
}

function dotSizeLabel(scale: number): string {
  if (scale <= 0.6) return 'Small';
  if (scale <= 1.2) return 'Medium';
  if (scale <= 2.0) return 'Large';
  return 'Extra Large';
}

// ---- header actions (snapping toggle + export + settings) ----

const headerBtnClass = 'inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-background hover:text-foreground';

export function MeasurementHeaderActions({ handle }: { handle: ViewerHandle | null }): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(false);

  useEffect(() => {
    if (!handle) return undefined;
    handle.commands.execute<boolean>('snapping.isEnabled')
      .then((v) => setSnappingEnabled(v ?? false))
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
        title={`Snapping (S) — ${snappingEnabled ? 'on' : 'off'}`}
        className={cn(
          headerBtnClass,
          snappingEnabled ? 'text-primary' : 'text-foreground-secondary',
        )}
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          handle.commands.execute<Measurement[]>('measure.list')
            .then((list) => { if (list && list.length > 0) exportMeasurementsCSV(list); })
            .catch(() => undefined);
        }}
        title="Export measurements as CSV"
        className={cn(headerBtnClass, 'text-foreground-secondary')}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Measurement settings"
        className={cn(headerBtnClass, 'text-foreground-secondary')}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <MeasurementSettingsDialog handle={handle} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

// Keep backward compat export
export const MeasurementSettingsButton = MeasurementHeaderActions;
