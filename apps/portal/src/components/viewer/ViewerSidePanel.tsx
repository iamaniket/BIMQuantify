'use client';

import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

import { DocumentsPanel } from './documents/DocumentsPanel';
import type { ViewerPanelId } from './ViewerSideRail';

export type { ViewerPanelId } from './ViewerSideRail';

const PANEL_TITLES: Record<ViewerPanelId, string> = {
  explorer: 'Model Tree',
  properties: 'Properties',
  documents: 'Documents',
  issues: 'Issues',
  compliance: 'BBL Compliance',
  measure: 'Measurement',
};

type ViewerSidePanelProps = {
  activePanel: ViewerPanelId | null;
  onClose: () => void;
  explorerContent: ReactNode;
  propertiesContent: ReactNode;
  measureContent: ReactNode;
};

function PlaceholderContent({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <p className="text-body2 font-medium text-foreground-secondary">{label}</p>
        <p className="mt-1 font-mono text-caption text-foreground-secondary/60">
          Coming soon
        </p>
      </div>
    </div>
  );
}

export function ViewerSidePanel({
  activePanel,
  onClose,
  explorerContent,
  propertiesContent,
  measureContent,
}: ViewerSidePanelProps): JSX.Element {
  const isOpen = activePanel !== null;

  return (
    <div
      aria-hidden={!isOpen}
      className={cn(
        'absolute bottom-0 right-11 top-0 z-20 w-[360px] transition-transform duration-200 ease-out',
        isOpen
          ? 'pointer-events-auto translate-x-0'
          : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex h-full flex-col border-l border-border bg-background shadow-lg">
        {activePanel !== null && (
          <>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background-secondary px-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground-secondary">
                {PANEL_TITLES[activePanel]}
              </span>
              <button
                type="button"
                onClick={onClose}
                title="Close panel"
                className="-mr-1 rounded p-1 text-foreground-secondary transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {activePanel === 'explorer' && explorerContent}
              {activePanel === 'properties' && propertiesContent}
              {activePanel === 'documents' && <DocumentsPanel />}
              {activePanel === 'measure' && measureContent}
              {activePanel === 'issues' && <PlaceholderContent label="Issues" />}
              {activePanel === 'compliance' && <PlaceholderContent label="BBL Compliance" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
