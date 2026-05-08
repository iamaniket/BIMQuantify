'use client';

import { DraftingCompass, Eye, EyeOff, Plus, Ruler, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { cn } from '@bimstitch/ui';
import type { Measurement, MeasurementMode, ViewerHandle } from '@bimstitch/viewer';

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
          <p className="text-[11px] text-foreground-secondary">
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
