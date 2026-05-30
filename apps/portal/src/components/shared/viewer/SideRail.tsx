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
      className="z-30 flex w-[51px] shrink-0 flex-col items-center gap-2 border-l border-t border-white/12 py-3"
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
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150',
              isActive
                ? 'bg-white/[0.16] text-white'
                : 'text-white/[0.82] border border-transparent hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon className={cn('h-[18px] w-[18px]', isActive ? 'text-white' : 'text-white/55')} />
          </button>
        );
      })}
    </div>
  );
}
