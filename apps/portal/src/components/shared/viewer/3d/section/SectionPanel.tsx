'use client';

import { Crosshair, Eraser, Eye, EyeOff, FlipVertical, Move, RotateCw, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useRef, useState, type JSX,
} from 'react';

import { ConfirmDialog, cn } from '@bimstitch/ui';
import type { SectionPlane, ViewerHandle } from '@bimstitch/viewer';

import { PanelButton } from '@/components/shared/viewer/shared/PanelButton';
import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelStatusStrip } from '@/components/shared/viewer/shared/PanelStatusStrip';
import { PanelButtonRow, PanelToolbar } from '@/components/shared/viewer/shared/PanelToolbar';

type Props = {
  handle: ViewerHandle | null;
};

type PlaneExtent = { min: number; max: number; current: number };

type PresetNormal = {
  label: string;
  normal: { x: number; y: number; z: number };
  colorClass: string;
};

const PRESET_NORMALS: PresetNormal[] = [
  { label: '+X', normal: { x: 1, y: 0, z: 0 }, colorClass: 'text-red-300' },
  { label: '+Y', normal: { x: 0, y: 1, z: 0 }, colorClass: 'text-green-300' },
  { label: '+Z', normal: { x: 0, y: 0, z: 1 }, colorClass: 'text-blue-200' },
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
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');
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

  const setGizmo = useCallback((mode: 'translate' | 'rotate') => {
    if (!handle) return;
    setGizmoMode(mode);
    handle.commands.execute('section.setGizmoMode', { mode }).catch(() => undefined);
  }, [handle]);

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
      <PanelToolbar>
        <PanelButtonRow>
          {PRESET_NORMALS.map(({ label, normal, colorClass }) => (
            <PanelButton
              key={label}
              segmented
              onClick={() => { addPreset(normal); }}
              title={t('addPreset', { axis: label })}
            >
              <span className={cn('font-extrabold', colorClass)}>{label}</span>
            </PanelButton>
          ))}
          <PanelButton
            active={isPlacing}
            onClick={togglePlacement}
            icon={<Crosshair className="h-3.5 w-3.5" />}
          >
            {t('place')}
          </PanelButton>
        </PanelButtonRow>
        {selectedId && (
          <PanelButtonRow>
            <PanelButton
              segmented
              active={gizmoMode === 'translate'}
              onClick={() => { setGizmo('translate'); }}
              icon={<Move className="h-3.5 w-3.5" />}
            >
              {t('move')}
            </PanelButton>
            <PanelButton
              segmented
              active={gizmoMode === 'rotate'}
              onClick={() => { setGizmo('rotate'); }}
              icon={<RotateCw className="h-3.5 w-3.5" />}
            >
              {t('rotate')}
            </PanelButton>
          </PanelButtonRow>
        )}
      </PanelToolbar>

      {/* Plane list */}
      <div className="min-h-0 flex-1 overflow-auto">
        {planes.length === 0 ? (
          <PanelEmptyState
            icon={Crosshair}
            message={t('emptyMessage')}
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
                    onClick={() => { selectPlane(p.id); }}
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
                      {t('planeLabel', { index: idx + 1 })}
                      <span className="ml-1.5 text-foreground-secondary">
                        {dominantAxisLabel(p.normal)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); flipPlane(p.id); }}
                      title={t('flip')}
                      className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:bg-background-tertiary"
                    >
                      <FlipVertical className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleVisibility(p.id); }}
                      title={p.active ? t('hide') : t('show')}
                      className="shrink-0 rounded p-0.5 text-foreground-secondary transition-colors hover:bg-background-tertiary"
                    >
                      {p.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePlane(p.id); }}
                      title={t('remove')}
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
                        onChange={(e) => { handleSlider(p.id, Number(e.target.value)); }}
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

      {/* Footer status strip */}
      {isPlacing && (
        <PanelStatusStrip
          tone="active"
          right={(
            <button
              type="button"
              onClick={togglePlacement}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-hover"
            >
              {t('done')}
            </button>
          )}
        >
          <span className="truncate">{t('placeHint')}</span>
        </PanelStatusStrip>
      )}
      {!isPlacing && planes.length > 0 && (
        <PanelStatusStrip
          tone="active"
          right={(
            <button
              type="button"
              onClick={() => { setShowClearConfirm(true); }}
              title={t('clearAll')}
              className="rounded p-0.5 text-foreground-secondary transition-colors hover:text-error"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        >
          <span className="font-semibold text-foreground-secondary">{t('statusPlanes', { count: planes.length })}</span>
          <span className="text-foreground-tertiary">· {t('clippingOn')}</span>
        </PanelStatusStrip>
      )}
      {!isPlacing && planes.length === 0 && (
        <PanelStatusStrip tone="idle" right={t('clippingOff')}>
          <span className="font-semibold text-foreground-secondary">{t('statusPlanes', { count: 0 })}</span>
        </PanelStatusStrip>
      )}

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title={t('clearConfirmTitle')}
        description={t('clearConfirmDescription', { count: planes.length })}
        confirmLabel={t('clearConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={clearAll}
        variant="destructive"
        isPending={false}
        errorMessage={null}
      />
    </div>
  );
}
