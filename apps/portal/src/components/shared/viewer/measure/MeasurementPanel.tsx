'use client';

import { Box, DraftingCompass, Eraser, Eye, EyeOff, Ruler, Square, Trash2 } from '@bimdossier/ui/icons';
import { type AppIcon } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useRef, useState, type JSX, type ReactNode,
} from 'react';

import { ConfirmDialog, cn } from '@bimdossier/ui';
import type { MeasurementController } from '@bimdossier/viewer';

import { PanelButton } from '@/components/shared/viewer/shared/PanelButton';
import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelStatusStrip } from '@/components/shared/viewer/shared/PanelStatusStrip';
import { PanelButtonRow, PanelToolbar } from '@/components/shared/viewer/shared/PanelToolbar';

/** One measurement-mode toggle button. */
export type MeasureModeDef = {
  /** Command argument + icon key (e.g. 'distance'). */
  id: string;
  /** i18n key under `viewer.measurement` (e.g. 'modeDistance'). */
  labelKey: string;
  icon: AppIcon;
};

/** A row in the measurement list — already unit-formatted by the caller. */
export type MeasureListItem = {
  id: string;
  label: string;
  type: string;
  visible: boolean;
};

type Props<TRaw> = {
  controller: MeasurementController | null;
  modes: MeasureModeDef[];
  /** Map a raw `measure.list` entry to a display row (per-engine unit formatting). */
  toListItem: (raw: TRaw) => MeasureListItem;
  /** Per-mode help-text i18n keys under `viewer.measurement`. */
  helpKeys: Record<string, string>;
  /** Event name the engine fires when measurement mode exits. */
  modeExitEvent: string;
  /** Optional extra content in the active status strip (e.g. the 3D axis-lock badge). */
  renderStatusExtra?: (activeMode: string) => ReactNode;
  /** Command used by the "clear" affordance. Defaults to `measure.clear`. */
  clearCommand?: string;
};

const ICON_BY_TYPE: Record<string, AppIcon> = {
  distance: Ruler,
  angle: DraftingCompass,
  area: Square,
  volume: Box,
};

export function MeasurementPanel<TRaw>({
  controller,
  modes,
  toListItem,
  helpKeys,
  modeExitEvent,
  renderStatusExtra,
  clearCommand = 'measure.clear',
}: Props<TRaw>): JSX.Element {
  const t = useTranslations('viewer.measurement');
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [items, setItems] = useState<MeasureListItem[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const mountedRef = useRef(true);
  // Keep the latest mapper in a ref so the fetch effect needn't depend on it.
  const toListItemRef = useRef(toListItem);
  toListItemRef.current = toListItem;

  const refetch = useCallback(() => {
    if (!controller) return;
    controller.commands
      .execute<TRaw[]>('measure.list')
      .then((list) => {
        if (mountedRef.current) setItems((list ?? []).map(toListItemRef.current));
      })
      .catch(() => undefined);
  }, [controller]);

  // Initial fetch + deactivate-on-unmount (mirrors the 3D panel lifecycle).
  useEffect(() => {
    mountedRef.current = true;
    refetch();
    return () => {
      mountedRef.current = false;
      controller?.commands.execute('measure.deactivate').catch(() => undefined);
    };
  }, [controller, refetch]);

  // Re-pull the list whenever the engine signals a change.
  useEffect(() => {
    if (!controller) return undefined;
    return controller.events.on('measurement:change', refetch);
  }, [controller, refetch]);

  // Reset the active toggle when the engine exits measurement mode (e.g. Esc).
  useEffect(() => {
    if (!controller) return undefined;
    return controller.events.on(modeExitEvent, () => {
      if (mountedRef.current) setActiveMode(null);
    });
  }, [controller, modeExitEvent]);

  const switchMode = useCallback(
    (mode: string) => {
      if (!controller) return;
      if (activeMode === mode) {
        controller.commands.execute('measure.deactivate').catch(() => undefined);
        setActiveMode(null);
      } else {
        controller.commands.execute('measure.activate', { mode }).catch(() => undefined);
        setActiveMode(mode);
      }
    },
    [controller, activeMode],
  );

  const remove = useCallback(
    (id: string) => { controller?.commands.execute('measure.remove', { id }).catch(() => undefined); },
    [controller],
  );

  const toggleVisibility = useCallback(
    (id: string, currentlyVisible: boolean) => {
      controller?.commands
        .execute('measure.setVisible', { id, visible: !currentlyVisible })
        .catch(() => undefined);
    },
    [controller],
  );

  const cancelPending = useCallback(() => {
    controller?.commands.execute('measure.cancelPending').catch(() => undefined);
  }, [controller]);

  const stopMeasuring = useCallback(() => {
    controller?.commands.execute('measure.deactivate').catch(() => undefined);
    setActiveMode(null);
  }, [controller]);

  const clearAll = useCallback(() => {
    controller?.commands.execute(clearCommand).catch(() => undefined);
    setShowClearConfirm(false);
  }, [controller, clearCommand]);

  const extra = activeMode !== null ? renderStatusExtra?.(activeMode) : null;

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <PanelButtonRow>
          {modes.map(({ id, labelKey, icon: Icon }) => (
            <PanelButton
              key={id}
              segmented
              active={activeMode === id}
              onClick={() => { switchMode(id); }}
              icon={<Icon className="h-3.5 w-3.5" />}
            >
              {t(labelKey)}
            </PanelButton>
          ))}
        </PanelButtonRow>
      </PanelToolbar>

      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <PanelEmptyState icon={Ruler} message={t('emptyMessage')} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((m) => {
              const Icon = ICON_BY_TYPE[m.type] ?? Ruler;
              return (
                <li
                  key={m.id}
                  className={cn(
                    'group flex items-center gap-2.5 px-3 py-2 hover:bg-background-secondary/50',
                    !m.visible && 'opacity-40',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
                  <span className="flex-1 truncate text-xs font-medium text-foreground">{m.label}</span>
                  <button
                    type="button"
                    onClick={() => { toggleVisibility(m.id, m.visible); }}
                    title={m.visible ? t('hide') : t('show')}
                    className={cn(
                      'shrink-0 rounded p-0.5 transition-colors hover:!bg-background-tertiary',
                      m.visible
                        ? 'text-foreground-secondary/0 group-hover:text-foreground-secondary'
                        : 'text-foreground-secondary',
                    )}
                  >
                    {m.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { remove(m.id); }}
                    title={t('remove')}
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

      {activeMode !== null && (
        <PanelStatusStrip
          tone="active"
          right={(
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={cancelPending}
                title={t('cancelPending')}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-hover"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={stopMeasuring}
                title={t('stop')}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:bg-background-hover"
              >
                {t('done')}
              </button>
            </span>
          )}
        >
          <span className="truncate">{t(helpKeys[activeMode] ?? 'helpDistance')}</span>
          {extra}
        </PanelStatusStrip>
      )}
      {activeMode === null && items.length > 0 && (
        <PanelStatusStrip
          tone="idle"
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
          <span className="font-semibold text-foreground-secondary">{t('count', { count: items.length })}</span>
          {(['distance', 'angle', 'area', 'volume'] as const).map((type) => {
            const n = items.filter((m) => m.type === type).length;
            if (n === 0) return null;
            const Icon = ICON_BY_TYPE[type] ?? Ruler;
            return (
              <span key={type} className="ml-2 flex items-center gap-1">
                <Icon className="h-3 w-3" />
                {n}
              </span>
            );
          })}
        </PanelStatusStrip>
      )}
      {activeMode === null && items.length === 0 && (
        <PanelStatusStrip tone="idle" right={t('savedCount', { count: 0 })}>
          <span className="font-semibold text-foreground-secondary">{t('statusReady')}</span>
          <span className="text-foreground-tertiary">· {t('statusNoActive')}</span>
        </PanelStatusStrip>
      )}

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title={t('clearAll')}
        description={t('clearConfirmDescription', { count: items.length })}
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
