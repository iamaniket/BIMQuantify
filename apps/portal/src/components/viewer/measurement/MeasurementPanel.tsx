'use client';

import { DraftingCompass, Eye, EyeOff, Ruler, Settings, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { AppDialog, DialogField, DialogSection, cn } from '@bimstitch/ui';
import type { Measurement, MeasurementConfig, MeasurementMode, ViewerHandle } from '@bimstitch/viewer';

import { PanelEmptyState } from '../PanelEmptyState';

type Props = {
  handle: ViewerHandle | null;
};

const MODE_DEFS: Array<{ id: MeasurementMode; label: string; icon: typeof Ruler }> = [
  { id: 'distance', label: 'Distance', icon: Ruler },
  { id: 'angle', label: 'Angle', icon: DraftingCompass },
];

function formatValue(m: Measurement): string {
  if (m.type === 'angle') return `${m.value.toFixed(1)}°`;
  if (m.value < 0.01) return `${(m.value * 1000).toFixed(1)} mm`;
  if (m.value < 1) return `${(m.value * 1000).toFixed(0)} mm`;
  if (m.value < 100) return `${m.value.toFixed(3)} m`;
  return `${m.value.toFixed(1)} m`;
}

export function MeasurementPanel({ handle }: Props): JSX.Element {
  const [activeMode, setActiveMode] = useState<MeasurementMode | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
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
      if (mountedRef.current) setActiveMode(null);
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

  const clearAll = useCallback(() => {
    if (!handle) return;
    handle.commands.execute('measure.clear').catch(() => undefined);
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
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background-secondary text-foreground-secondary hover:bg-primary/5 hover:text-primary',
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
            message="Click points in the viewer to measure distances or angles"
          />
        ) : (
          <ul className="divide-y divide-border">
            {measurements.map((m) => {
              const Icon = m.type === 'angle' ? DraftingCompass : Ruler;
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
                    className="shrink-0 rounded p-1 text-foreground-secondary/0 transition-colors group-hover:text-foreground-secondary hover:!text-error"
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
        {activeMode !== null && (
          <p className="text-body3 text-foreground-secondary">
            {activeMode === 'distance'
              ? 'Click two points to measure distance'
              : 'Click three points to measure angle (2nd point is the vertex)'}
          </p>
        )}
        {activeMode === null && measurements.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-foreground-secondary transition-colors hover:text-error"
          >
            Clear all
          </button>
        )}
      </div>
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
            <select
              value={cfg.precision}
              onChange={(e) => update({ precision: parseInt(e.target.value, 10) })}
              className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
            >
              {PRECISION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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

// ---- settings button (for header) ----

export function MeasurementSettingsButton({ handle }: { handle: ViewerHandle | null }): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!handle) return <></>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Measurement settings"
        className="inline-flex h-8 w-8 items-center justify-center rounded text-foreground-secondary transition-colors hover:bg-background hover:text-foreground"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <MeasurementSettingsDialog handle={handle} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
