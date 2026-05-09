'use client';

import {
  AlertCircle,
  FileText,
  Info,
  ListTree,
  MessageSquare,
  Ruler,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

export type ViewerPanelId =
  | 'explorer'
  | 'properties'
  | 'documents'
  | 'issues'
  | 'compliance'
  | 'measure'
  | 'bcf';

type ViewerSideRailProps = {
  activePanel: ViewerPanelId | null;
  onTogglePanel: (id: ViewerPanelId) => void;
};

type RailButton = {
  id: ViewerPanelId;
  label: string;
  icon: LucideIcon;
};

const BUTTONS: RailButton[] = [
  { id: 'explorer', label: 'Model Tree', icon: ListTree },
  { id: 'properties', label: 'Properties', icon: Info },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'issues', label: 'Issues', icon: AlertCircle },
  { id: 'compliance', label: 'BBL Compliance', icon: ShieldCheck },
  { id: 'measure', label: 'Measurement', icon: Ruler },
  { id: 'bcf', label: 'BCF Topics', icon: MessageSquare },
];

export function ViewerSideRail({
  activePanel,
  onTogglePanel,
}: ViewerSideRailProps): JSX.Element {
  return (
    <div className="absolute bottom-0 right-0 top-0 z-30 flex w-11 flex-col items-center gap-1 border-l border-border bg-background-secondary py-2">
      {BUTTONS.map(({ id, label, icon: Icon }) => {
        const isActive = activePanel === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onTogglePanel(id)}
            title={label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
              isActive
                ? 'bg-primary-lighter text-primary border border-primary-light shadow-sm'
                : 'text-foreground-secondary border border-transparent shadow-sm hover:bg-primary/5 hover:text-primary hover:border-primary-light',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
