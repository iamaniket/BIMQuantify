'use client';

import {
  ClipboardCheck,
  Files,
  Info,
  ListTree,
  MessageSquare,
  Ruler,
  Scan,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

export type PanelId =
  | 'explorer'
  | 'inspector'
  | 'issues'
  | 'compliance'
  | 'measure'
  | 'section'
  | 'bcf'
  | 'pages';

export type Mode = 'ifc' | 'pdf';

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
  { id: 'issues', labelKey: 'titleIssues', icon: ClipboardCheck },
  { id: 'compliance', labelKey: 'titleCompliance', icon: ShieldCheck },
  { id: 'measure', labelKey: 'titleMeasure', icon: Ruler },
  { id: 'section', labelKey: 'titleSection', icon: Scan },
  { id: 'bcf', labelKey: 'titleBcf', icon: MessageSquare },
];

const PDF_BUTTONS: RailButton[] = [
  { id: 'pages', labelKey: 'titlePages', icon: Files },
  { id: 'inspector', labelKey: 'titleInspector', icon: Info },
  { id: 'issues', labelKey: 'titleIssues', icon: ClipboardCheck },
  { id: 'compliance', labelKey: 'titleCompliance', icon: ShieldCheck },
];

export function SideRail({
  mode,
  activePanel,
  onTogglePanel,
}: SideRailProps): JSX.Element {
  const t = useTranslations('viewer.sidePanel');
  const buttons = mode === 'pdf' ? PDF_BUTTONS : IFC_BUTTONS;
  return (
    <div
      className="absolute bottom-0 right-0 top-0 z-30 flex w-[51px] flex-col items-center gap-2 border-l border-t border-white/12 py-3"
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
