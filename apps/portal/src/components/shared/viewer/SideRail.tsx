'use client';

import {
  Files,
  Info,
  ListTree,
  Ruler,
  Scan,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

export type PanelId =
  | 'explorer'
  | 'inspector'
  | 'measure'
  | 'section'
  | 'pages'
  | 'drawingInfo';

export type Mode = 'ifc' | 'pdf' | 'drawing';

type SideRailProps = {
  mode: Mode;
  activePanel: PanelId | null;
  onTogglePanel: (id: PanelId) => void;
};

type RailButton = {
  id: PanelId;
  labelKey: string;
  icon: LucideIcon;
};

const IFC_BUTTONS: RailButton[] = [
  { id: 'explorer', labelKey: 'titleExplorer', icon: ListTree },
  { id: 'inspector', labelKey: 'titleInspector', icon: Info },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
  { id: 'section', labelKey: 'titleSection', icon: Scan },
];

const PDF_BUTTONS: RailButton[] = [
  { id: 'pages', labelKey: 'titlePages', icon: Files },
  { id: 'inspector', labelKey: 'titleInspector', icon: Info },
];

const DRAWING_BUTTONS: RailButton[] = [
  { id: 'drawingInfo', labelKey: 'titleDrawingInfo', icon: Info },
];

const BUTTONS_BY_MODE: Record<Mode, RailButton[]> = {
  ifc: IFC_BUTTONS,
  pdf: PDF_BUTTONS,
  drawing: DRAWING_BUTTONS,
};

export function SideRail({
  mode,
  activePanel,
  onTogglePanel,
}: SideRailProps): JSX.Element {
  const t = useTranslations('viewer.sidePanel');
  const buttons = BUTTONS_BY_MODE[mode];
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
                ? 'border-[var(--brand-gradient-start)] bg-[var(--brand-gradient-start)] text-white shadow-[0_2px_10px_-2px_rgba(0,0,0,0.35)]'
                : 'border-white/25 bg-white text-foreground-secondary hover:border-white/40 hover:bg-white/90',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span
              className="text-[11px] font-semibold leading-none tracking-[0.02em]"
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
