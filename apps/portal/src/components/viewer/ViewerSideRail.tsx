'use client';

import { Info, ListTree, type LucideIcon } from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '@bimstitch/ui';

import type { OpenPanels, ViewerPanelId } from './ViewerSidePanel';

type ViewerSideRailProps = {
  openPanels: OpenPanels;
  onTogglePanel: (id: ViewerPanelId) => void;
};

type RailButton = {
  id: ViewerPanelId;
  label: string;
  icon: LucideIcon;
  position: string;
};

const BUTTONS: RailButton[] = [
  { id: 'explorer', label: 'Model Explorer', icon: ListTree, position: 'top-0' },
  { id: 'properties', label: 'Properties', icon: Info, position: 'top-1/2' },
];

export function ViewerSideRail({
  openPanels,
  onTogglePanel,
}: ViewerSideRailProps): JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-4 right-0 top-0 z-30 w-8 border-l border-border bg-background shadow-md">
      {BUTTONS.map(({ id, label, icon: Icon, position }) => {
        const isActive = openPanels[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              onTogglePanel(id);
            }}
            className={cn(
              'pointer-events-auto absolute inset-x-0 flex flex-col items-center gap-2 px-2 py-3 transition-colors',
              position,
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground-secondary hover:bg-primary/5 hover:text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
            <span
              className="text-caption font-medium tracking-wide"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
