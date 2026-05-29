'use client';

import { Crosshair, Eraser, Eye, EyeOff, FlipVertical, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ConfirmDialog, cn } from '@bimstitch/ui';
import type { SectionPlane, ViewerHandle } from '@bimstitch/viewer';

import { PanelEmptyState } from '../PanelEmptyState';

type Props = {
  handle: ViewerHandle | null;
};

type PlaneExtent = { min: number; max: number; current: number };

const PRESET_NORMALS: Array<{ label: string; normal: { x: number; y: number; z: number }; colorClass: string }> = [
  { label: '+X', normal: { x: 1, y: 0, z: 0 }, colorClass: 'text-red-500' },
  { label: '+Y', normal: { x: 0, y: 1, z: 0 }, colorClass: 'text-green-500' },
  { label: '+Z', normal: { x: 0, y: 0, z: 1 }, colorClass: 'text-blue-500' },
];

function dominantAxisLabel(n: { x: number; y: number; z: number }): string {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax > ay && ax > az) return n.x > 0 ? '+X' : '-X';
  if (ay > ax && ay > az) return n.y > 0 ? '+Y' : '-Y';
  return n.z > 0 ? '+Z' : '-Z';
}

function dominantAxisColor(n: { x: number; y: number; z: number }): string {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax > ay && ax > az) return 'bg-red-500';
  if (ay > ax && ay > az) return 'bg-green-500';
  return 'bg-blue-500';
}

export function SectionPanel({ handle }: Props): JSX.Element {
  const t = useTranslations('viewer.section');
  const [planes, setPlanes] = useState<SectionPlane[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [extents, setExtents] = useState<Map<string, PlaneExtent>>(new Map());
  const mountedRef = useRef(true);

  const fetchPlanes = useCallback(() => {
    if (!handle) return;
    handle.commands.execute<SectionPlane[]>('section.list')
      .then((list) => {
        if (mountedRef.current) setPlanes(list ?? []);
      })
      .catch(() => undefined);
  }, [handle]);

  const fetchExtent = useCallback((id: string) => {
    if (!handle) return;
    handle.commands.execute<PlaneExtent | null>('section.getExtent', { id })
      .then((ext) => {
        if (mountedRef.current && ext) {
          setExtents((prev) => new Map(prev).set(id, ext));
        }
      })
      .catch(() => undefined);
  }, [handle]);

  useEffect(() => {
    mountedRef.current = true;
    fetchPlanes();
    return () => { mountedRef.current = false; };
  }, [fetchPlanes]);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('section:change', () => {
      fetchPlanes();
    });
  }, [handle, fetchPlanes]);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('section:select', ({ id }) => {
      if (mountedRef.current) setSelectedId(id);
    });
  }, [handle]);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('mode:exit', ({ toolName }) => {
      if (mountedRef.current && toolName.startsWith('section')) {
        setIsPlacing(false);
      }
    });
  }, [handle]);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.events.on('mode:enter', ({ toolName }) => {
      if (mountedRef.current && toolName === 'section.place') {
        setIsPlacing(true);
      }
    });
  }, [handle]);

  // Fetch extents whenever planes change — covers both new planes and moved planes.
  useEffect(() => {
    for (const p of planes) fetchExtent(p.id);
  }, [planes, fetchExtent]);

  const addPreset = useCallback((normal: { x: number; y: number; z: number }) => {
    if (!handle) return;
    handle.commands.execute('section.add', { normal }).catch(() => undefined);
  }, [handle]);

  const togglePlacement = useCallback(() => {
    if (!handle) return;
    if (isPlacing) {
      handle.commands.execute('section.deactivate').catch(() => undefined);
      setIsPlacing(false);
    } else {
      handle.commands.execute('section.activate').catch(() => undefined);
      setIsPlacing(true);
    }
  }, [handle, isPlacing]);

  const selectPlane = useCallback((id: string) => {
    if (!handle) return;
    handle.commands.execute('section.select', { id: selectedId === id ? null : id }).catch(() => undefined);
  }, [handle, selectedId]);

  const removePlane = useCallback((id: string) => {
    if (!handle) return;
    handle.commands.execute('section.remove', { id }).catch(() => undefined);
  }, [handle]);

  const flipPlane = useCallback((id: string) => {
    if (!handle) return;
    handle.commands.execute('section.flip', { id }).catch(() => undefined);
  }, [handle]);

  const toggleVisibility = useCallback((id: string) => {
    if (!handle) return;
    handle.commands.execute('section.toggle', { id }).catch(() => undefined);
  }, [handle]);

  const handleSlider = useCallback((id: string, value: number) => {
    if (!handle) return;
    const ext = extents.get(id);
    if (!ext) return;
    const offset = value - ext.current;
    handle.commands.execute('section.move', { id, offset }).catch(() => undefined);
    setExtents((prev) => new Map(prev).set(id, { ...ext, current: value }));
  }, [handle, extents]);

  const clearAll = useCallback(() => {
    if (!handle) return;
    handle.commands.execute('section.removeAll').catch(() => undefined);
    setShowClearConfirm(false);
  }, [handle]);

  return (
    <div className="flex h-full flex-col">
      {/* Preset buttons + placement toggle */}
      <div className="flex shrink-0 gap-1.5 border-b border-border px-3 py-2.5">
        {PRESET_NORMALS.map(({ label, normal, colorClass }) => (
          <button
            key={label}
            type="button"
            onClick={() => addPreset(normal)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-transparent bg-background-secondary px-2 py-1.5 text-xs font-medium text-foreground-secondary shadow-sm transition-all duration-150 hover:border-primary-light hover:bg-primary/5 hover:text-primary"
          >
            <span className={cn('text-[10px] font-bold', colorClass)}>{label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={togglePlacement}
          className={cn(
            'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150',
            isPlacing
              ? 'bg-primary-lighter text-primary border border-primary-light shadow-sm'
              : 'bg-background-secondary text-foreground-secondary border border-transparent shadow-sm hover:bg-primary/5 hover:text-primary hover:border-primary-light',
          )}
        >
          <Crosshair className="h-3.5 w-3.5" />
          Place
        </button>
      </div>

      {/* Plane list */}
      <div className="min-h-0 flex-1 overflow-auto">
        {planes.length === 0 ? (
          <PanelEmptyState
            icon={Crosshair}
            message="Add section planes using the buttons above or click surfaces in placement mode"
          />
        ) : (
          <ul className="divide-y divide-border">
            {planes.map((p, idx) => {
              const isSelected = selectedId === p.id;
              const ext = extents.get(p.id);
              return (
                <li key={p.id} className="px-3 py-2">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectPlane(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') selectPlane(p.id); }}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-primary-lighter border border-primary-light'
                        : 'hover:bg-background-secondary/50 border border-transparent',
                      !p.active && 'opacity-40',
                    )}
                  >
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', dominantAxisColor(p.normal))} />
                    <span className="flex-1 truncate text-xs font-medium text-foreground">
                      Plane {idx + 1}
                      <span className="ml-1.5 text-foreground-secondary">
                        {dominantAxisLabel(p.normal)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); flipPlane(p.id); }}
                      title="Flip direction"
                      className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:bg-background-tertiary"
                    >
                      <FlipVertical className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleVisibility(p.id); }}
                      title={p.active ? 'Hide plane' : 'Show plane'}
                      className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:bg-background-tertiary"
                    >
                      {p.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePlane(p.id); }}
                      title="Remove plane"
                      className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:text-error"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Position slider */}
                  {ext && (
                    <div className="mt-1.5 px-2">
                      <input
                        type="range"
                        min={ext.min}
                        max={ext.max}
                        step={(ext.max - ext.min) / 200}
                        value={ext.current}
                        onChange={(e) => handleSlider(p.id, Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-3 py-2">
        {isPlacing ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-body3 text-foreground-secondary">
              Click a surface to place a section plane
            </p>
            <button
              type="button"
              onClick={togglePlacement}
              className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-secondary"
            >
              Done
            </button>
          </div>
        ) : planes.length > 0 ? (
          <div className="flex items-center gap-3 text-xs text-foreground-secondary">
            <span>{planes.length} plane{planes.length !== 1 ? 's' : ''}</span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => { setShowClearConfirm(true); }}
              title="Clear all planes"
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
        title="Clear all section planes"
        description={`This will remove all ${planes.length} section plane${planes.length !== 1 ? 's' : ''}. This cannot be undone.`}
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
