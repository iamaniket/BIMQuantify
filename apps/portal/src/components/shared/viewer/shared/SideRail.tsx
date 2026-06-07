'use client';

import { Info, ListTree, Ruler, Scan } from '@bimstitch/ui/icons';
import { type AppIcon as LucideIcon } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { ViewerFormat } from '@/components/shared/viewer/shared/viewerMode';

export type PanelId =
  | 'explorer'
  | 'inspector'
  | 'measure'
  | 'section'
  | 'drawingInfo';

type SideRailProps = {
  format: ViewerFormat;
  activePanel: PanelId | null;
  onTogglePanel: (id: PanelId) => void;
};

type RailButton = {
  id: PanelId;
  labelKey: string;
  icon: LucideIcon;
};

const IFC_BUTTONS: RailButton[] = [
  { id: 'inspector', labelKey: 'titleInspector', icon: Info },
  { id: 'explorer', labelKey: 'titleExplorer', icon: ListTree },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
  { id: 'section', labelKey: 'titleSection', icon: Scan },
];

const PDF_BUTTONS: RailButton[] = [
  { id: 'inspector', labelKey: 'titleInspector', icon: Info },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
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

export function SideRail({
  format,
  activePanel,
  onTogglePanel,
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
        return (
          <button
            key={id}
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
        );
      })}
    </div>
  );
}
