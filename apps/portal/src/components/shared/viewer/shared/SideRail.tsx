'use client';

import { Flag, Info, ListTree, Ruler, Scan } from '@bimstitch/ui/icons';
import { type AppIcon } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { ViewerFormat } from '@/components/shared/viewer/shared/viewerMode';

export type PanelId =
  | 'explorer'
  | 'findings'
  | 'measure'
  | 'section'
  | 'drawingInfo'
  | 'bcf';

/**
 * A side-rail layer indicator: how many items the tab's layer has, whether the
 * layer is currently shown, and a toggle. The count pill doubles as the
 * show/hide control — clicking it flips `visible` without opening the panel.
 */
export type RailBadge = {
  count: number;
  visible: boolean;
  onToggleVisible: () => void;
  /** Tooltip / aria label for the pill (already localized). */
  toggleLabel: string;
};

type SideRailProps = {
  format: ViewerFormat;
  activePanel: PanelId | null;
  onTogglePanel: (id: PanelId) => void;
  /** Per-tab count + visibility indicators. Absent tabs render no pill. */
  badges?: Partial<Record<PanelId, RailBadge>> | undefined;
};

type RailButton = {
  id: PanelId;
  labelKey: string;
  icon: AppIcon;
};

const IFC_BUTTONS: RailButton[] = [
  { id: 'findings', labelKey: 'titleFindings', icon: Info },
  { id: 'explorer', labelKey: 'titleExplorer', icon: ListTree },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
  { id: 'section', labelKey: 'titleSection', icon: Scan },
  { id: 'bcf', labelKey: 'titleBcf', icon: Flag },
];

const PDF_BUTTONS: RailButton[] = [
  { id: 'findings', labelKey: 'titleFindings', icon: Info },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
  { id: 'bcf', labelKey: 'titleBcf', icon: Flag },
];

const DRAWING_BUTTONS: RailButton[] = [
  { id: 'drawingInfo', labelKey: 'titleDrawingInfo', icon: Info },
];

const BUTTONS_BY_FORMAT: Record<ViewerFormat, RailButton[]> = {
  ifc: IFC_BUTTONS,
  pdf: PDF_BUTTONS,
  dxf: DRAWING_BUTTONS,
  dwg: DRAWING_BUTTONS,
};

/**
 * Count pill that doubles as the layer show/hide toggle. Rendered as a sibling
 * of the open-panel button (never a child — nested buttons are invalid HTML).
 * Styled to stay legible on both the active brand-gradient tab and the inactive
 * white tab, with a clearly distinct "hidden" state.
 */
function CountPill({
  badge,
  isActive,
}: {
  badge: RailBadge;
  isActive: boolean;
}): JSX.Element {
  const { count, visible, onToggleVisible, toggleLabel } = badge;
  // Keep the circle compact for big counts (findings can exceed 99).
  const display = count > 99 ? '99+' : String(count);
  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={toggleLabel}
      title={toggleLabel}
      onClick={(e) => {
        e.stopPropagation();
        onToggleVisible();
      }}
      className={cn(
        'absolute right-1 top-1 mr-5 z-10 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[12px] font-bold leading-none tabular-nums shadow-md ring-[1.5px] transition-colors',
        visible
          ? isActive
            ? 'bg-white text-[var(--brand-gradient-start)] ring-white'
            : 'bg-[var(--brand-gradient-start)] text-white ring-white'
          : isActive
            ? 'bg-white/85 text-[var(--brand-gradient-start)]/60 ring-white/70'
            : 'bg-background text-foreground-tertiary ring-border',
      )}
    >
      {display}
    </button>
  );
}

export function SideRail({
  format,
  activePanel,
  onTogglePanel,
  badges,
}: SideRailProps): JSX.Element {
  const t = useTranslations('viewer.sidePanel');
  const buttons = BUTTONS_BY_FORMAT[format];
  return (
    <div
      className="z-30 flex w-[46px] shrink-0 flex-col items-center gap-[7px] border-l border-t border-white/12 px-[6px] py-3"
      style={{
        background: 'linear-gradient(180deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
      }}
    >
      {buttons.map(({ id, labelKey, icon: Icon }) => {
        const isActive = activePanel === id;
        const label = t(labelKey);
        const badge = badges?.[id];
        return (
          <div key={id} className="relative w-full">
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() => { onTogglePanel(id); }}
              title={label}
              className={cn(
                'flex min-h-[92px] w-full flex-col items-center justify-start gap-[9px] rounded border pt-[10px] pb-[13px] transition-colors duration-150',
                isActive
                  ? 'border-white/45 bg-white/22 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_2px_10px_-2px_rgba(0,0,0,0.35)]'
                  : 'border-white/25 bg-white text-foreground-secondary hover:border-white/40 hover:bg-white/90',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span
                className="text-[11px] font-bold uppercase leading-none tracking-[0.02em]"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
              >
                {label}
              </span>
            </button>
            {badge && badge.count > 0 ? (
              <CountPill badge={badge} isActive={isActive} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
